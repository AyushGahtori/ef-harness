import { CHECKPOINT_STOP_ACTIONS, DEFAULT_RETRY_AFTER_MS } from "./constants.js";
import type { AimdConcurrencyRegulator } from "./aimd-concurrency-regulator.js";
import { rateLimitLabel } from "./format.js";
import type {
  AppliedLimit,
  CheckpointStopCardRequest,
  LimitClassification,
  ProviderLimitSignal,
  TransientLimitClass,
  UsageLimitReason,
} from "./types.js";

export interface ApplyLimitContext {
  readonly connectionId: string;
  readonly projectId: string;
  readonly usedPpm: number;
  readonly ceilingPpm: number;
}

/**
 * Splits a short RPM/TPM burst from a real 5-hour, weekly, Copilot, or credit exhaustion.
 * A transient 429 halves cwnd and keeps the build running. A usage limit sets cwnd to 0.
 */
export class RateLimitVsUsageLimitClassifier {
  classify(signal: ProviderLimitSignal): LimitClassification {
    const usage = classifyUsage(signal);
    if (usage) {
      return {
        kind: "usage_limit_exhausted",
        retryAfterMs: null,
        limitClass: null,
        reason: usage.reason,
        resetAtMs: usage.resetAtMs,
        retryAllowed: false,
      };
    }
    if (isTransient(signal)) {
      return {
        kind: "transient_429",
        retryAfterMs: retryAfterMs(signal),
        limitClass: transientClass(signal.bodyText),
        reason: null,
        resetAtMs: null,
        retryAllowed: true,
      };
    }
    return {
      kind: "none",
      retryAfterMs: null,
      limitClass: null,
      reason: null,
      resetAtMs: null,
      retryAllowed: true,
    };
  }

  apply(
    signal: ProviderLimitSignal,
    aimd: AimdConcurrencyRegulator,
    context: ApplyLimitContext,
  ): AppliedLimit {
    const classification = this.classify(signal);
    if (classification.kind === "transient_429") {
      const halved = aimd.noteTransient429(classification.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS);
      return {
        classification,
        cwnd: halved.cwnd,
        waitMs: halved.waitMs,
        retryAllowed: true,
        buildStopped: false,
        boardMessage: rateLimitLabel(halved.waitMs),
        stopCard: null,
      };
    }
    if (classification.kind === "usage_limit_exhausted") {
      aimd.exhaust();
      const stopCard: CheckpointStopCardRequest = {
        kind: "checkpoint_stop",
        connectionId: context.connectionId,
        projectId: context.projectId,
        reason: "usage_limit_exhausted",
        usageLimitReason: classification.reason,
        resetAtMs: classification.resetAtMs,
        actions: CHECKPOINT_STOP_ACTIONS,
        retryAllowed: false,
        usedPpm: context.usedPpm,
        ceilingPpm: context.ceilingPpm,
      };
      return {
        classification,
        cwnd: 0,
        waitMs: null,
        retryAllowed: false,
        buildStopped: true,
        boardMessage: null,
        stopCard,
      };
    }
    return {
      classification,
      cwnd: aimd.value,
      waitMs: null,
      retryAllowed: true,
      buildStopped: false,
      boardMessage: null,
      stopCard: null,
    };
  }
}

function classifyUsage(
  signal: ProviderLimitSignal,
): { reason: UsageLimitReason; resetAtMs: number | null } | null {
  if (signal.copilotRemaining === 0) {
    return { reason: "copilot_remaining_zero", resetAtMs: signal.resetAtMs };
  }
  if (signal.openRouterCredit === 0) {
    return { reason: "openrouter_credit_zero", resetAtMs: signal.resetAtMs };
  }
  const body = signal.bodyText;
  if (!usageBody(body)) return null;
  const resetAtMs = signal.resetAtMs ?? parseResetAtMs(body, signal.nowMs);
  if (/5[\s-]?hour|five[\s-]?hour/i.test(body)) {
    return { reason: "five_hour_window", resetAtMs };
  }
  if (/weekly/i.test(body)) return { reason: "weekly_cap", resetAtMs };
  if (/monthly/i.test(body)) return { reason: "monthly_cap", resetAtMs };
  return { reason: "usage_limit_reached", resetAtMs };
}

function usageBody(body: string): boolean {
  return /usage_limit_reached|usage limit|quota exhausted|subscription_sharing_usage_limit_exceeded|weekly cap|weekly limit|monthly cap|monthly limit|5[\s-]?hour|five[\s-]?hour|insufficient credits/i.test(
    body,
  );
}

function isTransient(signal: ProviderLimitSignal): boolean {
  if (signal.httpStatus === 429) return true;
  return /rate_limit_exceeded|rate limit|too many requests|\brpm\b|\btpm\b|concurrency/i.test(
    signal.bodyText,
  );
}

function transientClass(body: string): TransientLimitClass {
  if (/\btpm\b/i.test(body)) return "tpm";
  if (/\brpm\b/i.test(body)) return "rpm";
  if (/concurrency/i.test(body)) return "concurrency";
  return "rate";
}

function retryAfterMs(signal: ProviderLimitSignal): number {
  if (signal.retryAfterSeconds !== null && Number.isFinite(signal.retryAfterSeconds)) {
    return Math.max(0, signal.retryAfterSeconds * 1_000);
  }
  const match =
    /(?:try again in|retry after)\s+(\d+)\s*(ms|s|sec|secs|seconds|m|min|minutes)\b/i.exec(
      signal.bodyText,
    );
  if (!match?.[1] || !match[2]) return DEFAULT_RETRY_AFTER_MS;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "ms") return amount;
  if (unit === "m" || unit === "min" || unit === "minutes") return amount * 60_000;
  return amount * 1_000;
}

/** "resets at 19:30 UTC" and ISO timestamps. Clock-only times roll forward if they already passed. */
export function parseResetAtMs(body: string, nowMs: number): number | null {
  const iso = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/.exec(body);
  if (iso?.[1]) {
    const parsed = Date.parse(iso[1]);
    if (Number.isFinite(parsed)) return parsed;
  }
  const clock = /resets?\s+at\s+(\d{1,2}):(\d{2})\s*UTC/i.exec(body);
  if (!clock?.[1] || !clock[2]) return null;
  const hours = Number(clock[1]);
  const minutes = Number(clock[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  const now = new Date(nowMs);
  let reset = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hours,
    minutes,
    0,
    0,
  );
  if (reset <= nowMs) reset += 24 * 60 * 60 * 1000;
  return reset;
}
