/**
 * Local port of Task 010 integer currency helpers.
 * Swap `usdToMicroUnits` for the shared-contracts export once that task is on the base.
 * Scale is 1_000_000 micro-USD per dollar. Parsing uses BigInt digit strings, never binary floats.
 */

const MICRO_SCALE = 1_000_000n;

export class CurrencyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurrencyParseError";
  }
}

export function usdToMicroUnits(decimal: string): number {
  const trimmed = decimal.trim().replace(/^\$/, "");
  if (trimmed.length === 0 || /e/i.test(trimmed)) {
    throw new CurrencyParseError(`unsupported USD amount "${decimal}"`);
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  const whole = match?.[1];
  if (!match || whole === undefined) {
    throw new CurrencyParseError(`unsupported USD amount "${decimal}"`);
  }
  const fraction = match[2] ?? "";
  if (fraction.length > 6) {
    throw new CurrencyParseError(`sub-micro USD precision in "${decimal}"`);
  }
  const padded = fraction.padEnd(6, "0");
  const micro = BigInt(whole) * MICRO_SCALE + BigInt(padded.length === 0 ? "0" : padded);
  if (micro > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CurrencyParseError(`USD amount overflows a safe integer: "${decimal}"`);
  }
  return Number(micro);
}

export function assertSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new CurrencyParseError(`${label} must be a safe integer`);
  }
  return value;
}

export function assertNonNegativeInteger(value: number, label: string): number {
  assertSafeInteger(value, label);
  if (value < 0) {
    throw new CurrencyParseError(`${label} must be >= 0`);
  }
  return value;
}
