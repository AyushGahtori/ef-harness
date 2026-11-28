const SCALE = 1_000_000n;
const HALF = SCALE / 2n;

export function microUsdForTokens(tokens: bigint, microUsdPer1M: bigint): bigint {
  if (tokens < 0n || microUsdPer1M < 0n) {
    throw new Error("token rates must be non-negative");
  }
  return (tokens * microUsdPer1M + HALF) / SCALE;
}

export function decimalDollarsToMicroUsd(decimal: string): bigint {
  const trimmed = decimal.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("cost must be a non-negative decimal dollar amount");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const wholeDigits = whole ?? "0";
  const frac6 = `${fraction}000000`.slice(0, 6);
  const roundDigit = fraction.length > 6 ? fraction[6] : undefined;
  let micro = BigInt(wholeDigits) * SCALE + BigInt(frac6);
  if (roundDigit !== undefined && roundDigit >= "5") micro += 1n;
  return micro;
}

/** Dollar flag for `--max-budget-usd`. 500000 micro-USD becomes `0.50`. */
export function formatBudgetUsd(microUsd: bigint): string {
  if (microUsd <= 0n) {
    throw new Error("budget ceiling must be a positive micro-USD amount");
  }
  const whole = microUsd / SCALE;
  let digits = (microUsd % SCALE).toString().padStart(6, "0");
  while (digits.length > 2 && digits.endsWith("0")) digits = digits.slice(0, -1);
  return `${whole.toString()}.${digits}`;
}

export interface TokenQuoteInput {
  readonly inputTokens: bigint;
  readonly outputTokens: bigint;
  readonly cacheReadInputTokens: bigint;
  readonly cacheCreationInputTokens: bigint;
  readonly inputMicroUsdPer1M: bigint;
  readonly outputMicroUsdPer1M: bigint;
  readonly cacheReadMicroUsdPer1M: bigint;
  readonly cacheCreationMicroUsdPer1M: bigint;
}

export function quoteTokenMicroUsd(input: TokenQuoteInput): bigint {
  return (
    microUsdForTokens(input.inputTokens, input.inputMicroUsdPer1M) +
    microUsdForTokens(input.outputTokens, input.outputMicroUsdPer1M) +
    microUsdForTokens(input.cacheReadInputTokens, input.cacheReadMicroUsdPer1M) +
    microUsdForTokens(input.cacheCreationInputTokens, input.cacheCreationMicroUsdPer1M)
  );
}
