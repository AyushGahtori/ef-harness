import { assertNonNegativeInteger } from "./currency-port.js";

/** Integer token counts plus optional micro-USD cost. Never a binary float. */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly costMicroUsd: number | null;
}

export function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    costMicroUsd: null,
  };
}

export function tokenUsage(
  patch: Partial<TokenUsage> & { costMicroUsd?: number | null },
): TokenUsage {
  const base = emptyTokenUsage();
  const next = mergeTokenUsage(base, patch);
  return next;
}

export function mergeTokenUsage(
  base: TokenUsage,
  patch: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cacheCreationInputTokens?: number;
    readonly cacheReadInputTokens?: number;
    readonly reasoningTokens?: number;
    readonly totalTokens?: number;
    readonly costMicroUsd?: number | null;
  },
): TokenUsage {
  const merged: TokenUsage = {
    inputTokens: patch.inputTokens ?? base.inputTokens,
    outputTokens: patch.outputTokens ?? base.outputTokens,
    cacheCreationInputTokens: patch.cacheCreationInputTokens ?? base.cacheCreationInputTokens,
    cacheReadInputTokens: patch.cacheReadInputTokens ?? base.cacheReadInputTokens,
    reasoningTokens: patch.reasoningTokens ?? base.reasoningTokens,
    totalTokens: patch.totalTokens ?? base.totalTokens,
    costMicroUsd: patch.costMicroUsd === undefined ? base.costMicroUsd : patch.costMicroUsd,
  };
  assertUsage(merged);
  return merged;
}

export function assertUsage(usage: TokenUsage): TokenUsage {
  assertNonNegativeInteger(usage.inputTokens, "inputTokens");
  assertNonNegativeInteger(usage.outputTokens, "outputTokens");
  assertNonNegativeInteger(usage.cacheCreationInputTokens, "cacheCreationInputTokens");
  assertNonNegativeInteger(usage.cacheReadInputTokens, "cacheReadInputTokens");
  assertNonNegativeInteger(usage.reasoningTokens, "reasoningTokens");
  assertNonNegativeInteger(usage.totalTokens, "totalTokens");
  if (usage.costMicroUsd !== null) {
    assertNonNegativeInteger(usage.costMicroUsd, "costMicroUsd");
  }
  return usage;
}

export function readIntegerField(record: unknown, key: string): number | null {
  if (record === null || typeof record !== "object") return null;
  const value = (record as Record<string, unknown>)[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

export function estimateOutputTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
