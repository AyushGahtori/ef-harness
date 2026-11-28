import {
  BURN_STEP_70_NUMERATOR,
  BURN_STEP_80_NUMERATOR,
  BURN_STEP_DENOMINATOR,
} from "./constants.js";
import { PacingError } from "./errors.js";
import { atLeastRatio, harnessCeilingPpm, windDownThresholdPpm } from "./format.js";
import type { BurnSample, WindowKind, WindowUsage } from "./types.js";

export interface BurnTrackerSnapshot {
  readonly reserveFraction: number;
  readonly windows: readonly WindowUsage[];
  readonly samples: readonly BurnSample[];
}

/**
 * Rolling ppm burn for the short window (5h) and the long window (weekly / monthly).
 * Paced concurrency steps down before the personal reserve is touched.
 */
export class BurnRateWindowTracker {
  private readonly reserveFraction: number;
  private readonly windows: WindowUsage[];
  private readonly samples: BurnSample[];

  constructor(reserveFraction: number, windows: readonly WindowUsage[] = []) {
    this.reserveFraction = reserveFraction;
    this.windows = windows.map((window) => ({ ...window }));
    this.samples = [];
    if (this.ceilingPpm <= 0) {
      throw new PacingError("invalid_ceiling", "Harness ceiling must stay above 0 ppm.");
    }
  }

  static restore(snapshot: BurnTrackerSnapshot): BurnRateWindowTracker {
    const tracker = new BurnRateWindowTracker(snapshot.reserveFraction, snapshot.windows);
    tracker.samples.push(...snapshot.samples);
    return tracker;
  }

  get ceilingPpm(): number {
    return harnessCeilingPpm(this.reserveFraction);
  }

  get windDownPpm(): number {
    return windDownThresholdPpm(this.ceilingPpm);
  }

  snapshot(): BurnTrackerSnapshot {
    return {
      reserveFraction: this.reserveFraction,
      windows: this.windows.map((window) => ({ ...window })),
      samples: this.samples.map((sample) => ({ ...sample })),
    };
  }

  window(kind: WindowKind): WindowUsage | undefined {
    return this.windows.find((item) => item.kind === kind);
  }

  usedPpm(kind: WindowKind): number {
    return this.window(kind)?.usedPpm ?? 0;
  }

  /** The window closest to its ceiling. Ties break toward the sooner reset. */
  bindingWindow(nowMs: number): WindowUsage | null {
    let best: WindowUsage | null = null;
    for (const window of this.windows) {
      if (!best) {
        best = window;
        continue;
      }
      const pressure = window.usedPpm + window.reservedInFlightPpm;
      const bestPressure = best.usedPpm + best.reservedInFlightPpm;
      if (pressure > bestPressure) best = window;
      else if (pressure === bestPressure && window.windowEndMs < best.windowEndMs) best = window;
    }
    if (!best) return null;
    if (nowMs > best.windowEndMs && this.windows.length > 1) {
      const open = this.windows.find((window) => window.windowEndMs > nowMs);
      if (open && open.usedPpm + open.reservedInFlightPpm >= best.usedPpm) return open;
    }
    return best;
  }

  resetAtMs(nowMs: number): number | null {
    const binding = this.bindingWindow(nowMs);
    return binding ? binding.windowEndMs : null;
  }

  record(kind: WindowKind, deltaPpm: number, atMs: number): void {
    if (deltaPpm <= 0) return;
    this.samples.push({ atMs, deltaPpm, windowKind: kind });
  }

  applyAuthoritative(kind: WindowKind, usedPpm: number, atMs: number, source: string): void {
    const window = this.requireWindow(kind);
    window.observedPpm = usedPpm;
    window.observedAtMs = atMs;
    window.source = source;
    if (usedPpm > window.usedPpm) window.usedPpm = usedPpm;
  }

  /**
   * Hold `ppm` against every window so two in-flight waves cannot each spend the same remainder.
   * Returns false when any window would cross the harness ceiling.
   */
  tryHold(ppm: number): boolean {
    if (ppm < 0) return false;
    if (this.windows.some((window) => this.room(window) < ppm)) return false;
    for (const window of this.windows) window.reservedInFlightPpm += ppm;
    return true;
  }

  releaseHold(ppm: number): void {
    for (const window of this.windows) {
      window.reservedInFlightPpm = Math.max(0, window.reservedInFlightPpm - ppm);
    }
  }

