import { ApiKeyOnboardingError, type CustomRateTable } from "./api-key-types.js";

const SCALE = 1_000_000n;
const HALF = SCALE / 2n;

export function asNonNegativeBigInt(value: bigint, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n) {
    throw new ApiKeyOnboardingError(`${label} must be a non-negative integer`);
  }
  return value;
}

/** Integer micro-USD for `tokens` at a per-1M rate. Half-up, no floating point. */
export function microUsdForTokens(tokens: bigint, microUsdPer1M: bigint): bigint {
  const safeTokens = asNonNegativeBigInt(tokens, "token count");
  const safeRate = asNonNegativeBigInt(microUsdPer1M, "micro-USD rate");
  return (safeTokens * safeRate + HALF) / SCALE;
}

export function assertRateTable(rates: CustomRateTable): CustomRateTable {
  return {
    inputMicroUsdPer1M: asNonNegativeBigInt(rates.inputMicroUsdPer1M, "inputMicroUsdPer1M"),
    outputMicroUsdPer1M: asNonNegativeBigInt(rates.outputMicroUsdPer1M, "outputMicroUsdPer1M"),
    cachedInputReadMicroUsdPer1M: asNonNegativeBigInt(
      rates.cachedInputReadMicroUsdPer1M,
      "cachedInputReadMicroUsdPer1M",
    ),
    cacheWriteMicroUsdPer1M: asNonNegativeBigInt(rates.cacheWriteMicroUsdPer1M, "cacheWriteMicroUsdPer1M"),
    reasoningTokenMicroUsdPer1M: asNonNegativeBigInt(
      rates.reasoningTokenMicroUsdPer1M,
      "reasoningTokenMicroUsdPer1M",
    ),
  };
}

export function rateTableIsZero(rates: CustomRateTable): boolean {
  return (
    rates.inputMicroUsdPer1M === 0n &&
    rates.outputMicroUsdPer1M === 0n &&
    rates.cachedInputReadMicroUsdPer1M === 0n &&
    rates.cacheWriteMicroUsdPer1M === 0n &&
    rates.reasoningTokenMicroUsdPer1M === 0n
  );
}

export function decimalDollarsToMicroUsd(decimal: string): bigint {
  const trimmed = decimal.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new ApiKeyOnboardingError(
      "Provider-reported cost must be a non-negative decimal dollar string",
    );
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const wholeDigits = whole ?? "0";
  const frac6 = `${fraction}000000`.slice(0, 6);
  const roundDigit = fraction.length > 6 ? fraction[6] : undefined;
  let micro = BigInt(wholeDigits) * SCALE + BigInt(frac6);
  if (roundDigit !== undefined && roundDigit >= "5") {
    micro += 1n;
  }
  return micro;
}
