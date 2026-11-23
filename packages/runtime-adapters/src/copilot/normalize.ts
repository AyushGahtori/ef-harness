import { CopilotAdapterError } from "./errors.js";
import type { AccountQuotaSnapshot, BillingMode, NormalizedUsage } from "./types.js";

export interface MetricFields {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly premiumRequests: number;
  readonly partial_interrupted: boolean;
}

export function normalizeSessionMetrics(raw: unknown, partialInterrupted: boolean): MetricFields {
  const record = asRecord(raw);
  return {
    inputTokens: finiteNumber(record?.inputTokens),
    outputTokens: finiteNumber(record?.outputTokens),
    cachedInputTokens: finiteNumber(record?.cachedInputTokens ?? record?.cacheReadTokens),
    cacheCreationInputTokens: finiteNumber(
      record?.cacheCreationInputTokens ?? record?.cacheWriteTokens,
    ),
    reasoningTokens: finiteNumber(record?.reasoningTokens),
    premiumRequests: finiteNumber(record?.premiumRequests ?? record?.premiumRequestMultiplier),
    partial_interrupted: partialInterrupted,
  };
}

export async function readSessionMetrics(
  session: { readonly usage: { getMetrics(): Promise<unknown> } },
  partialInterrupted: boolean,
): Promise<MetricFields> {
  try {
    const raw = await session.usage.getMetrics();
    return normalizeSessionMetrics(raw, partialInterrupted);
  } catch (error) {
    if (error instanceof TypeError) return normalizeSessionMetrics(undefined, true);
    throw error;
  }
}

export function normalizeAccountQuota(raw: unknown): AccountQuotaSnapshot {
  const record = asRecord(raw);
  const nested = asRecord(record?.quotaSnapshots);
  const premium = asRecord(nested?.premiumInteractions);
  const source = premium ?? record;
  if (!source) {
    throw new CopilotAdapterError("quota_malformed", "account.getQuota returned an empty payload");
  }
  const entitlement = finiteOrNull(source.entitlement) ?? finiteOrNull(source.entitled);
  const used = finiteOrNull(source.used);
  const remaining =
    finiteOrNull(source.remaining) ??
    (entitlement !== null && used !== null ? entitlement - used : null);
  if (remaining === null) {
    throw new CopilotAdapterError("quota_malformed", "account.getQuota omitted remaining");
  }
  const entitled = entitlement ?? remaining;
  const percent =
    finiteOrNull(source.percentRemaining) ??
    finiteOrNull(source.remainingPercentage) ??
    (entitled === 0 ? 0 : (remaining / entitled) * 100);
  const reset = text(source.resetDateUtc) ?? text(source.resetDate);
  if (!reset) {
    throw new CopilotAdapterError("quota_malformed", "account.getQuota omitted resetDateUtc");
  }
  const overage = bool(source.overageEnabled) ?? bool(source.overagePermitted) ?? false;
  return {
    entitlement: entitled,
    remaining,
    percentRemaining: percent,
    resetDateUtc: reset,
    overageEnabled: overage,
  };
}

export function emptyUsage(billingMode: BillingMode, partialInterrupted: boolean): NormalizedUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    premiumRequests: 0,
    costMicroUsd: billingMode === "byok_api_key" ? 0 : null,
    billingMode,
    partial_interrupted: partialInterrupted,
    subscriptionQuotaApplies: billingMode === "copilot_subscription",
    byokConnectionId: null,
    explicitOverageApproval: false,
    quota: null,
  };
}

export function isBadCredentials(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  if (record.status === 401 || record.statusCode === 401) return true;
  const message = error instanceof Error ? error.message : text(record.message) ?? "";
  return /bad credentials/i.test(message);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown): number {
  return finiteOrNull(value) ?? 0;
}

function finiteOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
