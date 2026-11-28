import { MICRO_USD_SCALE, WIND_DOWN_RATIO } from "./constants.js";
import { OpenRouterLocalError } from "./errors.js";

export function usdToMicroUsd(value: number): number {
  if (!Number.isFinite(value)) {
    throw new OpenRouterLocalError("bad-money", "USD amount is not finite");
  }
  const negative = value < 0;
  const [whole = "0", frac = ""] = Math.abs(value).toFixed(6).split(".");
  const micro = Number(whole) * MICRO_USD_SCALE + Number(frac.padEnd(6, "0").slice(0, 6));
  if (!Number.isSafeInteger(micro)) {
    throw new OpenRouterLocalError("bad-money", "USD amount is out of range");
  }
  return negative ? -micro : micro;
}

export function formatUsdFromMicro(micro: number): string {
  if (!Number.isSafeInteger(micro)) {
    throw new OpenRouterLocalError("bad-money", "micro-USD amount is out of range");
  }
  const negative = micro < 0;
  const abs = Math.abs(micro);
  const dollars = Math.trunc(abs / MICRO_USD_SCALE);
  const cents = Math.trunc((abs % MICRO_USD_SCALE) / 10_000);
  const body = `${dollars}.${String(cents).padStart(2, "0")}`;
  return negative ? `-$${body}` : `$${body}`;
}

export function formatUsd(amount: number): string {
  return formatUsdFromMicro(usdToMicroUsd(amount));
}

export function openRouterRemainingDisplay(remainingUsd: number): string {
  return `${formatUsd(remainingUsd)} remaining on OpenRouter key`;
}

export function windDownStartsAtMicroUsd(limitMicroUsd: number): number {
  if (!Number.isSafeInteger(limitMicroUsd) || limitMicroUsd < 0) {
    throw new OpenRouterLocalError("bad-money", "credit limit must be a non-negative integer");
  }
  return Math.floor(limitMicroUsd * WIND_DOWN_RATIO);
}

export function maskLastFour(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return trimmed;
  return trimmed.slice(-4);
}
