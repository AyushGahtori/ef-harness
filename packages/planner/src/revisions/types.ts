export const CHANGE_CLASSES = ["cosmetic", "clarifying", "compatible", "breaking"] as const;

export type ChangeClass = (typeof CHANGE_CLASSES)[number];

export const ACTIVE_WORKING_STATES = ["WORKING", "LEASED", "CODING"] as const;

export type ActiveWorkingState = (typeof ACTIVE_WORKING_STATES)[number];

export const MERGED_DONE_STATES = ["DONE", "MERGED_TO_FEATURE", "ACCEPTED"] as const;

export type MergedDoneState = (typeof MERGED_DONE_STATES)[number];

export const REQUIREMENT_KINDS = ["requirement", "spec_item", "edge_case", "rule", "journey"] as const;

export const DEFAULT_DEBOUNCE_MS = 1_500;

/** 2 delta tasks × this rate = $0.35, matching the impact-preview example. */
export const MICRO_USD_PER_DELTA_TASK = 175_000;

export const DEFAULT_IMPACT_MAX_DEPTH = 64;

export const IMPACT_ROW_CAP = 5_001;

export type FlushReason = "debounce" | "apply" | "start";

export interface RevisionEdit {
  readonly nodeId: string;
  readonly nodeKind: string;
  readonly beforeText: string;
  readonly afterText: string;
  readonly beforeFields: Readonly<Record<string, unknown>>;
  readonly afterFields: Readonly<Record<string, unknown>>;
  readonly triggerSource: string;
  readonly requestedClass?: ChangeClass;
}

export interface ClassifiedChange {
  readonly edit: RevisionEdit;
  readonly changeClass: ChangeClass;
  readonly reasons: readonly string[];
  readonly floorApplied: boolean;
}

export interface ImpactNode {
  readonly id: string;
  readonly depth: number;
}

export interface ImpactedSubgraph {
  readonly nodes: readonly ImpactNode[];
  readonly affectedDecisions: readonly string[];
  readonly affectedRequirements: readonly string[];
  readonly affectedContracts: readonly string[];
  readonly affectedScreens: readonly string[];
  readonly affectedActiveTasks: readonly string[];
  readonly affectedMergedTasks: readonly string[];
  readonly affectedChecks: readonly string[];
  readonly partial: boolean;
  readonly elapsedMs: number;
  readonly canonicalQueries: number;
  readonly cycleSafeQueries: number;
}

export interface GraphNode {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly status: string;
}

export interface TaskRuntimeRow {
  readonly taskId: string;
  readonly state: string;
  readonly title: string;
  readonly verifiedUnderRev: boolean;
}

export interface CheckFailure {
  readonly checkId: string;
  readonly title: string;
  readonly expected: string;
  readonly actual: string;
}

export interface ReverifyDecision {
  readonly taskId: string;
  readonly outcome: "verified_under_rev" | "rework_required";
  readonly failingChecks: readonly CheckFailure[];
}

export interface LinkedCheck {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly requirementId: string;
}

export interface ContradictionFinding {
  readonly src: string;
  readonly dst: string;
  readonly edgeType: "contradicts";
  readonly summary: string;
}

export interface ConflictCard {
  readonly kind: "conflict_card";
  readonly contradictions: readonly ContradictionFinding[];
  readonly message: string;
}

export interface RevisionBatchRecord {
  readonly revisionId: string;
  readonly triggerSource: string;
  readonly changeClass: ChangeClass;
  readonly editedNodeIds: readonly string[];
  readonly impactedNodeIds: readonly string[];
  readonly earlyCutoffNodeIds: readonly string[];
  readonly reverifiedPassedIds: readonly string[];
  readonly reworkTaskIds: readonly string[];
  readonly additiveTaskIds: readonly string[];
  readonly holdTaskIds: readonly string[];
  readonly conflictCard: ConflictCard | null;
  readonly preview: string;
  readonly llmCalls: 0;
  readonly createdAt: number;
}

export interface RevisionCommitInput {
  readonly edits: readonly RevisionEdit[];
  readonly triggerSource: string;
  readonly flushReason: FlushReason;
}

export interface RevisionCommitter {
  commitBatch(input: RevisionCommitInput): RevisionBatchRecord;
}

export interface CutoffHop {
  readonly id: string;
  readonly previousFingerprint: string;
  readonly nextFingerprint: string;
  readonly changed: boolean;
}

export interface EarlyCutoffResult {
  readonly impactedNodeIds: readonly string[];
  readonly earlyCutoffNodeIds: readonly string[];
  readonly hops: readonly CutoffHop[];
}

export interface ImpactPreviewInput {
  readonly contractCount: number;
  readonly activeTasks: readonly { readonly id: string; readonly title: string }[];
  readonly finishedTaskCount: number;
  readonly untouchedTaskCount: number;
  readonly deltaTasks: number;
  readonly deltaCostMicroUsd: number;
}

export function changeClassRank(changeClass: ChangeClass): number {
  switch (changeClass) {
    case "cosmetic":
      return 0;
    case "clarifying":
      return 1;
    case "compatible":
      return 2;
    case "breaking":
      return 3;
  }
}

export function maxChangeClass(classes: readonly ChangeClass[]): ChangeClass {
  let best: ChangeClass = "cosmetic";
  for (const changeClass of classes) {
    if (changeClassRank(changeClass) > changeClassRank(best)) best = changeClass;
  }
  return best;
}

export function isActiveWorkingState(state: string): boolean {
  return (ACTIVE_WORKING_STATES as readonly string[]).includes(state);
}

export function isMergedDoneState(state: string): boolean {
  return (MERGED_DONE_STATES as readonly string[]).includes(state);
}

export function isRequirementKind(kind: string): boolean {
  return (REQUIREMENT_KINDS as readonly string[]).includes(kind);
}
