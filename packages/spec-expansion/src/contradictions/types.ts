/** Canonical edge written for every confirmed contradiction. */
export const CONTRADICTION_EDGE_TYPE = "contradicts" as const;

/** Z3-compatible per-solve cap. Longer requests are clamped to this value. */
export const Z3_SOLVE_TIMEOUT_MS = 2_000;

/** Layer 5 never sends more than this many pairs in one model call. */
export const MAX_SEMANTIC_PAIRS_PER_CALL = 30;

export const MATRIX_IDS = [
  "M01",
  "M02",
  "M03",
  "M04",
  "M05",
  "M06",
  "M07",
  "M08",
  "M09",
  "M10",
  "M11",
  "M12",
] as const;

export type MatrixId = (typeof MATRIX_IDS)[number];

export const SETTLED_BASES = ["explicit", "derived", "delegated", "defaulted"] as const;

export type SettledBasis = (typeof SETTLED_BASES)[number];

export type ContradictionLayer = 1 | 2 | 3 | 4 | 5;

export type UnitFamily = "bytes" | "duration_ms" | "minutes_of_day" | "minor_currency" | "count";

export type IntervalBound = "min" | "max" | "exact";

export type IntervalQualifier = "idle" | "absolute" | "unspecified";

export interface ConflictDraft {
  readonly id: string;
  readonly layer: ContradictionLayer;
  readonly nodeIds: readonly string[];
  readonly ruleId: string;
  readonly plainEnglishConflict: string;
  readonly concreteCounterexample: string;
  readonly resolutionOptions: readonly string[];
}

export interface CatalogRequire {
  readonly optionId: string;
  readonly groupId: string;
}

/** Local port of a Task 075 catalog entry: option values carry conflicts_with and requires. */
export interface CatalogRuleEntry {
  readonly id: string;
  readonly optionId: string;
  readonly groupId: string;
  readonly conflictsWith: readonly string[];
  readonly requires: readonly CatalogRequire[];
}

export interface SettledDecisionRef {
  readonly id: string;
  readonly title: string;
  readonly optionId: string;
  readonly groupId: string;
  readonly basis: string;
}

export type ArchitecturalConstraint =
  | { readonly kind: "assert"; readonly nodeId: string; readonly value: boolean }
  | { readonly kind: "implies"; readonly from: string; readonly to: string }
  | { readonly kind: "conflicts"; readonly left: string; readonly right: string }
  | { readonly kind: "exactly_one"; readonly nodeIds: readonly string[] }
  | { readonly kind: "nand"; readonly nodeIds: readonly string[] };

export interface MatrixCellRecord {
  readonly id: string;
  readonly matrixId: MatrixId;
  readonly axisA: string;
  readonly axisB: string;
  readonly status: "filled" | "open" | "not_applicable";
  readonly actionId?: string;
  readonly allowed?: boolean;
  readonly routeOrCommand?: string;
  readonly lifecycleHandler?: string;
  readonly screenActionId?: string;
  readonly terminal?: boolean;
  readonly fromState?: string;
  readonly toState?: string;
  readonly stateId?: string;
  readonly hardDelete?: boolean;
  readonly immutableAudit?: boolean;
  readonly entityId?: string;
  readonly retentionAction?: "hard_delete" | "retain" | "anonymize";
  readonly notificationTrigger?: string;
  readonly text?: string;
}

export interface IntervalClaimInput {
  readonly key: string;
  readonly family: UnitFamily;
  readonly bound: IntervalBound;
  readonly amount: number;
  readonly unit: string;
  readonly qualifier?: IntervalQualifier;
}

export interface IntervalSource {
  readonly nodeId: string;
  readonly text: string;
  readonly claims?: readonly IntervalClaimInput[];
}

/** Requirement row produced by Task 080 `OrderedCellFillerPipeline`. */
export interface MaterializedRequirement {
  readonly id: string;
  readonly text: string;
  readonly earsText: string;
  readonly entities: readonly string[];
  readonly touches: readonly string[];
  readonly featureId: string;
  readonly pass: 1 | 2 | 3;
  readonly basis: string;
  readonly status: string;
  readonly quote?: string;
  readonly cellId?: string;
  readonly sourceDecisionIds?: readonly string[];
  readonly claims?: readonly IntervalClaimInput[];
}

export interface SemanticPair {
  readonly leftId: string;
  readonly rightId: string;
  readonly leftText: string;
  readonly rightText: string;
  readonly leftBasis: string;
  readonly rightBasis: string;
  readonly leftQuote: string;
  readonly rightQuote: string;
}

export function isSettledBasis(basis: string | null | undefined): basis is SettledBasis {
  return basis === "explicit" || basis === "derived" || basis === "delegated" || basis === "defaulted";
}

export function makeConflictId(layer: ContradictionLayer, ruleId: string, nodeIds: readonly string[]): string {
  return `L${String(layer)}:${ruleId}:${[...nodeIds].sort().join("+")}`;
}

export function buildResolutionOptions(titles: readonly string[], bases: readonly string[]): string[] {
  const keep = titles.map((title) => `Keep "${title}" and supersede the conflicting statements`);
  const allExplicit = bases.length > 0 && bases.every((basis) => basis === "explicit");
  if (allExplicit && titles.length >= 2) {
    return [...keep, "Ask the developer to choose; both statements are explicit"];
  }
  return [...keep, "Supersede one statement and re-check"];
}

export function constraintNodeIds(constraint: ArchitecturalConstraint): readonly string[] {
  switch (constraint.kind) {
    case "assert":
      return [constraint.nodeId];
    case "implies":
      return [constraint.from, constraint.to];
    case "conflicts":
      return [constraint.left, constraint.right];
    case "exactly_one":
    case "nand":
      return constraint.nodeIds;
    default: {
      const neverConstraint: never = constraint;
      return neverConstraint;
    }
  }
}
