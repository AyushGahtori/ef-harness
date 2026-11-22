import type { ModelMicroUsdRates } from "./api-key-types.js";

export const BUNDLED_PRICE_TABLE_VERSION = "2026.11";

const BUNDLED: readonly ModelMicroUsdRates[] = [
  rates("claude-sonnet", "anthropic", 3_000_000n, 15_000_000n, 300_000n, 3_750_000n, 15_000_000n),
  rates("claude-opus", "anthropic", 15_000_000n, 75_000_000n, 1_500_000n, 18_750_000n, 75_000_000n),
  rates("gpt-5.1", "openai", 2_500_000n, 10_000_000n, 250_000n, 2_500_000n, 10_000_000n),
  rates("gpt-5.1-mini", "openai", 250_000n, 2_000_000n, 25_000n, 250_000n, 2_000_000n),
  rates("gemini-2.5-pro", "gemini", 1_250_000n, 10_000_000n, 312_500n, 1_250_000n, 10_000_000n),
  rates("openrouter-auto", "openrouter", 1_000_000n, 3_000_000n, 100_000n, 1_000_000n, 3_000_000n),
];

export function bundledPriceModels(): ModelMicroUsdRates[] {
  return BUNDLED.map((row) => ({ ...row }));
}

function rates(
  modelId: string,
  provider: ModelMicroUsdRates["provider"],
  inputMicroUsdPer1M: bigint,
  outputMicroUsdPer1M: bigint,
  cachedInputReadMicroUsdPer1M: bigint,
  cacheWriteMicroUsdPer1M: bigint,
  reasoningTokenMicroUsdPer1M: bigint,
): ModelMicroUsdRates {
  return {
    modelId,
    provider,
    inputMicroUsdPer1M,
    outputMicroUsdPer1M,
    cachedInputReadMicroUsdPer1M,
    cacheWriteMicroUsdPer1M,
    reasoningTokenMicroUsdPer1M,
  };
}