  /** Replace an in-flight hold with settled consumption on every shared window. */
  settle(reservedPpm: number, actualPpm: number, atMs: number): void {
    this.releaseHold(reservedPpm);
    const actual = Math.max(0, Math.round(actualPpm));
    for (const window of this.windows) {
      window.usedPpm = Math.min(1_000_000, window.usedPpm + actual);
      this.record(window.kind, actual, atMs);
    }
  }

  /**
   * Background slots only. The interactive priority slot is not counted here.
   * Returns 0 once usage reaches the 90% wind-down of the harness ceiling.
   */
  pacedBackgroundSlots(cwnd: number, nowMs: number): number {
    if (cwnd <= 0 || this.windows.length === 0) return 0;
    let slots = cwnd;
    for (const window of this.windows) {
      const used = window.usedPpm + window.reservedInFlightPpm;
      if (used >= this.ceilingPpm || used >= this.windDownPpm) return 0;
      let next = cwnd;
      if (atLeastRatio(used, this.ceilingPpm, BURN_STEP_80_NUMERATOR, BURN_STEP_DENOMINATOR)) {
        next -= 2;
      } else if (
        atLeastRatio(used, this.ceilingPpm, BURN_STEP_70_NUMERATOR, BURN_STEP_DENOMINATOR)
      ) {
        next -= 1;
      }
      const burn = this.burnPpmPerMs(window.kind, nowMs);
      const remainingMs = window.windowEndMs - nowMs;
      if (remainingMs > 0 && burn > 0) {
        const allowed = (this.ceilingPpm - used) / remainingMs;
        if (burn > allowed * 2) next -= 2;
        else if (burn > allowed * 1.25) next -= 1;
      }
      slots = Math.min(slots, Math.max(1, next));
    }
    return Math.max(1, Math.min(cwnd, slots));
  }

  /** Stop additive AIMD once any window is inside the 70% gentle-throttle band. */
  allowsAdditiveIncrease(): boolean {
    return this.windows.every(
      (window) =>
        !atLeastRatio(
          window.usedPpm + window.reservedInFlightPpm,
          this.ceilingPpm,
          BURN_STEP_70_NUMERATOR,
          BURN_STEP_DENOMINATOR,
        ),
    );
  }

  crossedWindDown(): boolean {
    return this.windows.some((window) => window.usedPpm >= this.windDownPpm);
  }

  reachedCeiling(): boolean {
    return this.windows.some(
      (window) => window.usedPpm + window.reservedInFlightPpm >= this.ceilingPpm,
    );
  }

  settledAtCeiling(): boolean {
    return this.windows.some((window) => window.usedPpm >= this.ceilingPpm);
  }

  persistReset(kind: WindowKind | null, resetAtMs: number): void {
    const window = (kind ? this.window(kind) : undefined) ?? this.windows[0];
    if (!window) return;
    window.windowEndMs = resetAtMs;
    window.source = "usage_limit_exhausted";
    window.observedAtMs = resetAtMs;
  }

  /** Provider window rolled. Spend returns to zero and the next window keeps the same duration. */
  rollAll(resetAtMs: number): void {
    for (const window of this.windows) {
      const duration =
        window.durationMs > 0 ? window.durationMs : window.windowEndMs - window.windowStartMs;
      window.windowStartMs = resetAtMs;
      window.windowEndMs = resetAtMs + duration;
      window.durationMs = duration;
      window.usedPpm = 0;
      window.observedPpm = null;
      window.reservedInFlightPpm = 0;
      window.source = "window_rolled";
      window.observedAtMs = null;
    }
    this.samples.length = 0;
  }

  burnPpmPerMs(kind: WindowKind, nowMs: number): number {
    const horizon = 5 * 60_000;
    const recent = this.samples.filter(
      (sample) => sample.windowKind === kind && nowMs - sample.atMs <= horizon && sample.deltaPpm > 0,
    );
    if (recent.length < 2) return 0;
    let oldest = nowMs;
    let total = 0;
    for (const sample of recent) {
      total += sample.deltaPpm;
      if (sample.atMs < oldest) oldest = sample.atMs;
    }
    const span = nowMs - oldest;
    if (span < 1_000) return 0;
    return total / span;
  }

  private room(window: WindowUsage): number {
    return this.ceilingPpm - window.usedPpm - window.reservedInFlightPpm;
  }

  private requireWindow(kind: WindowKind): WindowUsage {
    const window = this.window(kind);
    if (!window) throw new PacingError("unknown_window", `No ${kind} window on this connection.`);
    return window;
  }
}
