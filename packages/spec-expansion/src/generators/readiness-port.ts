/**
 * Local port of Task 074 `ReadinessCalculator`.
 * The sibling branch is not merged. This port applies the same boolean gate
 * (`isReadyToPlan`) from exact integer counts. It does not query
 * `discovery_scopes` / `schema/queries.sql`; integration should swap in the
 * Task 074 SQL aggregator.
 */

export interface ReadinessCounts {
  readonly settledExplicit: number;
  readonly settledDerived: number;
  readonly settledDelegated: number;
  readonly settledDefaulted: number;
  readonly pendingVerification: number;
  readonly openMustAsk: number;
  readonly openStandard: number;
  readonly partial: number;
  readonly missing: number;
  readonly conflict: number;
  readonly deferred: number;
  readonly notApplicable: number;
  readonly activeDenominator: number;
  readonly transitivePrereqsMet: boolean;
}

export interface ReadinessSnapshot {
  readonly isReadyToPlan: boolean;
  readonly counts: ReadinessCounts;
}

export function readyReadiness(): ReadinessCounts {
  return {
    settledExplicit: 0,
    settledDerived: 0,
    settledDelegated: 0,
    settledDefaulted: 0,
    pendingVerification: 0,
    openMustAsk: 0,
    openStandard: 0,
    partial: 0,
    missing: 0,
    conflict: 0,
    deferred: 0,
    notApplicable: 0,
    activeDenominator: 0,
    transitivePrereqsMet: true,
  };
}

function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`ReadinessCalculator count ${name} must be a non-negative integer`);
  }
}

export class LocalReadinessCalculator {
  calculate(counts: ReadinessCounts): ReadinessSnapshot {
    assertCount("settledExplicit", counts.settledExplicit);
    assertCount("settledDerived", counts.settledDerived);
    assertCount("settledDelegated", counts.settledDelegated);
    assertCount("settledDefaulted", counts.settledDefaulted);
    assertCount("pendingVerification", counts.pendingVerification);
    assertCount("openMustAsk", counts.openMustAsk);
    assertCount("openStandard", counts.openStandard);
    assertCount("partial", counts.partial);
    assertCount("missing", counts.missing);
    assertCount("conflict", counts.conflict);
    assertCount("deferred", counts.deferred);
    assertCount("notApplicable", counts.notApplicable);
    assertCount("activeDenominator", counts.activeDenominator);
    const isReadyToPlan =
      counts.openMustAsk === 0 &&
      counts.conflict === 0 &&
      counts.pendingVerification === 0 &&
      counts.openStandard === 0 &&
      counts.partial === 0 &&
      counts.missing === 0 &&
      counts.transitivePrereqsMet === true;
    return { isReadyToPlan, counts };
  }
}
