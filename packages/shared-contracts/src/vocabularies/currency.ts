import { z } from "zod";

/** Stored units per display dollar, and ppm in one full window share. */
export const USD_MICRO_SCALE = 1_000_000 as const;
export const WINDOW_SHARE_PPM_SCALE = 1_000_000 as const;
/** 100 percent of a window is `WINDOW_SHARE_PPM_SCALE` ppm. */
export const PERCENT_TO_PPM_FACTOR = 10_000 as const;

export const CURRENCY_UNITS = {
  usd: { code: "usd", unit: "micro-USD", scale: USD_MICRO_SCALE },
  allowance: { unit: "ppm of window share", scale: WINDOW_SHARE_PPM_SCALE },
  slotsLocal: { code: "slots:local", unit: "slot", scale: 1 },
} as const;

const CURRENCY_CODE_PATTERN = /^(?:usd|slots:local|allowance:[A-Za-z0-9][A-Za-z0-9._:-]*)$/u;

export const CurrencyCodeSchema = z.string().regex(CURRENCY_CODE_PATTERN);

export type CurrencyCode = "usd" | "slots:local" | `allowance:${string}`;

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && CURRENCY_CODE_PATTERN.test(value);
}

export type IntegerUnitErrorCode = "invalid_format" | "negative" | "sub_unit" | "overflow";

export class IntegerUnitError extends Error {
  readonly code: IntegerUnitErrorCode;
  readonly unit: string;

  constructor(code: IntegerUnitErrorCode, unit: string, message: string) {
    super(message);
    this.name = "IntegerUnitError";
    this.code = code;
    this.unit = unit;
  }
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const DECIMAL_AMOUNT = /^([+-])?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/u;

type UnitName = "micro-USD" | "ppm";

function fail(code: IntegerUnitErrorCode, unit: UnitName, message: string): never {
  throw new IntegerUnitError(code, unit, message);
}

function subUnitMessage(unit: UnitName): string {
  return unit === "micro-USD" ? "sub-micro precision overflow" : "sub-ppm precision overflow";
}

function parseExponent(raw: string, unit: UnitName): number {
  const exponentMatch = /^([+-])?(\d+)$/u.exec(raw);
  const digits = exponentMatch?.[2];
  if (!exponentMatch || digits === undefined) {
    fail("invalid_format", unit, `Invalid ${unit} exponent`);
  }
  if (digits.length > 6) {
    fail(
      exponentMatch[1] === "-" ? "sub_unit" : "overflow",
      unit,
      `${unit} exponent is out of range`,
    );
  }
  let magnitude = 0;
  for (const char of digits) {
    magnitude = magnitude * 10 + (char.charCodeAt(0) - 48);
  }
  return exponentMatch[1] === "-" ? -magnitude : magnitude;
}

function scaleCoefficient(coef: bigint, exp10: number, scale: bigint, unit: UnitName): bigint {
  if (coef === 0n) return 0n;
  const numerator = coef * scale;
  if (exp10 === 0) {
    if (numerator > MAX_SAFE) fail("overflow", unit, `${unit} exceeds a safe integer`);
    return numerator;
  }
  if (exp10 > 0) {
    if (exp10 > 18) fail("overflow", unit, `${unit} exceeds a safe integer`);
    const scaled = numerator * 10n ** BigInt(exp10);
    if (scaled > MAX_SAFE) fail("overflow", unit, `${unit} exceeds a safe integer`);
    return scaled;
  }
  const places = -exp10;
  if (places > 256) fail("sub_unit", unit, subUnitMessage(unit));
  const divisor = 10n ** BigInt(places);
  if (numerator % divisor !== 0n) fail("sub_unit", unit, subUnitMessage(unit));
  const scaled = numerator / divisor;
  if (scaled > MAX_SAFE) fail("overflow", unit, `${unit} exceeds a safe integer`);
  return scaled;
}

function parseDecimalToScaled(
  input: string,
  scale: number,
  unit: UnitName,
  allowDollarPrefix: boolean,
): number {
  if (typeof input !== "string") {
    fail("invalid_format", unit, `${unit} amount must be a decimal string`);
  }
  let text = input.trim();
  if (text.length === 0 || text.length > 128) {
    fail("invalid_format", unit, `Invalid ${unit} amount`);
  }
  if (allowDollarPrefix && text.startsWith("$")) {
    text = text.slice(1).trim();
  }
  if (text.includes("$") || text.includes(",") || text.includes("_") || /\s/u.test(text)) {
    fail("invalid_format", unit, `Invalid ${unit} amount`);
  }
  const parsed = DECIMAL_AMOUNT.exec(text);
  if (!parsed) {
    fail("invalid_format", unit, `Invalid ${unit} amount`);
  }
  if (parsed[1] === "-") {
    fail("negative", unit, `Negative ${unit} values are rejected`);
  }
  const whole = parsed[2] ?? "0";
  const fraction = parsed[3] ?? parsed[4] ?? "";
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/u, "");
  const coef = BigInt(digits.length === 0 ? "0" : digits);
  if (coef === 0n) return 0;
  const exponent = parsed[5] === undefined ? 0 : parseExponent(parsed[5], unit);
  if (exponent > 24) fail("overflow", unit, `${unit} exceeds a safe integer`);
  if (exponent < -24) fail("sub_unit", unit, subUnitMessage(unit));
  const exp10 = exponent - fraction.length;
  return Number(scaleCoefficient(coef, exp10, BigInt(scale), unit));
}

function formatScaled(units: number, scale: number, unit: UnitName): string {
  if (typeof units !== "number" || !Number.isSafeInteger(units)) {
    fail("invalid_format", unit, `${unit} display requires a safe integer`);
  }
  if (units < 0) {
    fail("negative", unit, `Negative ${unit} values are rejected`);
  }
  const scaleBig = BigInt(scale);
  const amount = BigInt(units);
  const whole = amount / scaleBig;
  const fraction = amount % scaleBig;
  if (fraction === 0n) return whole.toString();
  const width = scale.toString().length - 1;
  const digits = fraction.toString().padStart(width, "0").replace(/0+$/u, "");
  return `${whole.toString()}.${digits}`;
}

export function usdToMicroUnits(amount: string): number {
  return parseDecimalToScaled(amount, USD_MICRO_SCALE, "micro-USD", true);
}

export function microUnitsToUsdDisplay(microUnits: number): string {
  return formatScaled(microUnits, USD_MICRO_SCALE, "micro-USD");
}

export function percentToPpm(percent: string): number {
  return parseDecimalToScaled(percent, PERCENT_TO_PPM_FACTOR, "ppm", false);
}

export function ppmToPercentDisplay(ppm: number): string {
  return formatScaled(ppm, PERCENT_TO_PPM_FACTOR, "ppm");
}
