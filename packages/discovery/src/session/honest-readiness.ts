import type { ProjectStateDb } from "@ef-harness/db";
import { READINESS_COUNTS_SQL } from "../readiness/sql.js";
import { emptyForces, isReadyToPlan, type ReadinessCounts } from "../readiness/types.js";

/**
 * Exact basis counts for one work item. Headlines stay in the readiness
 * calculator; this snapshot never hides an unsettled blocker behind a percent.
 */
export interface HonestReadinessCounts {
  readonly explicitCount: number;
  readonly confirmedCount: number;
  readonly delegatedChosenForYouCount: number;
  readonly observedCount: number;
  readonly blockingUnsettledCount: number;
  readonly deferredCount: number;
  readonly readyToPlan: boolean;
}

export class HonestReadinessCalculator {
  constructor(private readonly stateDb: ProjectStateDb) {}

  snapshot(workItemId: string): HonestReadinessCounts {
    const forces = emptyForces();
    const row = asRecord(
      this.stateDb.writer.prepare(READINESS_COUNTS_SQL).get({
        work_item: workItemId,
        scope_id: null,
        force_pending: forces.pending,
        force_conflict: forces.conflict,
      }),
    );
    if (!row) throw new Error(`readiness counts missing for ${workItemId}`);
    const counts = countsFrom(row);
    return {
      explicitCount: counts.settledExplicit,
      confirmedCount: counts.settledDerived,
      delegatedChosenForYouCount: counts.chosenForYou,
      observedCount: counts.settledObserved,
      blockingUnsettledCount: counts.blockingCount,
      deferredCount: counts.deferred,
      readyToPlan: isReadyToPlan(counts, true) && counts.activeDenominator > 0,
    };
  }
}

function countsFrom(row: Record<string, unknown>): ReadinessCounts {
  return {
    settledExplicit: cell(row, "settled_explicit"),
    settledDerived: cell(row, "settled_derived"),
    settledDelegated: cell(row, "settled_delegated"),
    settledDefaulted: cell(row, "settled_defaulted"),
    settledObserved: cell(row, "settled_observed"),
    pendingVerification: cell(row, "pending_verification"),
    openMustAsk: cell(row, "open_must_ask"),
    openStandard: cell(row, "open_standard"),
    partial: cell(row, "partial"),
    missing: cell(row, "missing"),
    conflict: cell(row, "conflict"),
    deferred: cell(row, "deferred"),
    notApplicable: cell(row, "not_applicable"),
    activeDenominator: cell(row, "active_denominator"),
    settledTotal: cell(row, "settled_total"),
    chosenForYou: cell(row, "chosen_for_you"),
    criterionCount: cell(row, "criterion_count"),
    blockingCount: cell(row, "blocking_count"),
    nonMustAskPool: cell(row, "non_must_ask_pool"),
  };
}

function cell(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`expected a readiness count for ${key}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SQLite row was not an object");
  }
  return value as Record<string, unknown>;
}
