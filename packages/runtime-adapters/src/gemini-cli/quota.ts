import { GEMINI_ROUTE_ID, INITIAL_CWND } from "./constants.js";
import type { CheckpointStopCard, LimitDecision, UsageSnapshot } from "./ports.js";

export interface GeminiLimitSignal {
  readonly httpStatus: number | null;
  readonly code: string | null;
  readonly message: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function numberField(source: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

export function emptyUsage(): UsageSnapshot {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costMicroUsd: null,
  };
}

export function extractUsage(update: unknown): UsageSnapshot | null {
  const record = asRecord(update);
  if (!record) return null;
  const kind = record.sessionUpdate ?? record.type;
  const nested = asRecord(record.usage) ?? record;
  const hasTokens =
    nested.inputTokens !== undefined ||
    nested.input_tokens !== undefined ||
    nested.promptTokenCount !== undefined ||
    nested.outputTokens !== undefined ||
    nested.output_tokens !== undefined;
  if (kind !== "usage_update" && !hasTokens) return null;
  if (!hasTokens && kind !== "usage_update") return null;
  const cost = nested.costMicroUsd;
  return {
    inputTokens: numberField(nested, ["inputTokens", "input_tokens", "promptTokenCount"]),
    outputTokens: numberField(nested, ["outputTokens", "output_tokens", "candidatesTokenCount"]),
    cachedInputTokens: numberField(nested, ["cachedInputTokens", "cached_input_tokens", "cacheRead"]),
    cacheWriteTokens: numberField(nested, ["cacheWriteTokens", "cache_write_tokens", "cacheWrite"]),
    reasoningTokens: numberField(nested, ["reasoningTokens", "reasoning_tokens", "thoughtsTokenCount"]),
    costMicroUsd: typeof cost === "number" ? cost : null,
  };
}

/**
 * Local port of Task 140 pacing.
 * RESOURCE_EXHAUSTED / daily quota parks with cwnd 0.
 * A bare 429 / RPM signal is a transient backoff that halves cwnd.
 */
export class LocalPacingClassifier {
  private cwnd = INITIAL_CWND;

  get concurrency(): number {
    return this.cwnd;
  }

  classify(signal: GeminiLimitSignal): LimitDecision {
    const text = `${signal.code ?? ""} ${signal.message}`.toUpperCase();
    const quota =
      text.includes("RESOURCE_EXHAUSTED") ||
      text.includes("DAILY QUOTA") ||
      text.includes("QUOTA EXHAUST");
    if (quota) {
      this.cwnd = 0;
      const stopCard: CheckpointStopCard = {
        kind: "checkpoint_stop",
        reason: "usage_limit_exhausted",
        usageLimitReason: "daily_quota",
        routeId: GEMINI_ROUTE_ID,
        retryAllowed: false,
        silentPaidFallback: false,
      };
      return {
        kind: "quota_exhaustion",
        cwnd: 0,
        retryAllowed: false,
        silentPaidFallback: false,
        backoffMs: null,
        stopCard,
      };
    }
    const transient =
      signal.httpStatus === 429 ||
      text.includes("429") ||
      text.includes("RPM") ||
      text.includes("RATE LIMIT");
    if (transient) {
      this.cwnd = Math.max(1, Math.floor(this.cwnd / 2));
      return {
        kind: "transient_rpm",
        cwnd: this.cwnd,
        retryAllowed: true,
        silentPaidFallback: false,
        backoffMs: 2_000,
        stopCard: null,
      };
    }
    return {
      kind: "none",
      cwnd: this.cwnd,
      retryAllowed: true,
      silentPaidFallback: false,
      backoffMs: null,
      stopCard: null,
    };
  }
}
