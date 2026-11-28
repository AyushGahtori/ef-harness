import type { ResumptionTrigger, StoredHoldReason, TaskState } from "./states.js";

export interface TaskHold {
  readonly task: string;
  readonly reason: StoredHoldReason;
  readonly source: string;
  readonly createdAt: number;
}

export interface PlaceHoldInput {
  readonly task: string;
  readonly reason: StoredHoldReason;
  readonly source: string;
  readonly now: number;
  readonly rev: number;
}

export interface PlaceHoldResult {
  readonly placed: boolean;
  readonly hold: TaskHold;
  readonly taskState: TaskState;
  readonly epoch: number;
  readonly submissionPending: 0 | 1;
  readonly holderAttempt: string | null;
}

export interface ReleaseHoldInput {
  readonly task: string;
  readonly reason: StoredHoldReason;
  readonly source: string;
  readonly now: number;
  readonly rev: number;
}

export interface ReleaseHoldResult {
  readonly removed: boolean;
  readonly remainingHolds: readonly TaskHold[];
  readonly taskState: TaskState;
  readonly epoch: number;
  readonly submissionPending: 0 | 1;
  readonly holderAttempt: string | null;
}

export interface CandidateReceipt {
  readonly candidateId: string;
  readonly task: string;
  readonly attempt: string;
  readonly epoch: number;
  readonly commitSha: string;
  readonly payload: string;
  readonly receivedAt: number;
  readonly state: "STATIC_AUDIT";
  readonly submissionPending: 1;
}

export interface SubmitCandidateInput {
  readonly opId?: string;
  readonly candidateId: string;
  readonly task: string;
  readonly attempt: string;
  readonly epoch: number;
  readonly commitSha: string;
  readonly payload: string;
  readonly now: number;
  readonly rev: number;
}

export interface FinishSubmissionResult {
  readonly task: string;
  readonly epoch: number;
  readonly fromState: TaskState;
  readonly nextState: TaskState;
  readonly submissionPending: 0;
  readonly holderAttempt: string | null;
  readonly attemptState: string | null;
  readonly attemptEndedAt: number | null;
}

export interface TransitionTaskInput {
  readonly task: string;
  readonly to: TaskState;
  readonly epoch: number;
  readonly rev: number;
  readonly now: number;
}

export interface TransitionTaskResult {
  readonly task: string;
  readonly fromState: TaskState;
  readonly state: TaskState;
  readonly epoch: number;
  readonly submissionPending: 0 | 1;
  readonly holderAttempt: string | null;
}

export interface ParkCheckpoint {
  readonly step: number;
  readonly wipRef: string;
  readonly sessionRef?: string | null;
  readonly contractVersions?: string;
  readonly pendingEffects?: string;
  readonly handoffNote?: string | null;
}

export interface ParkTaskInput {
  readonly task: string;
  readonly epoch: number;
  readonly rev: number;
  readonly now: number;
  readonly checkpoint: ParkCheckpoint;
}

export interface ResumeParkedTaskInput {
  readonly task: string;
  readonly epoch: number;
  readonly rev: number;
  readonly now: number;
  readonly trigger: ResumptionTrigger;
}

export interface EpochFence {
  readonly task: string;
  readonly attempt: string;
  readonly epoch: number;
}

export interface AssertEpochInput {
  readonly task: string;
  readonly attempt: string;
  readonly epoch: number;
}
