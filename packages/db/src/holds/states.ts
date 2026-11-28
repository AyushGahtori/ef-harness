/**
 * Schema-parity copies of the Task 010 vocabularies. `task_states` is seeded
 * in schema/state.sql; hold reasons are the closed comment on `task_holds`.
 * A parity test reads that file so these constants cannot drift. Barrel wiring
 * should re-export Task 010 once `@ef-harness/shared-contracts` exposes them.
 */
export const TASK_STATES = [
  "DRAFTED",
  "READY",
  "LEASED",
  "CODING",
  "STATIC_AUDIT",
  "CLEAN_VERIFY",
  "ACCEPTED",
  "MERGED_TO_FEATURE",
  "WAITING_INPUT",
  "PARKED",
  "ESCALATED",
  "EXHAUSTED",
  "HUMAN_OWNED",
  "SUPERSEDED",
  "CANCELLED",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const HOLD_REASONS = [
  "user_pause",
  "requirement_change",
  "budget",
  "ccr",
  "governor",
] as const;

export type HoldReason = (typeof HOLD_REASONS)[number];

/**
 * `editor_overlap` is stored on `task_holds` for editor coexistence.
 * It stays out of `HOLD_REASONS` so the schema comment parity check still matches `schema/state.sql`.
 */
export const EDITOR_OVERLAP_HOLD_REASON = "editor_overlap" as const;

export const STORED_HOLD_REASONS = [...HOLD_REASONS, EDITOR_OVERLAP_HOLD_REASON] as const;

export type StoredHoldReason = (typeof STORED_HOLD_REASONS)[number];

export interface TaskStateFlags {
  readonly claimable: boolean;
  readonly done: boolean;
  readonly terminal: boolean;
}

export const TASK_STATE_FLAGS: Readonly<Record<TaskState, TaskStateFlags>> = {
  DRAFTED: { claimable: false, done: false, terminal: false },
  READY: { claimable: true, done: false, terminal: false },
  LEASED: { claimable: false, done: false, terminal: false },
  CODING: { claimable: false, done: false, terminal: false },
  STATIC_AUDIT: { claimable: false, done: false, terminal: false },
  CLEAN_VERIFY: { claimable: false, done: false, terminal: false },
  ACCEPTED: { claimable: false, done: true, terminal: false },
  MERGED_TO_FEATURE: { claimable: false, done: true, terminal: true },
  WAITING_INPUT: { claimable: false, done: false, terminal: false },
  PARKED: { claimable: false, done: false, terminal: false },
  ESCALATED: { claimable: false, done: false, terminal: false },
  EXHAUSTED: { claimable: false, done: false, terminal: false },
  HUMAN_OWNED: { claimable: false, done: false, terminal: false },
  SUPERSEDED: { claimable: false, done: false, terminal: true },
  CANCELLED: { claimable: false, done: false, terminal: true },
};

export const TERMINAL_TASK_STATES = [
  "MERGED_TO_FEATURE",
  "SUPERSEDED",
  "CANCELLED",
] as const satisfies readonly TaskState[];

export const FINISH_SUBMISSION_STATES = [
  "ACCEPTED",
  "CODING",
  "ESCALATED",
  "EXHAUSTED",
] as const satisfies readonly TaskState[];

export type FinishSubmissionState = (typeof FINISH_SUBMISSION_STATES)[number];

export const RESUMPTION_TRIGGERS = ["user", "resumption_policy"] as const;

export type ResumptionTrigger = (typeof RESUMPTION_TRIGGERS)[number];

/**
 * Directed graph for all 15 task states.
 *
 * Edges from the Next column in build-pipeline.md (task state machine), plus
 * the edges this task requires: active-attempt park, human takeover and
 * "I'm done", finish_submission's EXHAUSTED outcome, EXHAUSTED owner decisions
 * (revise / fix by hand / waive), and CANCELLED for removal from scope.
 * Terminal states have no outgoing edges, so they cannot return to READY or CODING.
 * ACCEPTED is reachable only from CLEAN_VERIFY. CLEAN_VERIFY is reachable only
 * from STATIC_AUDIT. MERGED_TO_FEATURE is reachable only from ACCEPTED.
 */
export const TASK_STATE_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  DRAFTED: ["READY", "CANCELLED"],
  READY: ["LEASED", "CANCELLED"],
  LEASED: ["CODING", "PARKED", "CANCELLED"],
  CODING: ["STATIC_AUDIT", "WAITING_INPUT", "PARKED", "HUMAN_OWNED", "CANCELLED"],
  STATIC_AUDIT: ["CLEAN_VERIFY", "CODING", "EXHAUSTED", "PARKED", "CANCELLED"],
  CLEAN_VERIFY: ["ACCEPTED", "CODING", "ESCALATED", "EXHAUSTED", "PARKED", "CANCELLED"],
  ACCEPTED: ["MERGED_TO_FEATURE", "SUPERSEDED", "CANCELLED"],
  MERGED_TO_FEATURE: [],
  WAITING_INPUT: ["CODING", "PARKED", "HUMAN_OWNED", "CANCELLED"],
  PARKED: ["READY", "HUMAN_OWNED", "CANCELLED"],
  ESCALATED: ["READY", "HUMAN_OWNED", "CANCELLED"],
  EXHAUSTED: ["READY", "HUMAN_OWNED", "CANCELLED"],
  HUMAN_OWNED: ["STATIC_AUDIT", "CANCELLED"],
  SUPERSEDED: [],
  CANCELLED: [],
};

/** Entering these states detaches the current attempt so it cannot keep mutating the task. */
export const TRANSITIONS_THAT_CLEAR_HOLDER = [
  "PARKED",
  "READY",
  "ESCALATED",
  "EXHAUSTED",
  "CANCELLED",
  "SUPERSEDED",
  "HUMAN_OWNED",
  "MERGED_TO_FEATURE",
] as const satisfies readonly TaskState[];

export const HOLD_EVENT_TYPES = ["TaskHoldPlaced", "TaskHoldReleased", "TaskUnheld"] as const;

export type HoldEventType = (typeof HOLD_EVENT_TYPES)[number];

/** Consumers registered with canonical `register_delivery` for every hold event. */
export const HOLD_EVENT_CONSUMERS = ["scheduler", "exporter", "ui_projection"] as const;

export function isTaskState(value: string): value is TaskState {
  return (TASK_STATES as readonly string[]).includes(value);
}

export function isHoldReason(value: string): value is HoldReason {
  return (HOLD_REASONS as readonly string[]).includes(value);
}

export function isStoredHoldReason(value: string): value is StoredHoldReason {
  return (STORED_HOLD_REASONS as readonly string[]).includes(value);
}

export function isFinishSubmissionState(value: string): value is FinishSubmissionState {
  return (FINISH_SUBMISSION_STATES as readonly string[]).includes(value);
}

export function isResumptionTrigger(value: string): value is ResumptionTrigger {
  return (RESUMPTION_TRIGGERS as readonly string[]).includes(value);
}

export function isLegalTaskTransition(from: TaskState, to: TaskState): boolean {
  return TASK_STATE_TRANSITIONS[from].includes(to);
}

export function submissionPendingAfter(to: TaskState): 0 | 1 {
  return to === "STATIC_AUDIT" || to === "CLEAN_VERIFY" ? 1 : 0;
}

export function clearsHolder(to: TaskState): boolean {
  return (TRANSITIONS_THAT_CLEAR_HOLDER as readonly TaskState[]).includes(to);
}
