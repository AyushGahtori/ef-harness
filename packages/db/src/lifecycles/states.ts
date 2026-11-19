/**
 * Schema-parity copies of the Task 010 `FEATURE_STATES` and `PROJECT_STATES`
 * rows. Task 010 is not on this base commit, and package barrels cannot be
 * deep-imported. A parity test reads schema/state.sql so these constants
 * cannot drift. After Task 010 is exported from `@ef-harness/shared-contracts`,
 * replace these copies with that barrel and keep the transition graphs here.
 */

export const FEATURE_STATES = [
  { state: "PLANNED", terminal: false },
  { state: "JIT_READY", terminal: false },
  { state: "IN_WAVE", terminal: false },
  { state: "LEAVES_MERGED", terminal: false },
  { state: "WIRED", terminal: false },
  { state: "JOURNEY_PASSED", terminal: false },
  { state: "QUEUED_FOR_MERGE", terminal: false },
  { state: "MERGED", terminal: false },
  { state: "DONE", terminal: true },
  { state: "BLOCKED", terminal: false },
  { state: "REOPENED", terminal: false },
  { state: "DEFERRED", terminal: false },
  { state: "ABANDONED", terminal: true },
] as const;

export type FeatureState = (typeof FEATURE_STATES)[number]["state"];

export const PROJECT_STATES = [
  "DISCOVERY",
  "SPEC_COMPLETE",
  "UPFRONT_DOCS",
  "PREVIEW",
  "PHASE0",
  "WAVES",
  "COMPLETION",
  "READY_TO_LAND",
  "LANDED",
  "SHIPPING",
] as const;

export type ProjectState = (typeof PROJECT_STATES)[number];

/** Project phases in which the Phase 0 foundation gate has already passed. */
export const PROJECT_STATES_WITH_FOUNDATION_GATE = [
  "WAVES",
  "COMPLETION",
  "READY_TO_LAND",
  "LANDED",
  "SHIPPING",
] as const satisfies readonly ProjectState[];

export const FOUNDATION_GATE_META_KEY = "foundation_gate";
export const FOUNDATION_GATE_PASSED_VALUE = "passed";

export const DONE_GATE_CONDITIONS = [
  { id: "1", name: "tasks_merged_at_current_versions" },
  { id: "2", name: "requirements_passing_or_waived" },
  { id: "3", name: "static_audit_clean" },
  { id: "4", name: "feature_journey_passed" },
  { id: "5", name: "integration_regression_green" },
  { id: "6", name: "accessibility_layout_clear" },
  { id: "7", name: "no_open_ccr" },
] as const;

export type FeatureDoneConditionId = (typeof DONE_GATE_CONDITIONS)[number]["id"];

export const LIFECYCLE_EVENT_TYPES = [
  "FeatureStateChanged",
  "FeatureCompleted",
  "ProjectStateChanged",
  "ProjectPausedChanged",
] as const;

export type LifecycleEventType = (typeof LIFECYCLE_EVENT_TYPES)[number];

/** Mandatory outbox consumers. Every lifecycle event registers all three. */
export const LIFECYCLE_EVENT_CONSUMERS = ["scheduler", "exporter", "ui_projection"] as const;

export type LifecycleEventConsumer = (typeof LIFECYCLE_EVENT_CONSUMERS)[number];

export const TASK_SETTLED_STATES = ["MERGED_TO_FEATURE", "CANCELLED", "SUPERSEDED"] as const;

export type SettledTaskState = (typeof TASK_SETTLED_STATES)[number];

export const REQUIREMENT_KINDS_FOR_DONE = ["spec_item", "edge_case", "rule"] as const;

export const INTEGRATION_REF = "refs/heads/harness/integration";

const FEATURE_STATE_NAMES = FEATURE_STATES.map((row) => row.state);

const featureStateSet: ReadonlySet<string> = new Set(FEATURE_STATE_NAMES);
const projectStateSet: ReadonlySet<string> = new Set(PROJECT_STATES);

export function isFeatureState(value: string): value is FeatureState {
  return featureStateSet.has(value);
}

export function isProjectState(value: string): value is ProjectState {
  return projectStateSet.has(value);
}

export function isFeatureDoneConditionId(value: string): value is FeatureDoneConditionId {
  return DONE_GATE_CONDITIONS.some((row) => row.id === value);
}

export function featureTerminal(state: FeatureState): boolean {
  const row = FEATURE_STATES.find((item) => item.state === state);
  return row?.terminal ?? false;
}

/**
 * Directed feature graph.
 * `IN_WAVE → LEAVES_MERGED` is intentionally absent: only
 * `advance_feature_leaves_merged` may write that state.
 * `MERGED → DONE` is present, and the repository still refuses it unless
 * `verifyFeatureDoneConditions` returns ok inside the same transaction.
 * `REOPENED` is reached only from `MERGED` or `DONE`.
 */
export const FEATURE_STATE_TRANSITIONS: Readonly<Record<FeatureState, readonly FeatureState[]>> = {
  PLANNED: ["JIT_READY", "BLOCKED", "DEFERRED", "ABANDONED"],
  JIT_READY: ["IN_WAVE", "BLOCKED", "DEFERRED", "ABANDONED"],
  IN_WAVE: ["BLOCKED", "DEFERRED", "ABANDONED"],
  LEAVES_MERGED: ["WIRED", "BLOCKED", "DEFERRED", "ABANDONED"],
  WIRED: ["JOURNEY_PASSED", "BLOCKED", "DEFERRED", "ABANDONED"],
  JOURNEY_PASSED: ["QUEUED_FOR_MERGE", "BLOCKED", "DEFERRED", "ABANDONED"],
  QUEUED_FOR_MERGE: ["MERGED", "BLOCKED", "DEFERRED", "ABANDONED"],
  MERGED: ["DONE", "REOPENED", "BLOCKED", "DEFERRED", "ABANDONED"],
  DONE: ["REOPENED"],
  BLOCKED: [
    "PLANNED",
    "JIT_READY",
    "IN_WAVE",
    "LEAVES_MERGED",
    "WIRED",
    "JOURNEY_PASSED",
    "QUEUED_FOR_MERGE",
    "MERGED",
    "DEFERRED",
    "ABANDONED",
  ],
  REOPENED: ["IN_WAVE", "BLOCKED", "DEFERRED", "ABANDONED"],
  DEFERRED: ["PLANNED", "JIT_READY", "ABANDONED"],
  ABANDONED: [],
};

export const PROJECT_STATE_TRANSITIONS: Readonly<Record<ProjectState, readonly ProjectState[]>> = {
  DISCOVERY: ["SPEC_COMPLETE"],
  SPEC_COMPLETE: ["UPFRONT_DOCS"],
  UPFRONT_DOCS: ["PREVIEW"],
  PREVIEW: ["PHASE0"],
  PHASE0: ["WAVES"],
  WAVES: ["COMPLETION"],
  COMPLETION: ["READY_TO_LAND"],
  READY_TO_LAND: ["LANDED"],
  LANDED: ["SHIPPING"],
  SHIPPING: [],
};

export function isLegalFeatureTransition(from: FeatureState, to: FeatureState): boolean {
  return FEATURE_STATE_TRANSITIONS[from].includes(to);
}

export function isLegalProjectTransition(from: ProjectState, to: ProjectState): boolean {
  return PROJECT_STATE_TRANSITIONS[from].includes(to);
}

export function foundationGatePassedByState(state: ProjectState): boolean {
  return (PROJECT_STATES_WITH_FOUNDATION_GATE as readonly string[]).includes(state);
}
