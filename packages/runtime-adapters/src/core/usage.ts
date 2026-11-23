import { asFiniteNumber, asRecord } from "./records.js";
import type { NormalizedUsage } from "./types.js";

function firstNumber(record: Readonly<Record<string, unknown>>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = asFiniteNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function nestedNumber(
  record: Readonly<Record<string, unknown>>,
  parent: string,
  child: string,
): number | null {
  const nested = asRecord(record[parent]);
  if (!nested) return null;
  return asFiniteNumber(nested[child]);
}

function nonNegativeInt(value: number | null): number {
  if (value === null) return 0;
  return Math.max(0, Math.trunc(value));
}

function microUsd(record: Readonly<Record<string, unknown>>): number | undefined {
  const direct = firstNumber(record, ["costMicroUsd", "cost_micro_usd"]);
  if (direct !== null) return Math.max(0, Math.trunc(direct));
  const usd = firstNumber(record, ["total_cost_usd", "costUsd", "cost_usd"]);
  if (usd === null) return undefined;
  return Math.max(0, Math.round(usd * 1_000_000));
}

/** Map vendor token JSON into the one usage object foreign runtimes must emit. */
export function normalizeUsage(raw: unknown): NormalizedUsage {
  const record = asRecord(raw) ?? {};
  const nestedUsage = asRecord(record.usage) ?? asRecord(record.metrics) ?? asRecord(record.tokenUsage);
  const source = nestedUsage ? { ...record, ...nestedUsage } : record;
  const cacheRead = nonNegativeInt(
    firstNumber(source, [
      "cacheReadInputTokens",
      "cache_read_input_tokens",
      "cacheReadTokens",
      "cache_read_tokens",
      "cachedTokens",
      "cached_tokens",
    ]) ?? nestedNumber(source, "input_tokens_details", "cached_tokens"),
  );
  const cacheCreation = nonNegativeInt(
    firstNumber(source, ["cacheCreationInputTokens", "cache_creation_input_tokens"]),
  );
  const usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    costMicroUsd?: number;
    quotaUnits?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  } = {
    inputTokens: nonNegativeInt(
      firstNumber(source, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]),
    ),
    cachedInputTokens: cacheRead + cacheCreation,
    outputTokens: nonNegativeInt(
      firstNumber(source, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]),
    ),
    reasoningTokens: nonNegativeInt(
      firstNumber(source, ["reasoningTokens", "reasoning_tokens"]) ??
        nestedNumber(source, "output_tokens_details", "reasoning_tokens"),
    ),
  };
  const cost = microUsd(source);
  if (cost !== undefined) usage.costMicroUsd = cost;
  const quota = firstNumber(source, ["quotaUnits", "quota_units"]);
  if (quota !== null) usage.quotaUnits = Math.max(0, Math.trunc(quota));
  if (cacheRead > 0) usage.cacheReadInputTokens = cacheRead;
  if (cacheCreation > 0) usage.cacheCreationInputTokens = cacheCreation;
  return usage;
}
