import type { StoredHoldReason, TaskState } from "./states.js";

export interface StaleEpochDetails {
  readonly task: string;
  readonly attempt: string | null;
  readonly expectedEpoch: number;
  readonly actualEpoch: number | null;
}

export class StaleEpochError extends Error {
  readonly code = "stale_epoch" as const;

  constructor(readonly details: StaleEpochDetails) {
    super(
      `stale epoch for ${details.task}: expected ${details.expectedEpoch}, actual ${details.actualEpoch ?? "none"}`,
    );
    this.name = "StaleEpochError";
  }
}

export interface IllegalTaskTransitionDetails {
  readonly task: string;
  readonly from: TaskState;
  readonly to: string;
  readonly reason: string;
}

export class IllegalTaskTransitionError extends Error {
  readonly code = "illegal_task_transition" as const;

  constructor(readonly details: IllegalTaskTransitionDetails) {
    super(`illegal task transition ${details.from} -> ${details.to} on ${details.task}: ${details.reason}`);
    this.name = "IllegalTaskTransitionError";
  }
}

export type DuplicateCandidateReason = "payload_conflict" | "op_id_reused";

export interface DuplicateCandidateDetails {
  readonly task: string;
  readonly attempt: string;
  readonly commitSha: string;
  readonly opId: string | null;
  readonly reason: DuplicateCandidateReason;
}

export class DuplicateCandidateError extends Error {
  readonly code = "duplicate_candidate" as const;

  constructor(readonly details: DuplicateCandidateDetails) {
    super(
      details.reason === "op_id_reused"
        ? `op_id ${details.opId ?? ""} was reused for a different submit_candidate request`
        : `candidate for ${details.task}/${details.attempt}@${details.commitSha} already exists with a different payload`,
    );
    this.name = "DuplicateCandidateError";
  }
}

export interface TaskHoldRef {
  readonly reason: StoredHoldReason;
  readonly source: string;
}

export interface TaskHeldDetails {
  readonly task: string;
  readonly holds: readonly TaskHoldRef[];
}

export class TaskHeldError extends Error {
  readonly code = "task_held" as const;

  constructor(readonly details: TaskHeldDetails) {
    const summary = details.holds.map((hold) => `${hold.reason}:${hold.source}`).join(", ");
    super(`task ${details.task} is held (${summary})`);
    this.name = "TaskHeldError";
  }
}

export class SubmissionAlreadyFinishedError extends Error {
  readonly code = "submission_already_finished" as const;

  constructor(readonly details: { readonly task: string; readonly epoch: number }) {
    super(`finish_submission rejected for ${details.task} at epoch ${details.epoch}`);
    this.name = "SubmissionAlreadyFinishedError";
  }
}

export class ResumptionPolicyError extends Error {
  readonly code = "resumption_policy" as const;

  constructor(readonly details: { readonly task: string }) {
    super(`resume of ${details.task} requires a user or resumption_policy trigger`);
    this.name = "ResumptionPolicyError";
  }
}

export class TaskNotFoundError extends Error {
  readonly code = "task_not_found" as const;

  constructor(readonly details: { readonly task: string }) {
    super(`task_runtime row ${details.task} does not exist`);
    this.name = "TaskNotFoundError";
  }
}

export class InvalidHoldReasonError extends Error {
  readonly code = "invalid_hold_reason" as const;

  constructor(readonly details: { readonly reason: string }) {
    super(`hold reason ${details.reason} is outside the closed set`);
    this.name = "InvalidHoldReasonError";
  }
}

export class InvalidCandidatePayloadError extends Error {
  readonly code = "invalid_candidate_payload" as const;

  constructor(readonly details: { readonly reason: string }) {
    super(details.reason);
    this.name = "InvalidCandidatePayloadError";
  }
}
