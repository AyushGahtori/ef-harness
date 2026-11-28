import { ON_DEMAND_PAUSE_PERCENT } from "./constants.js";
import type { CursorQuotaSnapshot, NormalizedUsage } from "./types.js";

export function emptyUsage(partialInterrupted = false): NormalizedUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costMicroUsd: 0,
    quotaUnits: 0,
    partialInterrupted,
    source: "run.usage",
  };
}

export function parseRunUsage(raw: unknown, partialInterrupted = false): NormalizedUsage {
  const record = asRecord(raw);
  const costFromMicro = numberField(record, ["costMicroUsd", "cost_micro_usd"]);
  const cents = numberField(record, ["totalCents", "total_cents", "chargedCents"]);
  const costMicroUsd = costFromMicro > 0 ? costFromMicro : cents > 0 ? Math.round(cents * 10_000) : 0;
  return {
    inputTokens: numberField(record, ["inputTokens", "input_tokens", "promptTokens"]),
    cachedInputTokens: numberField(record, ["cacheReadTokens", "cache_read_tokens", "cachedInputTokens"]),
    outputTokens: numberField(record, ["outputTokens", "output_tokens", "completionTokens"]),
    reasoningTokens: numberField(record, ["reasoningTokens", "reasoning_tokens"]),
    costMicroUsd,
    quotaUnits: numberField(record, ["requestCount", "requests", "quotaUnits"]),
    partialInterrupted,
    source: "run.usage",
  };
}

export function parseAgentUsage(raw: unknown): CursorQuotaSnapshot {
  const record = asRecord(raw);
  return {
    plan: stringField(record, ["plan", "planName"]) || "cursor",
    includedUsedPercent: numberField(record, ["includedUsedPercent", "included_used_percent", "usedPercent"]),
    fastUsedPercent: numberField(record, ["fastUsedPercent", "fast_used_percent"]),
    remainingPercent: numberField(record, ["remainingPercent", "remaining_percent"]),
    onDemandEnabled: booleanField(record, ["onDemandEnabled", "on_demand_enabled", "onDemandPaid"]),
    chargedCents: numberField(record, ["chargedCents", "charged_cents"]),
    source: "Agent.getUsage",
  };
}

export function shouldPauseForOnDemand(quota: CursorQuotaSnapshot): boolean {
  if (quota.chargedCents > 0) return true;
  if (!quota.onDemandEnabled) return false;
  return (
    quota.includedUsedPercent >= ON_DEMAND_PAUSE_PERCENT ||
    quota.fastUsedPercent >= ON_DEMAND_PAUSE_PERCENT
  );
}

export function usedPpm(quota: CursorQuotaSnapshot): number {
  return Math.round(Math.max(quota.includedUsedPercent, quota.fastUsedPercent) * 10_000);
}

function asRecord(raw: unknown): Readonly<Record<string, unknown>> {
  if (!raw || typeof raw !== "object") return {};
  return raw as Record<string, unknown>;
}

function numberField(record: Readonly<Record<string, unknown>>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

function stringField(record: Readonly<Record<string, unknown>>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function booleanField(record: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return false;
}
