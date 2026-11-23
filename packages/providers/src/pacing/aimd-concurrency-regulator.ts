import {
  AIMD_CLEAN_COMPLETIONS,
  AIMD_CLEAN_WINDOW_MS,
  AIMD_COOLDOWN_MS,
  AIMD_START_CWND,
  RETRY_AFTER_CAP_MS,
  RETRY_JITTER_FRACTION,
} from "./constants.js";
import { PacingError } from "./errors.js";
import type { AimdSnapshot } from "./types.js";

export interface AimdRegulatorOptions {
  readonly connectionMaxCap: number;
  readonly hardwareCap: number;
  readonly now: () => number;
  readonly random?: () => number;
}

export interface AimdIncrease {
  readonly increased: boolean;
  readonly cwnd: number;
}

export interface AimdHalve {
  readonly cwnd: number;
  readonly waitMs: number;
  readonly backoffUntilMs: number;
  readonly cooldownUntilMs: number;
}

/**
 * Per-connection TCP AIMD. Start at 2, add 1 after a clean stretch, halve on a transient 429.
 * Usage-limit exhaustion is a separate path that sets cwnd to 0 and does not retry.
 */
export class AimdConcurrencyRegulator {
  private cwnd: number;
  private readonly maxCwnd: number;
  private cleanCompletions: number;
  private cleanWindowStartedAtMs: number;
  private cooldownUntilMs: number;
  private backoffUntilMs: number;
  private lastWaitMs: number;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(options: AimdRegulatorOptions) {
    this.maxCwnd = resolveMaxCwnd(options.connectionMaxCap, options.hardwareCap);
    this.cwnd = AIMD_START_CWND;
    this.cleanCompletions = 0;
    this.cleanWindowStartedAtMs = options.now();
    this.cooldownUntilMs = 0;
    this.backoffUntilMs = 0;
    this.lastWaitMs = 0;
    this.now = options.now;
    this.random = options.random ?? Math.random;
  }

  static restore(snapshot: AimdSnapshot, options: AimdRegulatorOptions): AimdConcurrencyRegulator {
    const regulator = new AimdConcurrencyRegulator(options);
    regulator.cwnd = snapshot.cwnd;
    regulator.cleanCompletions = snapshot.cleanCompletions;
    regulator.cleanWindowStartedAtMs = snapshot.cleanWindowStartedAtMs;
    regulator.cooldownUntilMs = snapshot.cooldownUntilMs;
    regulator.backoffUntilMs = snapshot.backoffUntilMs;
    regulator.lastWaitMs = snapshot.lastWaitMs;
    return regulator;
  }

  get value(): number {
    return this.cwnd;
  }

  get cap(): number {
    return this.maxCwnd;
  }

  snapshot(): AimdSnapshot {
    return {
      cwnd: this.cwnd,
      maxCwnd: this.maxCwnd,
      cleanCompletions: this.cleanCompletions,
      cleanWindowStartedAtMs: this.cleanWindowStartedAtMs,
      cooldownUntilMs: this.cooldownUntilMs,
      backoffUntilMs: this.backoffUntilMs,
      lastWaitMs: this.lastWaitMs,
    };
  }

  /**
   * Count one clean completion. No +1 while the post-429 cool-down is open.
   * `allowIncrease` is false when burn-rate pacing is already stepping concurrency down.
   */
  noteCleanCompletion(allowIncrease = true): AimdIncrease {
    if (this.cwnd <= 0) return { increased: false, cwnd: this.cwnd };
    const now = this.now();
    if (now < this.cooldownUntilMs) return { increased: false, cwnd: this.cwnd };
    this.cleanCompletions += 1;
    if (!allowIncrease) return { increased: false, cwnd: this.cwnd };
    return { increased: this.evaluate(now), cwnd: this.cwnd };
  }

  /** Time trigger: +1 after a 60s clean window even when fewer than 6 turns have finished. */
  pulse(allowIncrease = true): AimdIncrease {
    if (!allowIncrease || this.cwnd <= 0) return { increased: false, cwnd: this.cwnd };
    const now = this.now();
    if (now < this.cooldownUntilMs) return { increased: false, cwnd: this.cwnd };
    return { increased: this.evaluate(now), cwnd: this.cwnd };
  }

  /** Transient 429 / RPM / TPM. Halve, honor capped jittered Retry-After, hold +1 for 60s. */
  noteTransient429(retryAfterMs: number): AimdHalve {
    if (this.cwnd <= 0) {
      return {
        cwnd: 0,
        waitMs: 0,
        backoffUntilMs: this.backoffUntilMs,
        cooldownUntilMs: this.cooldownUntilMs,
      };
    }
    this.cwnd = Math.max(1, Math.floor(this.cwnd / 2));
    const waitMs = jitteredBackoffMs(retryAfterMs, this.random);
    const now = this.now();
    this.backoffUntilMs = now + waitMs;
    this.cooldownUntilMs = now + AIMD_COOLDOWN_MS;
    this.cleanCompletions = 0;
    this.cleanWindowStartedAtMs = this.cooldownUntilMs;
    this.lastWaitMs = waitMs;
    return {
      cwnd: this.cwnd,
      waitMs,
      backoffUntilMs: this.backoffUntilMs,
      cooldownUntilMs: this.cooldownUntilMs,
    };
  }

  /** Hard allowance exhaustion. cwnd stays 0 until an explicit conservative restart. */
  exhaust(): void {
    this.cwnd = 0;
    this.cleanCompletions = 0;
    this.backoffUntilMs = 0;
  }

  /** Opt-in auto-resume and fresh windows always restart at cwnd 2. */
  restartAtStart(): void {
    this.cwnd = AIMD_START_CWND;
    this.cleanCompletions = 0;
    this.cleanWindowStartedAtMs = this.now();
    this.cooldownUntilMs = 0;
    this.backoffUntilMs = 0;
    this.lastWaitMs = 0;
  }

  private evaluate(now: number): boolean {
    if (now < this.cooldownUntilMs) return false;
    if (this.cwnd <= 0 || this.cwnd >= this.maxCwnd) return false;
    const byCount = this.cleanCompletions >= AIMD_CLEAN_COMPLETIONS;
    const byTime = now - this.cleanWindowStartedAtMs >= AIMD_CLEAN_WINDOW_MS;
    if (!byCount && !byTime) return false;
    this.cwnd += 1;
    this.cleanCompletions = 0;
    this.cleanWindowStartedAtMs = now;
    return true;
  }
}

export function resolveMaxCwnd(connectionMaxCap: number, hardwareCap: number): number {
  if (!Number.isInteger(connectionMaxCap) || !Number.isInteger(hardwareCap)) {
    throw new PacingError("invalid_cap", "Concurrency caps must be integers.");
  }
  const maxCwnd = Math.min(connectionMaxCap, hardwareCap);
  if (maxCwnd < AIMD_START_CWND) {
    throw new PacingError(
      "cap_below_start",
      `min(connectionMaxCap, hardwareCap) must be >= ${AIMD_START_CWND}.`,
    );
  }
  return maxCwnd;
}

export function jitteredBackoffMs(retryAfterMs: number, random: () => number): number {
  const nonNegative = Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : 0;
  const capped = Math.min(nonNegative, RETRY_AFTER_CAP_MS);
  const unit = Math.min(1, Math.max(0, random()));
  const jitter = Math.floor(capped * RETRY_JITTER_FRACTION * unit);
  return capped + jitter;
}
