import { CrewLevelsError } from "./errors.js";
import { assertNonNegativeMoney, assertSafeCount } from "./money.js";
import type { ModelRosterEntry, TokenEstimate } from "./types.js";
import { MICRO_USD_SCALE } from "./types.js";

export function estimateUnitCost(
  entry: ModelRosterEntry,
  tokens: TokenEstimate,
): bigint {
  assertSafeCount(tokens.inputTokens, "inputTokens");
  assertSafeCount(tokens.outputTokens, "outputTokens");
  assertSafeCount(tokens.cachedInputTokens, "cachedInputTokens");
  if (tokens.cachedInputTokens > tokens.inputTokens) {
    throw new CrewLevelsError(
      "bad-task",
      "cached input tokens cannot exceed input tokens",
    );
  }
  if (entry.spendKind === "subscription") {
    const volume = BigInt(tokens.inputTokens + tokens.outputTokens);
    return (entry.allowancePpmPer1M * volume) / MICRO_USD_SCALE;
  }
  const uncached = BigInt(tokens.inputTokens - tokens.cachedInputTokens);
  const cached = BigInt(tokens.cachedInputTokens);
  const output = BigInt(tokens.outputTokens);
  const micro =
    uncached * entry.inputMicroUsdPer1M +
    cached * entry.cachedInputMicroUsdPer1M +
    output * entry.outputMicroUsdPer1M;
  assertNonNegativeMoney(micro, "token cost");
  return micro / MICRO_USD_SCALE;
}
