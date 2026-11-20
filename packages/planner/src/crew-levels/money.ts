import { CrewLevelsError } from "./errors.js";
import {
  type CostCurrency,
  PASS_PROBABILITY_MAX,
  PASS_PROBABILITY_MIN,
  PROBABILITY_SCALE,
} from "./types.js";

export interface CostAmount {
  readonly currency: CostCurrency;
  readonly amount: bigint;
}

export function assertNonNegativeMoney(amount: bigint, label: string): void {
  if (amount < 0n) {
    throw new CrewLevelsError("negative-money", `${label} cannot be negative`);
  }
}

export function probabilityMicro(probability: number): bigint {
  if (!Number.isFinite(probability) || probability <= 0 || probability > 1) {
    throw new CrewLevelsError(
      "bad-probability",
      "pass probability must be in (0, 1]",
    );
  }
  const micro = BigInt(Math.round(probability * Number(PROBABILITY_SCALE)));
  if (micro <= 0n) {
    throw new CrewLevelsError("bad-probability", "pass probability rounded to zero");
  }
  return micro > PROBABILITY_SCALE ? PROBABILITY_SCALE : micro;
}

export function clampPassProbability(probability: number): number {
  if (!Number.isFinite(probability)) return PASS_PROBABILITY_MIN;
  if (probability < PASS_PROBABILITY_MIN) return PASS_PROBABILITY_MIN;
  if (probability > PASS_PROBABILITY_MAX) return PASS_PROBABILITY_MAX;
  return probability;
}

export function sameLevelRetryCost(unitCost: bigint, passMicro: bigint): bigint {
  assertNonNegativeMoney(unitCost, "unit cost");
  if (passMicro <= 0n || passMicro > PROBABILITY_SCALE) {
    throw new CrewLevelsError("bad-probability", "pass probability is outside (0, 1]");
  }
  return (unitCost * PROBABILITY_SCALE) / passMicro;
}

export function cascadeExpectedCost(
  unitCost: bigint,
  passMicro: bigint,
  escalationCost: bigint,
): bigint {
  assertNonNegativeMoney(unitCost, "unit cost");
  assertNonNegativeMoney(escalationCost, "escalation cost");
  if (passMicro <= 0n || passMicro > PROBABILITY_SCALE) {
    throw new CrewLevelsError("bad-probability", "pass probability is outside (0, 1]");
  }
  const failMicro = PROBABILITY_SCALE - passMicro;
  return unitCost + (failMicro * escalationCost) / PROBABILITY_SCALE;
}

/**
 * Level choice minimizes `unit / P` plus the cost of escalating once to the
 * next level's unit price when this level fails.
 * The top of the ladder has no further escalation, so it is `unit / P`.
 */
export function levelExpectedCost(
  unitCost: bigint,
  passMicro: bigint,
  nextUnitCost: bigint | null,
): bigint {
  const retryCost = sameLevelRetryCost(unitCost, passMicro);
  if (nextUnitCost === null) return retryCost;
  assertNonNegativeMoney(nextUnitCost, "next unit cost");
  if (passMicro <= 0n || passMicro > PROBABILITY_SCALE) {
    throw new CrewLevelsError("bad-probability", "pass probability is outside (0, 1]");
  }
  const failMicro = PROBABILITY_SCALE - passMicro;
  return retryCost + (failMicro * nextUnitCost) / PROBABILITY_SCALE;
}

export function compareExpectedCost(left: CostAmount, right: CostAmount): number {
  if (left.currency !== right.currency) {
    throw new CrewLevelsError(
      "currency-mix",
      "micro-USD and ppm stay in separate pools and are never compared",
    );
  }
  if (left.amount < right.amount) return -1;
  if (left.amount > right.amount) return 1;
  return 0;
}

export function formatMicroUsd(micro: bigint): string {
  assertNonNegativeMoney(micro, "micro-USD");
  const milliUnits = (micro + 500n) / 1_000n;
  const dollars = milliUnits / 1_000n;
  const milli = (milliUnits % 1_000n).toString().padStart(3, "0");
  const trimmed = milli.replace(/0+$/, "");
  const decimals = trimmed.length >= 2 ? trimmed : trimmed.padEnd(2, "0");
  return `$${dollars.toString()}.${decimals}`;
}

export function formatPpm(ppm: bigint): string {
  assertNonNegativeMoney(ppm, "ppm");
  return `${ppm.toString()} ppm`;
}

export function formatCost(currency: CostCurrency, amount: bigint): string {
  return currency === "micro-usd" ? formatMicroUsd(amount) : formatPpm(amount);
}

export function percentLabel(probability: number): string {
  const clamped = clampPassProbability(probability);
  const pct = Math.round(clamped * 100);
  return `${pct.toString()}%`;
}

export function assertSafeCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CrewLevelsError("bad-task", `${label} must be a non-negative integer`);
  }
}
