import {
  LADDER_STEPS,
  METER_COLOR_50,
  type CurrencyKind,
  type CurrencySnapshot,
  type LadderReading,
  type LadderStep,
  type MeterTone,
  type TopBarMeter,
} from "./types.js";

const STEP_RANK: Record<LadderStep, number> = {
  below: 0,
  info_50: 1,
  warning_80: 2,
  wind_down_90: 3,
  hard_stop_100: 4,
};

export function assertSafeUnit(units: number, label: string): void {
  if (!Number.isSafeInteger(units) || units < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

export function stepRank(step: LadderStep): number {
  return STEP_RANK[step];
}

export function stricterStep(left: LadderStep, right: LadderStep): LadderStep {
  return stepRank(left) >= stepRank(right) ? left : right;
}

export function percentOf(used: number, limit: number): number {
  if (limit <= 0) return 100;
  return Number((BigInt(used) * 100n) / BigInt(limit));
}

export function stepFor(used: number, limit: number): LadderStep {
  if (limit <= 0) return "hard_stop_100";
  const usedUnits = BigInt(used);
  const limitUnits = BigInt(limit);
  if (usedUnits >= limitUnits) return "hard_stop_100";
  if (usedUnits * 10n >= limitUnits * 9n) return "wind_down_90";
  if (usedUnits * 5n >= limitUnits * 4n) return "warning_80";
  if (usedUnits * 2n >= limitUnits) return "info_50";
  return "below";
}

export function subscriptionWindDown(usedPpm: number): boolean {
  return usedPpm >= 900_000;
}

export function formatMicroUsd(units: number): string {
  assertSafeUnit(Math.abs(units) === units ? units : 0, "micro-USD");
  if (!Number.isSafeInteger(units)) {
    throw new Error("micro-USD must be an integer");
  }
  const negative = units < 0;
  const abs = negative ? -units : units;
  let dollars = Math.trunc(abs / 1_000_000);
  const micros = abs % 1_000_000;
  let cents = Math.trunc((micros + 5_000) / 10_000);
  if (cents >= 100) {
    dollars += Math.trunc(cents / 100);
    cents %= 100;
  }
  const body = `${dollars}.${cents.toString().padStart(2, "0")}`;
  return negative ? `-$${body}` : `$${body}`;
}

export function formatGrouped(units: number): string {
  assertSafeUnit(units, "units");
  return new Intl.NumberFormat("en-US").format(units);
}

export function usageLine(currency: CurrencyKind, spent: number, limit: number): string {
  const percent = percentOf(spent, limit);
  if (currency === "micro-usd") {
    return `${percent}% of budget used — ${formatMicroUsd(spent)} / ${formatMicroUsd(limit)}`;
  }
  return `${percent}% of allowance used — ${formatGrouped(spent)} / ${formatGrouped(limit)} ppm`;
}

export function paidSwitchConfirmation(label: string, estimateMicroUsd: number, remainingTasks: number): string {
  const noun = remainingTasks === 1 ? "task" : "tasks";
  return `${label} is pay-per-use (~${formatMicroUsd(estimateMicroUsd)} est. for remaining ${remainingTasks} ${noun}) — Confirm?`;
}

export function meterFor(step: LadderStep, percent: number, interruptionCount: number): TopBarMeter {
  const palette: Record<LadderStep, { readonly tone: MeterTone; readonly color: string }> = {
    below: { tone: "neutral", color: "#D5D8DE" },
    info_50: { tone: "soft-blue-neutral", color: METER_COLOR_50 },
    warning_80: { tone: "early-warning", color: "#E2C58B" },
    wind_down_90: { tone: "wind-down", color: "#D08A4C" },
    hard_stop_100: { tone: "hard-stop", color: "#B5524A" },
  };
  const tone = palette[step];
  return {
    tone: tone.tone,
    color: tone.color,
    percent,
    interruptionCount,
  };
}

export function readingFromSides(sides: readonly CurrencySnapshot[]): LadderReading {
  let step: LadderStep = "below";
  let percent = 0;
  for (const side of sides) {
    step = stricterStep(step, side.step);
    if (side.percent > percent) percent = side.percent;
  }
  return { step, percent, sides };
}

export function isKnownStep(value: string): value is LadderStep {
  return (LADDER_STEPS as readonly string[]).includes(value);
}

export function formatCountdown(remainingMs: number): string {
  const safe = remainingMs > 0 ? remainingMs : 0;
  const totalMinutes = Math.floor(safe / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const LEVEL_RANK: Record<"junior" | "mid" | "senior" | "principal", number> = {
  junior: 0,
  mid: 1,
  senior: 2,
  principal: 3,
};

const SENIOR_FLOOR = new Set([
  "auth",
  "payments",
  "migrations",
  "destructive",
  "expand-contract",
  "cross-feature-conflict",
  "oracle-author@1",
]);

const STICKER_MICRO_USD = {
  junior: 20_000,
  mid: 80_000,
  senior: 200_000,
  principal: 500_000,
} as const;

export function floorForSafetyClass(safetyClass: string | null): "junior" | "mid" | "senior" | "principal" {
  if (safetyClass !== null && SENIOR_FLOOR.has(safetyClass)) return "senior";
  return "junior";
}

export function cheapestLevelAtFloor(floor: "junior" | "mid" | "senior" | "principal"): "junior" | "mid" | "senior" | "principal" {
  return floor;
}

export function levelRank(level: "junior" | "mid" | "senior" | "principal"): number {
  return LEVEL_RANK[level];
}

export function stickerMicroUsd(level: "junior" | "mid" | "senior" | "principal"): number {
  return STICKER_MICRO_USD[level];
}

export function isOptionalAdvisoryRole(role: string): boolean {
  return role === "taste-reviewer@1";
}
