/**
 * Honest readiness contracts.
 *
 * Sibling branches (Task 017, Task 071, Task 073) are not on this base.
 * The ports below are the local stand-ins those tasks will satisfy.
 */

export const DEFERRAL_BUDGET_PERCENT = {
  prototype: 20,
  mvp: 20,
  production: 5,
} as const;

export type ProjectStage = keyof typeof DEFERRAL_BUDGET_PERCENT;

export type ScopeDisposition = "active" | "not_applicable" | "awaiting_definition";

export type FeatureReadinessState = "discovering" | "ready" | "not_applicable";

export class ReadinessHonestyError extends Error {
  readonly code = "readiness_honesty" as const;

  constructor(message: string) {
    super(message);
    this.name = "ReadinessHonestyError";
  }
}

export class SilentDenominatorJumpError extends Error {
  readonly code = "silent_denominator_jump" as const;

  constructor(message: string) {
    super(message);
    this.name = "SilentDenominatorJumpError";
  }
}

export interface ReadinessCounts {
  settledExplicit: number;
  settledDerived: number;
  settledDelegated: number;
  settledDefaulted: number;
  /** Schema-legal basis with no dedicated spec bucket. Included in settledTotal. */
  settledObserved: number;
  pendingVerification: number;
  openMustAsk: number;
  openStandard: number;
  partial: number;
  missing: number;
  conflict: number;
  deferred: number;
  notApplicable: number;
  activeDenominator: number;
  settledTotal: number;
  chosenForYou: number;
  criterionCount: number;
  blockingCount: number;
  nonMustAskPool: number;
}

export interface CanonicalReadiness {
  planningTotal: number;
  planningSettled: number;
  overallTotal: number;
  overallSettled: number;
  criticalOpen: number;
}

export interface ReadinessBlocker {
  decisionId: string;
  criterionId: string;
  label: string;
  scopeId: string;
  focus: {
    kind: "question" | "conflict";
    targetId: string;
  };
}

export interface ReadinessDrilldown {
  conflicts: readonly ReadinessBlocker[];
  mustAsk: readonly ReadinessBlocker[];
  openStandard: readonly ReadinessBlocker[];
  pendingVerification: readonly ReadinessBlocker[];
  blockedByPrereqScope: readonly ReadinessBlocker[];
}

export interface ReadinessAction {
  kind: "retry_verification";
  label: "Retry verification";
  decisionIds: readonly string[];
}

export interface ReadinessReport {
  workItemId: string;
  scopeId: string | null;
  counts: ReadinessCounts;
  canonical: CanonicalReadiness;
  transitivePrereqsMet: boolean;
  blockedByPrereq: readonly string[];
  /** Blocker conjunction from the task spec. Vacuous scopes can be true and still not hand off. */
  isReadyToPlan: boolean;
  disposition: ScopeDisposition;
  headline: string;
  actions: readonly ReadinessAction[];
  drilldown: ReadinessDrilldown;
}

export interface PrereqCheck {
  met: boolean;
  blockedByPrereq: readonly string[];
  blockers: readonly ReadinessBlocker[];
  cyclic: boolean;
}

export interface DeferredCriterion {
  decisionId: string;
  criterionId: string;
  label: string;
  scopeId: string;
  deferredReason: string;
  revisitWave: string;
}

export type DeferralResult =
  | { ok: true; alreadyDeferred: boolean; deferred: DeferredCriterion }
  | { ok: false; reason: string };

export interface DenominatorGroup {
  scopeId: string;
  label: string;
  count: number;
}

export interface DenominatorSnapshot {
  workItemId: string;
  turnId: string;
  activeDenominator: number;
  settledTotal: number;
  scopeIds: readonly string[];
  criterionIds: readonly string[];
}

