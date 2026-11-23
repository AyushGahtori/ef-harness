import { isRecord, readNumber } from "./json.js";
import { OPENCODE_ADAPTER_ID, type NormalizedUsageReceipt, type ProviderId, type UsageTotals } from "./types.js";

export const EMPTY_USAGE: UsageTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
};

function pickNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = readNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

export function parseAcpUsageUpdate(payload: unknown): UsageTotals | null {
  if (!isRecord(payload)) return null;
  const nested = isRecord(payload.usage) ? payload.usage : isRecord(payload.update) ? payload.update : payload;
  const marker = nested.sessionUpdate ?? payload.sessionUpdate;
  const looksLikeUsage =
    marker === "usage_update" ||
    pickNumber(nested, ["input", "inputTokens"]) !== null ||
    pickNumber(nested, ["output", "outputTokens"]) !== null;
  if (!looksLikeUsage) return null;
  return {
    input: pickNumber(nested, ["input", "inputTokens"]) ?? 0,
    output: pickNumber(nested, ["output", "outputTokens"]) ?? 0,
    cacheRead: pickNumber(nested, ["cacheRead", "cache_read", "cachedInputTokens"]) ?? 0,
    cacheWrite: pickNumber(nested, ["cacheWrite", "cache_write"]) ?? 0,
    reasoning: pickNumber(nested, ["reasoning", "reasoningTokens"]) ?? 0,
  };
}

export function readCostMicroUsd(payload: unknown, provider: ProviderId): number {
  if (provider === "ollama") return 0;
  if (!isRecord(payload)) return 0;
  const direct = readNumber(payload.costMicroUsd);
  if (direct !== null) return direct;
  if (isRecord(payload.cost)) {
    const micro = readNumber(payload.cost.microUsd);
    if (micro !== null) return micro;
    const usd = readNumber(payload.cost.usd);
    if (usd !== null) return Math.round(usd * 1_000_000);
  }
  return 0;
}

export function toReceipt(input: {
  readonly attemptId: string;
  readonly connectionId: string;
  readonly provider: ProviderId;
  readonly usage: UsageTotals;
  readonly costMicroUsd: number;
}): NormalizedUsageReceipt {
  const costMicroUsd = input.provider === "ollama" ? 0 : input.costMicroUsd;
  return {
    attemptId: input.attemptId,
    adapterId: OPENCODE_ADAPTER_ID,
    connectionId: input.connectionId,
    provider: input.provider,
    inputTokens: input.usage.input,
    outputTokens: input.usage.output,
    cacheReadTokens: input.usage.cacheRead,
    cacheWriteTokens: input.usage.cacheWrite,
    reasoningTokens: input.usage.reasoning,
    costMicroUsd,
    currency: input.provider === "ollama" ? "usd-zero" : "micro-usd",
  };
}
