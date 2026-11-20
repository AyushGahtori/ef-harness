import { LedgerInputError } from "./errors.js";
import type { BudgetRemainingRow, ScopeKind, ThresholdCrossedEvent } from "./types.js";

const THRESHOLDS = [
  { percent: 50 as const, level: "alert" as const, stopNewDispatches: false, keepCheckpointReserve: false, parkAttempts: false },
  { percent: 80 as const, level: "alert" as const, stopNewDispatches: false, keepCheckpointReserve: false, parkAttempts: false },
  { percent: 90 as const, level: "wind_down" as const, stopNewDispatches: true, keepCheckpointReserve: true, parkAttempts: false },
  { percent: 100 as const, level: "stopped" as const, stopNewDispatches: true, keepCheckpointReserve: false, parkAttempts: true },
];

export function thresholdsFromRemaining(rows: readonly BudgetRemainingRow[]): ThresholdCrossedEvent[] {
  const events: ThresholdCrossedEvent[] = [];
  for (const row of rows) {
    const used = BigInt(row.spentUnits) + BigInt(row.reservedUnits);
    for (const threshold of THRESHOLDS) {
      if (!reached(row.limitUnits, used, threshold.percent)) continue;
      events.push({
        scopeKind: row.scopeKind,
        scopeId: row.scopeId,
        currency: row.currency,
        thresholdPercent: threshold.percent,
        level: threshold.level,
        stopNewDispatches: threshold.stopNewDispatches,
        keepCheckpointReserve: threshold.keepCheckpointReserve,
        parkAttempts: threshold.parkAttempts,
        limitUnits: row.limitUnits,
        reservedUnits: row.reservedUnits,
        spentUnits: row.spentUnits,
        remainingUnits: row.remainingUnits,
        overrun: row.overrun,
      });
    }
  }
  return events;
}

function reached(limitUnits: number, used: bigint, percent: number): boolean {
  if (limitUnits === 0) return true;
  return used * 100n >= BigInt(limitUnits) * BigInt(percent);
}

export function assertScopeKind(value: string): asserts value is ScopeKind {
  if (
    value !== "project" &&
    value !== "feature" &&
    value !== "task" &&
    value !== "wave_paperwork" &&
    value !== "grant"
  ) {
    throw new LedgerInputError(`Unexpected budget scope kind ${value}`);
  }
}