export interface DenominatorDeltaRecord {
  kind: "denominator" | "reopen";
  workItemId: string;
  turnId: string;
  previousDenominator: number;
  activeDenominator: number;
  addedCriterionIds: readonly string[];
  removedCriterionIds: readonly string[];
  addedByScope: readonly DenominatorGroup[];
  removedByScope: readonly DenominatorGroup[];
  trigger: string;
  explanation: string;
  settledThisTurn: number;
  reopenReason?: string;
  reopenedDecisionIds?: readonly string[];
}

export interface DenominatorExplanation {
  changed: boolean;
  snapshot: DenominatorSnapshot;
  delta: DenominatorDeltaRecord | null;
}

export interface HandoffEvent {
  id: string;
  type: "discovery.scope_ready" | "discovery.scope_reopened";
  subject: string;
  payload: {
    workItemId: string;
    scopeId: string;
    scopeKind: "work_item" | "feature";
    action?: "Expand Spec & Plan";
    from: FeatureReadinessState | "discovering" | "ready";
    to: FeatureReadinessState | "discovering" | "ready";
    reason?: string;
  };
}

export interface HandoffTransition {
  workItemStatus: string;
  events: readonly HandoffEvent[];
  project: ReadinessReport;
}

export interface NodeFieldPatch {
  nodeId: string;
  patch: Readonly<Record<string, unknown>>;
  removeKeys?: readonly string[];
  summary: string;
}

/**
 * Local port of Task 017 `KnowledgeGraphRepo.commitChangeSet`.
 * The default writer updates `nodes` with version + 1. Swap this when Task 017 is wired.
 */
export interface KnowledgeGraphPort {
  patchNodeFields(input: NodeFieldPatch): void;
}

/**
 * Local port of Task 071 `SemanticEntailmentGate`.
 * `pending` and `unavailable` withhold credit. `contradicts` is a conflict.
 * `establishes` and `not_applicable` leave the stored status unchanged.
 */
export interface SemanticEntailmentPort {
  verdict(decisionId: string): "establishes" | "pending" | "unavailable" | "contradicts" | "not_applicable";
}

/**
 * Local port of Task 073 `StageDepthController`.
 */
export interface StageDepthPort {
  getStage(workItemId: string): ProjectStage;
}

export interface ReadinessPorts {
  entailment?: SemanticEntailmentPort;
  stage?: StageDepthPort;
  knowledge?: KnowledgeGraphPort;
}

export interface ForceLists {
  pending: string;
  conflict: string;
}

export function emptyForces(): ForceLists {
  return { pending: "[]", conflict: "[]" };
}

export function isReadyToPlan(counts: ReadinessCounts, transitivePrereqsMet: boolean): boolean {
  return (
    counts.openMustAsk === 0 &&
    counts.conflict === 0 &&
    counts.pendingVerification === 0 &&
    counts.openStandard === 0 &&
    counts.partial === 0 &&
    counts.missing === 0 &&
    transitivePrereqsMet === true
  );
}

export function dispositionOf(counts: ReadinessCounts): ScopeDisposition {
  if (counts.criterionCount === 0) return "awaiting_definition";
  if (counts.activeDenominator === 0) return "not_applicable";
  return "active";
}

/** Planning handoff requires the blocker formula and a non-vacuous active scope. */
export function canTransitionToReady(report: Pick<ReadinessReport, "isReadyToPlan" | "disposition">): boolean {
  return report.isReadyToPlan && report.disposition === "active";
}

export function formatRequiredBy(titles: readonly string[]): string {
  if (titles.length === 0) return "Required by another scope";
  const first = titles[0] ?? "";
  if (titles.length === 1) return `Required by ${first}`;
  const second = titles[1] ?? "";
  if (titles.length === 2) return `Required by ${first} and ${second}`;
  const lead = titles.slice(0, -1).join(", ");
  const last = titles[titles.length - 1] ?? "";
  return `Required by ${lead}, and ${last}`;
}

export function deferralWithinBudget(deferredAfter: number, pool: number, percent: number): boolean {
  return deferredAfter * 100 <= pool * percent;
}
