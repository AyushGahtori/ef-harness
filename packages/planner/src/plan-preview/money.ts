import { PlanPreviewError } from "./errors.js";
import type { ConnectionKind } from "./types.js";

export function formatUsd(microUsd: bigint): string {
  const negative = microUsd < 0n;
  const abs = negative ? -microUsd : microUsd;
  const cents = (abs + 5_000n) / 10_000n;
  const dollars = cents / 100n;
  const remainder = cents % 100n;
  const text = `$${dollars.toString()}.${remainder.toString().padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

export function signedUsd(delta: bigint): string {
  const sign = delta < 0n ? "-" : "+";
  const abs = delta < 0n ? -delta : delta;
  return `${sign}${formatUsd(abs)}`;
}

export function formatUsdSpan(min: bigint, max: bigint): string {
  return `${formatUsd(min)}–${formatUsd(max)}`;
}

export function formatWindowPercent(ppm: number): string {
  if (!Number.isInteger(ppm)) {
    throw new PlanPreviewError("invalid_ppm", "Plan-window ppm must be an integer");
  }
  const negative = ppm < 0;
  const abs = Math.abs(ppm);
  const whole = Math.floor(abs / 10_000);
  const hundredths = Math.floor((abs % 10_000) / 100);
  const fraction = hundredths.toString().padStart(2, "0").replace(/0+$/, "");
  const body = fraction.length === 0 ? `${whole.toString()}%` : `${whole.toString()}.${fraction}%`;
  return negative ? `-${body}` : body;
}

export function signedWindowPercent(deltaPpm: number): string {
  const sign = deltaPpm < 0 ? "-" : "+";
  return `${sign}${formatWindowPercent(Math.abs(deltaPpm))} of 5-hour allowance`;
}

export function formatPercentSpan(minPpm: number, maxPpm: number): string {
  return `${formatWindowPercent(minPpm)}–${formatWindowPercent(maxPpm)}`;
}

/** API plans name published token rates. Subscription plans name the 5-hour allowance and never a dollar estimate. */
export function honestPointLabel(connection: ConnectionKind, microUsd: bigint, windowPpm: number): string {
  if (connection === "api") {
    return `Estimated ~${formatUsd(microUsd)} (from published token rates)`;
  }
  return `Estimated ~${formatWindowPercent(windowPpm)} of 5-hour allowance`;
}

export function honestShortLabel(connection: ConnectionKind, microUsd: bigint, windowPpm: number): string {
  if (connection === "api") return `~${formatUsd(microUsd)}`;
  return `~${formatWindowPercent(windowPpm)} of 5-hour allowance`;
}

export function honestRangeLabel(
  connection: ConnectionKind,
  microMin: bigint,
  microMax: bigint,
  ppmMin: number,
  ppmMax: number,
): string {
  if (connection === "api") {
    return `Estimated ~${formatUsdSpan(microMin, microMax)} (from published token rates)`;
  }
  return `Estimated ~${formatPercentSpan(ppmMin, ppmMax)} of 5-hour allowance`;
}

export function shortRangeLabel(
  connection: ConnectionKind,
  microMin: bigint,
  microMax: bigint,
  ppmMin: number,
  ppmMax: number,
): string {
  if (connection === "api") return formatUsdSpan(microMin, microMax);
  return `${formatPercentSpan(ppmMin, ppmMax)} of 5-hour allowance`;
}
