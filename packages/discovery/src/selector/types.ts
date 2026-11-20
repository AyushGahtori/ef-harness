import type { TouchesTag } from "./touches.js";

export const CRITERION_STATUSES = [
  "open",
  "partial",
  "missing",
  "conflict",
  "asked",
  "deferred",
  "not_applicable",
  "settled",
] as const;

export type CriterionStatus = (typeof CRITERION_STATUSES)[number];

export const UNCOVERED_STATUSES = ["open", "partial", "missing", "conflict"] as const;

export type UncoveredStatus = (typeof UNCOVERED_STATUSES)[number];

export const FOUNDATIONAL_SCOPES = ["auth", "data", "core_domain", "deployment_target"] as const;

export type FoundationalScope = (typeof FOUNDATIONAL_SCOPES)[number];

export type ScopeClass = FoundationalScope | "leaf";

export const DEFAULT_BATCH_TARGET = 3;
export const MAX_BATCH_SIZE = 4;
export const MIN_BATCH_SIZE = 1;
export const DEFAULT_LOCAL_QUESTION_BUDGET = 25;

const UNCOVERED_STATUS_SET: ReadonlySet<string> = new Set(UNCOVERED_STATUSES);

export function isUncoveredStatus(status: CriterionStatus): status is UncoveredStatus {
  return UNCOVERED_STATUS_SET.has(status);
}

export function isPrerequisiteSatisfied(status: CriterionStatus): boolean {
  return status === "settled" || status === "not_applicable";
}

export interface QuestionOption {
  readonly id: string;
  readonly label: string;
  readonly recommended: boolean;
}

export interface CriterionState {
  readonly id: string;
  readonly decisionId: string;
  readonly label: string;
  readonly status: CriterionStatus;
  readonly mustAsk: boolean;
  readonly scope: ScopeClass;
  readonly askCount: number;
  readonly lastAskedTurn: number | null;
  readonly skipCount: number;
  readonly ambiguous: boolean;
  readonly requiresSettled: readonly string[];
}

export interface CatalogQuestion {
  readonly id: string;
  readonly text: string;
  readonly options: readonly QuestionOption[];
  readonly targetCriteria: readonly string[];
  readonly requiresSettled: readonly string[];
  readonly touches: readonly TouchesTag[];
  readonly catalogPriority: number;
  readonly complex: boolean;
  readonly conflictResolution: boolean;
  readonly mustAsk: boolean;
  readonly bundleGroup: string | null;
  readonly whyAsking: string | null;
  readonly projectLocal: boolean;
}

export interface BatchQuestionSnapshot {
  readonly questionId: string;
  readonly decisionId: string;
  readonly text: string;
  readonly options: readonly QuestionOption[];
  readonly optionsVersion: number | null;
  readonly targetCriteria: readonly string[];
  readonly primaryCriterionId: string;
  readonly whyAsking: string;
  readonly touches: readonly TouchesTag[];
  readonly rephrased: boolean;
  readonly offerDefaultOrDefer: boolean;
  readonly complex: boolean;
  readonly conflictResolution: boolean;
  readonly projectLocal: boolean;
}

export interface SplitWavesCard {
  readonly kind: "split_waves";
  readonly text: "Split into smaller waves or confirm remaining items";
  readonly remainingLabels: readonly string[];
  readonly remainingCriterionIds: readonly string[];
}

export interface AskUpdate {
  readonly criterionId: string;
  readonly decisionId: string;
  readonly askCount: number;
  readonly lastAskedTurn: number;
}

export interface BatchDiagnostic {
  readonly name: "CatalogPrereqCycleError";
  readonly warning: string;
  readonly brokenOnId: string;
  readonly cycle: readonly string[];
}

export interface DiscoveryBatchRecord {
  readonly id: string;
  readonly workItemId: string;
  readonly scopeRev: number;
  readonly status: "open";
  readonly questionIds: readonly string[];
  readonly questionsJson: string;
  readonly snapshot: readonly BatchQuestionSnapshot[];
  readonly splitCard: SplitWavesCard | null;
  readonly diagnostics: readonly BatchDiagnostic[];
  readonly cursor: number;
  readonly createdAt: number;
  readonly catalogVersion: string;
  readonly askUpdates: readonly AskUpdate[];
}

export interface GreedyPick {
  readonly question: CatalogQuestion;
  readonly gain: number;
  readonly coveredCriterionIds: readonly string[];
  readonly primaryCriterionId: string;
  readonly isConflict: boolean;
  readonly isMustAsk: boolean;
  readonly downstreamUnblockCount: number;
}

export function criterionById(
  criteria: readonly CriterionState[],
): Map<string, CriterionState> {
  const map = new Map<string, CriterionState>();
  for (const criterion of criteria) {
    map.set(criterion.id, criterion);
  }
  return map;
}

export function questionById(
  questions: readonly CatalogQuestion[],
): Map<string, CatalogQuestion> {
  const map = new Map<string, CatalogQuestion>();
  for (const question of questions) {
    map.set(question.id, question);
  }
  return map;
}

export function clampBatchTarget(value: number | undefined): number {
  const requested = value ?? DEFAULT_BATCH_TARGET;
  if (!Number.isFinite(requested)) return DEFAULT_BATCH_TARGET;
  const whole = Math.floor(requested);
  if (whole < MIN_BATCH_SIZE) return MIN_BATCH_SIZE;
  if (whole > MAX_BATCH_SIZE) return MAX_BATCH_SIZE;
  return whole;
}
