import { createHash, randomUUID } from "node:crypto";

import type { SqlStatement, SqlValue, StateConnection } from "./connection.js";
import {
  DuplicateCandidateError,
  IllegalTaskTransitionError,
  InvalidCandidatePayloadError,
  InvalidHoldReasonError,
  ResumptionPolicyError,
  StaleEpochError,
  SubmissionAlreadyFinishedError,
  TaskHeldError,
  TaskNotFoundError,
} from "./errors.js";
import type {
  AssertEpochInput,
  CandidateReceipt,
  EpochFence,
  FinishSubmissionResult,
  ParkTaskInput,
  PlaceHoldInput,
  PlaceHoldResult,
  ReleaseHoldInput,
  ReleaseHoldResult,
  ResumeParkedTaskInput,
  SubmitCandidateInput,
  TaskHold,
  TransitionTaskInput,
  TransitionTaskResult,
} from "./models.js";
import { loadCanonicalQueries } from "./queries.js";
import {
  HOLD_EVENT_CONSUMERS,
  TASK_STATE_FLAGS,
  clearsHolder,
  isFinishSubmissionState,
  isStoredHoldReason,
  isLegalTaskTransition,
  isResumptionTrigger,
  isTaskState,
  submissionPendingAfter,
  type FinishSubmissionState,
  type TaskState,
} from "./states.js";

interface RuntimeRow {
  readonly task: string;
  readonly state: TaskState;
  readonly epoch: number;
  readonly holderAttempt: string | null;
  readonly leaseExpiresAt: number | null;
  readonly submissionPending: 0 | 1;
  readonly updatedRev: number;
}

interface AttemptRow {
  readonly id: string;
  readonly task: string;
  readonly epoch: number;
  readonly state: string;
  readonly endedAt: number | null;
}

interface CandidateRow {
  readonly id: string;
  readonly task: string;
  readonly attempt: string;
  readonly epoch: number;
  readonly commitSha: string;
  readonly payload: string;
  readonly receivedAt: number;
}

interface AttemptWrite {
  readonly state: string;
  readonly endedAt: number | null;
  readonly outcome: string | null;
}

function rowChanges(result: { readonly changes: number | bigint }): number {
  return typeof result.changes === "bigint" ? Number(result.changes) : result.changes;
}

function asNumber(value: SqlValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return null;
}

function asText(row: Readonly<Record<string, SqlValue>>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`column ${key} is not text`);
  return value;
}

function asNullableText(row: Readonly<Record<string, SqlValue>>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`column ${key} is not text`);
  return value;
}

function requireInt(value: number, label: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`);
  }
}

function isUniqueConstraint(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { readonly message?: unknown; readonly errcode?: unknown };
  const message = typeof record.message === "string" ? record.message : "";
  return (
    message.includes("UNIQUE constraint failed") ||
    record.errcode === 2067 ||
    record.errcode === 1555
  );
}

function assertJsonPayload(payload: string): void {
  try {
    JSON.parse(payload);
  } catch {
    throw new InvalidCandidatePayloadError({ reason: "candidate payload is not valid JSON" });
  }
}

function submitRequestHash(input: SubmitCandidateInput): string {
  const canonical = JSON.stringify({
    attempt: input.attempt,
    candidateId: input.candidateId,
    commitSha: input.commitSha,
    epoch: input.epoch,
    payload: input.payload,
    task: input.task,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function receiptFromCandidate(row: CandidateRow): CandidateReceipt {
  return {
    candidateId: row.id,
    task: row.task,
    attempt: row.attempt,
    epoch: row.epoch,
    commitSha: row.commitSha,
    payload: row.payload,
    receivedAt: row.receivedAt,
    state: "STATIC_AUDIT",
    submissionPending: 1,
  };
}

function parseReceipt(json: string): CandidateReceipt {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("stored submit_candidate receipt is not an object");
  }
  const record = parsed as Record<string, unknown>;
  const candidateId = record.candidateId;
  const task = record.task;
  const attempt = record.attempt;
  const epoch = record.epoch;
  const commitSha = record.commitSha;
  const payload = record.payload;
  const receivedAt = record.receivedAt;
  if (
    typeof candidateId !== "string" ||
    typeof task !== "string" ||
    typeof attempt !== "string" ||
    typeof epoch !== "number" ||
    typeof commitSha !== "string" ||
    typeof payload !== "string" ||
    typeof receivedAt !== "number" ||
    record.state !== "STATIC_AUDIT" ||
    record.submissionPending !== 1
  ) {
    throw new Error("stored submit_candidate receipt is incomplete");
  }
  return {
    candidateId,
    task,
    attempt,
    epoch,
    commitSha,
    payload,
    receivedAt,
    state: "STATIC_AUDIT",
    submissionPending: 1,
  };
}

function attemptWriteFor(from: TaskState, to: TaskState, now: number): AttemptWrite | null {
  if (to === "STATIC_AUDIT") return { state: "submitted", endedAt: null, outcome: null };
  if (to === "ACCEPTED") return { state: "accepted", endedAt: now, outcome: "ACCEPTED" };
  if ((from === "STATIC_AUDIT" || from === "CLEAN_VERIFY") && to === "CODING") {
    return { state: "running", endedAt: null, outcome: null };
  }
  if (to === "ESCALATED" || to === "EXHAUSTED" || to === "CANCELLED" || to === "SUPERSEDED") {
    return { state: "rejected", endedAt: now, outcome: to };
  }
  if (to === "PARKED") return { state: "parked", endedAt: now, outcome: "PARKED" };
  if (to === "HUMAN_OWNED") return { state: "parked", endedAt: now, outcome: "HUMAN_OWNED" };
  return null;
}

/**
 * Multi-reason holds, atomic candidate acceptance, and the 15-state task graph.
 * Canonical `submit_candidate`, `accept_submission`, `finish_submission`,
 * `op_lookup`, and `register_delivery` are loaded from schema/queries.sql.
 */
export class TaskHoldAndSubmissionRepo {
  private readonly statements = new Map<string, SqlStatement>();

  constructor(
    private readonly db: StateConnection,
    private readonly queries: ReadonlyMap<string, string> = loadCanonicalQueries(),
  ) {
    for (const name of ["submit_candidate", "accept_submission", "finish_submission", "op_lookup", "register_delivery"]) {
      if (!this.queries.has(name)) throw new Error(`missing canonical query ${name}`);
    }
  }

  placeHold(input: PlaceHoldInput): PlaceHoldResult {
    this.assertHoldIdentity(input.reason, input.source);
    requireInt(input.now, "now");
    requireInt(input.rev, "rev");
    return this.inTransaction(() => {
      const before = this.requireRuntime(input.task);
      const inserted = this.sql(
        `INSERT OR IGNORE INTO task_holds(task, reason, source, created_at)
         VALUES (:task, :reason, :source, :now)`,
      ).run({ task: input.task, reason: input.reason, source: input.source, now: input.now });
      const placed = rowChanges(inserted) === 1;
      const hold = this.requireHold(input.task, input.reason, input.source);
      if (placed) {
        const remaining = this.listHolds(input.task).length;
        this.emitHoldEvent("TaskHoldPlaced", input.task, input.rev, input.now, {
          task: input.task,
          reason: input.reason,
          source: input.source,
          createdAt: hold.createdAt,
          remaining,
        });
      }
      const after = this.requireRuntime(input.task);
      this.assertRuntimeUntouched(before, after);
      return {
        placed,
        hold,
        taskState: after.state,
        epoch: after.epoch,
        submissionPending: after.submissionPending,
        holderAttempt: after.holderAttempt,
      };
    });
  }

  releaseHold(input: ReleaseHoldInput): ReleaseHoldResult {
    this.assertHoldIdentity(input.reason, input.source);
    requireInt(input.now, "now");
    requireInt(input.rev, "rev");
    return this.inTransaction(() => {
      const before = this.requireRuntime(input.task);
      const deleted = this.sql(
        `DELETE FROM task_holds WHERE task = :task AND reason = :reason AND source = :source`,
      ).run({ task: input.task, reason: input.reason, source: input.source });
      const removed = rowChanges(deleted) === 1;
      const remainingHolds = this.listHolds(input.task);
      if (removed) {
        this.emitHoldEvent("TaskHoldReleased", input.task, input.rev, input.now, {
          task: input.task,
          reason: input.reason,
          source: input.source,
          remaining: remainingHolds.length,
        });
        if (remainingHolds.length === 0) {
          this.emitHoldEvent("TaskUnheld", input.task, input.rev, input.now, {
            task: input.task,
            remaining: 0,
            released: { reason: input.reason, source: input.source },
          });
        }
      }
      const after = this.requireRuntime(input.task);
      this.assertRuntimeUntouched(before, after);
      return {
        removed,
        remainingHolds,
        taskState: after.state,
        epoch: after.epoch,
        submissionPending: after.submissionPending,
        holderAttempt: after.holderAttempt,
      };
    });
  }

  listActiveHolds(task: string): readonly TaskHold[] {
    this.requireRuntime(task);
    return this.listHolds(task);
  }

  isTaskHeld(task: string): boolean {
    this.requireRuntime(task);
    return this.listHolds(task).length > 0;
  }

  submitAndAcceptCandidate(input: SubmitCandidateInput): CandidateReceipt {
    requireInt(input.epoch, "epoch");
    requireInt(input.now, "now");
    requireInt(input.rev, "rev");
    if (input.candidateId.length === 0 || input.commitSha.length === 0 || input.attempt.length === 0) {
      throw new InvalidCandidatePayloadError({ reason: "candidate, attempt, and commit_sha are required" });
    }
    assertJsonPayload(input.payload);
    if (input.opId !== undefined && input.opId.length === 0) {
      throw new InvalidCandidatePayloadError({ reason: "opId must be a non-empty string when provided" });
    }
    return this.inTransaction(() => this.submitInside(input));
  }

  finishSubmission(
    input: { readonly task: string; readonly epoch: number; readonly nextState: FinishSubmissionState; readonly now: number; readonly rev: number },
  ): FinishSubmissionResult {
    requireInt(input.epoch, "epoch");
    requireInt(input.now, "now");
    requireInt(input.rev, "rev");
    if (!isFinishSubmissionState(input.nextState)) {
      throw new IllegalTaskTransitionError({
        task: input.task,
        from: "STATIC_AUDIT",
        to: String(input.nextState),
        reason: "finish_submission next state must be ACCEPTED, CODING, ESCALATED, or EXHAUSTED",
      });
    }
    return this.inTransaction(() => {
      const row = this.requireRuntime(input.task);
      if (row.epoch !== input.epoch) {
        throw new StaleEpochError({
          task: input.task,
          attempt: row.holderAttempt,
          expectedEpoch: input.epoch,
          actualEpoch: row.epoch,
        });
      }
      if (row.submissionPending !== 1) {
        throw new SubmissionAlreadyFinishedError({ task: input.task, epoch: input.epoch });
      }
      this.assertTransitionAllowed(row, input.nextState);
      if (!row.holderAttempt) {
        throw new StaleEpochError({
          task: input.task,
          attempt: null,
          expectedEpoch: input.epoch,
          actualEpoch: row.epoch,
        });
      }
      this.assertAttemptCurrent(row.holderAttempt, input.task, input.epoch);
      const finished = this.named("finish_submission").run({
        task: input.task,
        epoch: input.epoch,
        next_state: input.nextState,
        rev: input.rev,
      });
      if (rowChanges(finished) !== 1) {
        throw new SubmissionAlreadyFinishedError({ task: input.task, epoch: input.epoch });
      }
      const write = attemptWriteFor(row.state, input.nextState, input.now);
      if (!write) {
        throw new IllegalTaskTransitionError({
          task: input.task,
          from: row.state,
          to: input.nextState,
          reason: "finish_submission has no attempt update for this edge",
        });
      }
      this.writeAttempt(row.holderAttempt, write);
      const after = this.requireRuntime(input.task);
      const attempt = this.readAttempt(row.holderAttempt);
      return {
        task: input.task,
        epoch: after.epoch,
        fromState: row.state,
        nextState: after.state,
        submissionPending: 0,
        holderAttempt: after.holderAttempt,
        attemptState: attempt?.state ?? null,
        attemptEndedAt: attempt?.endedAt ?? null,
      };
    });
  }

  transitionTaskState(input: TransitionTaskInput): TransitionTaskResult {
    requireInt(input.epoch, "epoch");
    requireInt(input.now, "now");
    requireInt(input.rev, "rev");
    if (!isTaskState(input.to)) {
      throw new IllegalTaskTransitionError({
        task: input.task,
        from: "DRAFTED",
        to: String(input.to),
        reason: "unknown task state",
      });
    }
    return this.inTransaction(() => this.applyTransition(this.requireRuntime(input.task), input.to, input.epoch, input.rev, input.now));
  }

  parkTask(input: ParkTaskInput): TransitionTaskResult {
    requireInt(input.epoch, "epoch");
    requireInt(input.now, "now");
    requireInt(input.rev, "rev");
    requireInt(input.checkpoint.step, "checkpoint.step");
    if (input.checkpoint.wipRef.length === 0) {
      throw new Error("park checkpoint wipRef is required");
    }
    const contractVersions = input.checkpoint.contractVersions ?? "{}";
    const pendingEffects = input.checkpoint.pendingEffects ?? "[]";
    assertJsonObject(contractVersions, "contractVersions");
    assertJsonArray(pendingEffects, "pendingEffects");
    return this.inTransaction(() => {
      const row = this.requireRuntime(input.task);
      if (row.epoch !== input.epoch) {
        throw new StaleEpochError({
          task: input.task,
          attempt: row.holderAttempt,
          expectedEpoch: input.epoch,
          actualEpoch: row.epoch,
        });
      }
      if (!row.holderAttempt) {
        throw new IllegalTaskTransitionError({
          task: input.task,
          from: row.state,
          to: "PARKED",
          reason: "park requires an active attempt",
        });
      }
      this.assertAttemptCurrent(row.holderAttempt, input.task, input.epoch);
      const holdsBefore = this.listHolds(input.task);
      this.sql(
        `INSERT INTO attempt_checkpoints(
           attempt, step, wip_ref, session_ref, contract_versions, pending_effects, handoff_artifact, updated_at
         ) VALUES (
           :attempt, :step, :wip_ref, :session_ref, :contract_versions, :pending_effects, :handoff_artifact, :updated_at
         )
         ON CONFLICT(attempt) DO UPDATE SET
           step = excluded.step,
           wip_ref = excluded.wip_ref,
           session_ref = excluded.session_ref,
           contract_versions = excluded.contract_versions,
           pending_effects = excluded.pending_effects,
           handoff_artifact = excluded.handoff_artifact,
           updated_at = excluded.updated_at`,
      ).run({
        attempt: row.holderAttempt,
        step: input.checkpoint.step,
        wip_ref: input.checkpoint.wipRef,
        session_ref: input.checkpoint.sessionRef ?? null,
        contract_versions: contractVersions,
        pending_effects: pendingEffects,
        handoff_artifact: input.checkpoint.handoffNote ?? null,
        updated_at: input.now,
      });
      const result = this.applyTransition(row, "PARKED", input.epoch, input.rev, input.now);
      const holdsAfter = this.listHolds(input.task);
      if (holdsAfter.length !== holdsBefore.length) {
        throw new Error(`park changed hold count for ${input.task}`);
      }
      return result;
    });
  }

  resumeParkedTask(input: ResumeParkedTaskInput): TransitionTaskResult {
    requireInt(input.epoch, "epoch");
    requireInt(input.now, "now");
    requireInt(input.rev, "rev");
    if (!isResumptionTrigger(input.trigger)) {
      throw new ResumptionPolicyError({ task: input.task });
    }
    return this.inTransaction(() => {
      const row = this.requireRuntime(input.task);
      if (row.state !== "PARKED") {
        throw new IllegalTaskTransitionError({
          task: input.task,
          from: row.state,
          to: "READY",
          reason: "resume applies only to PARKED",
        });
      }
      const holds = this.listHolds(input.task);
      if (holds.length > 0) {
        throw new TaskHeldError({
          task: input.task,
          holds: holds.map((hold) => ({ reason: hold.reason, source: hold.source })),
        });
      }
      return this.applyTransition(row, "READY", input.epoch, input.rev, input.now);
    });
  }

  /**
   * Transaction guard for worker mutations. Call it inside the caller's
   * BEGIN IMMEDIATE transaction. It does not open a transaction itself.
   */
  assertCurrentEpoch(input: AssertEpochInput): EpochFence {
    requireInt(input.epoch, "epoch");
    const row = this.requireRuntime(input.task);
    this.assertHolderMatches(row, input.attempt, input.epoch);
    this.assertAttemptCurrent(input.attempt, input.task, input.epoch);
    return { task: input.task, attempt: input.attempt, epoch: input.epoch };
  }

  private submitInside(input: SubmitCandidateInput): CandidateReceipt {
    const row = this.requireRuntime(input.task);
    const hash = submitRequestHash(input);
    if (input.opId) {
      const stored = this.lookupOperation(input.opId, hash, input);
      if (stored) {
        this.assertReplayCurrent(row, stored);
        return stored;
      }
    }
    const existing = this.findCandidate(input.task, input.attempt, input.commitSha);
    if (existing) {
      return this.replayCandidate(row, existing, input, hash);
    }
    this.assertHolderMatches(row, input.attempt, input.epoch);
    this.assertAttemptCurrent(input.attempt, input.task, input.epoch);
    try {
      const inserted = this.named("submit_candidate").run({
        candidate: input.candidateId,
        task: input.task,
        attempt: input.attempt,
        epoch: input.epoch,
        commit_sha: input.commitSha,
        payload: input.payload,
        now: input.now,
      });
      if (rowChanges(inserted) !== 1) {
        throw new StaleEpochError({
          task: input.task,
          attempt: input.attempt,
          expectedEpoch: input.epoch,
          actualEpoch: row.epoch,
        });
      }
    } catch (error) {
      if (error instanceof StaleEpochError) throw error;
      if (!isUniqueConstraint(error)) throw error;
      const raced = this.findCandidate(input.task, input.attempt, input.commitSha);
      if (!raced) throw error;
      return this.replayCandidate(row, raced, input, hash);
    }
    this.acceptNewCandidate(row, input);
    const receipt = receiptFromCandidate({
      id: input.candidateId,
      task: input.task,
      attempt: input.attempt,
      epoch: input.epoch,
      commitSha: input.commitSha,
      payload: input.payload,
      receivedAt: input.now,
    });
    this.rememberOperation(input, hash, receipt);
    return receipt;
  }

  private acceptNewCandidate(row: RuntimeRow, input: SubmitCandidateInput): void {
    const accepted = this.named("accept_submission").run({
      task: input.task,
      attempt: input.attempt,
      epoch: input.epoch,
      rev: input.rev,
    });
    if (rowChanges(accepted) !== 1) {
      throw new IllegalTaskTransitionError({
        task: input.task,
        from: row.state,
        to: "STATIC_AUDIT",
        reason: "accept_submission only moves LEASED or CODING at the current epoch",
      });
    }
    this.writeAttempt(input.attempt, { state: "submitted", endedAt: null, outcome: null });
  }

  private replayCandidate(
    row: RuntimeRow,
    existing: CandidateRow,
    input: SubmitCandidateInput,
    hash: string,
  ): CandidateReceipt {
    if (existing.payload !== input.payload) {
      throw new DuplicateCandidateError({
        task: input.task,
        attempt: input.attempt,
        commitSha: input.commitSha,
        opId: input.opId ?? null,
        reason: "payload_conflict",
      });
    }
    const receipt = receiptFromCandidate(existing);
    this.assertReplayCurrent(row, receipt);
    if (row.state === "LEASED" || row.state === "CODING") {
      this.acceptNewCandidate(row, { ...input, candidateId: existing.id, epoch: existing.epoch });
    }
    this.rememberOperation(input, hash, receipt);
    return receipt;
  }

  private assertReplayCurrent(row: RuntimeRow, receipt: CandidateReceipt): void {
    if (row.epoch !== receipt.epoch || row.holderAttempt !== receipt.attempt) {
      throw new StaleEpochError({
        task: row.task,
        attempt: receipt.attempt,
        expectedEpoch: receipt.epoch,
        actualEpoch: row.epoch,
      });
    }
  }

  private lookupOperation(opId: string, hash: string, input: SubmitCandidateInput): CandidateReceipt | null {
    const found = this.named("op_lookup").get({ op_id: opId, request_hash: hash });
    if (!found) return null;
    const same = asNumber(found.same_request);
    if (same !== 1) {
      throw new DuplicateCandidateError({
        task: input.task,
        attempt: input.attempt,
        commitSha: input.commitSha,
        opId,
        reason: "op_id_reused",
      });
    }
    const result = found.result;
    if (typeof result !== "string") throw new Error("operations.result is not text");
    return parseReceipt(result);
  }

  private rememberOperation(input: SubmitCandidateInput, hash: string, receipt: CandidateReceipt): void {
    if (!input.opId) return;
    const existing = this.named("op_lookup").get({ op_id: input.opId, request_hash: hash });
    if (existing) return;
    this.sql(
      `INSERT INTO operations(op_id, kind, request_hash, result, committed_rev, created_at)
       VALUES (:op_id, 'submit_candidate', :request_hash, :result, :rev, :now)`,
    ).run({
      op_id: input.opId,
      request_hash: hash,
      result: JSON.stringify(receipt),
      rev: input.rev,
      now: input.now,
    });
  }

  private applyTransition(
    row: RuntimeRow,
    to: TaskState,
    epoch: number,
    rev: number,
    now: number,
  ): TransitionTaskResult {
    if (row.epoch !== epoch) {
      throw new StaleEpochError({
        task: row.task,
        attempt: row.holderAttempt,
        expectedEpoch: epoch,
        actualEpoch: row.epoch,
      });
    }
    this.assertTransitionAllowed(row, to);
    const pending = submissionPendingAfter(to);
    const holder = clearsHolder(to) ? null : row.holderAttempt;
    const lease = clearsHolder(to) ? null : row.leaseExpiresAt;
    const attemptId = row.holderAttempt;
    const write = attemptId ? attemptWriteFor(row.state, to, now) : null;
    if (write && attemptId) this.writeAttempt(attemptId, write);
    const updated = this.sql(
      `UPDATE task_runtime
          SET state = :state,
              submission_pending = :submission_pending,
              holder_attempt = :holder_attempt,
              lease_expires_at = :lease_expires_at,
              updated_rev = :rev
        WHERE task = :task AND state = :from_state AND epoch = :epoch`,
    ).run({
      state: to,
      submission_pending: pending,
      holder_attempt: holder,
      lease_expires_at: lease,
      rev,
      task: row.task,
      from_state: row.state,
      epoch,
    });
    if (rowChanges(updated) !== 1) {
      const current = this.requireRuntime(row.task);
      if (current.epoch !== epoch) {
        throw new StaleEpochError({
          task: row.task,
          attempt: attemptId,
          expectedEpoch: epoch,
          actualEpoch: current.epoch,
        });
      }
      throw new IllegalTaskTransitionError({
        task: row.task,
        from: row.state,
        to,
        reason: "task state changed before the transition committed",
      });
    }
    return {
      task: row.task,
      fromState: row.state,
      state: to,
      epoch,
      submissionPending: pending,
      holderAttempt: holder,
    };
  }

  private assertTransitionAllowed(row: RuntimeRow, to: TaskState): void {
    if (to === "ACCEPTED" && (row.state !== "CLEAN_VERIFY" || row.submissionPending !== 1)) {
      throw new IllegalTaskTransitionError({
        task: row.task,
        from: row.state,
        to,
        reason: "ACCEPTED must pass through STATIC_AUDIT and CLEAN_VERIFY with submission_pending = 1",
      });
    }
    if (to === "CLEAN_VERIFY" && (row.state !== "STATIC_AUDIT" || row.submissionPending !== 1)) {
      throw new IllegalTaskTransitionError({
        task: row.task,
        from: row.state,
        to,
        reason: "CLEAN_VERIFY is only legal from STATIC_AUDIT with submission_pending = 1 and the current epoch",
      });
    }
    if (to === "MERGED_TO_FEATURE" && row.state !== "ACCEPTED") {
      throw new IllegalTaskTransitionError({
        task: row.task,
        from: row.state,
        to,
        reason: "MERGED_TO_FEATURE is only legal from ACCEPTED",
      });
    }
    if (TASK_STATE_FLAGS[row.state].terminal) {
      throw new IllegalTaskTransitionError({
        task: row.task,
        from: row.state,
        to,
        reason: "terminal states cannot transition",
      });
    }
    if (!isLegalTaskTransition(row.state, to)) {
      throw new IllegalTaskTransitionError({
        task: row.task,
        from: row.state,
        to,
        reason: "edge is not in TASK_STATE_TRANSITIONS",
      });
    }
    if ((to === "LEASED" || (row.state === "PARKED" && to === "READY")) && this.listHolds(row.task).length > 0) {
      throw new TaskHeldError({
        task: row.task,
        holds: this.listHolds(row.task).map((hold) => ({ reason: hold.reason, source: hold.source })),
      });
    }
  }

  private assertHolderMatches(row: RuntimeRow, attempt: string, epoch: number): void {
    if (row.epoch !== epoch || row.holderAttempt !== attempt) {
      throw new StaleEpochError({
        task: row.task,
        attempt,
        expectedEpoch: epoch,
        actualEpoch: row.epoch,
      });
    }
  }

  private assertAttemptCurrent(attemptId: string, task: string, epoch: number): void {
    const attempt = this.readAttempt(attemptId);
    if (!attempt || attempt.task !== task || attempt.epoch !== epoch || attempt.state === "fenced") {
      throw new StaleEpochError({
        task,
        attempt: attemptId,
        expectedEpoch: epoch,
        actualEpoch: attempt?.epoch ?? null,
      });
    }
  }

  private writeAttempt(attemptId: string, write: AttemptWrite): void {
    this.sql(
      `UPDATE attempts
          SET state = :state, ended_at = :ended_at, outcome = :outcome
        WHERE id = :id`,
    ).run({
      id: attemptId,
      state: write.state,
      ended_at: write.endedAt,
      outcome: write.outcome,
    });
  }

  private emitHoldEvent(
    type: "TaskHoldPlaced" | "TaskHoldReleased" | "TaskUnheld",
    task: string,
    rev: number,
    now: number,
    payload: Readonly<Record<string, unknown>>,
  ): void {
    const eventId = randomUUID();
    this.sql(
      `INSERT INTO outbox(id, type, subject, rev, payload, created_at)
       VALUES (:id, :type, :subject, :rev, :payload, :created_at)`,
    ).run({
      id: eventId,
      type,
      subject: task,
      rev,
      payload: JSON.stringify(payload),
      created_at: now,
    });
    for (const consumer of HOLD_EVENT_CONSUMERS) {
      this.named("register_delivery").run({ event_id: eventId, consumer });
    }
  }

  private listHolds(task: string): TaskHold[] {
    const rows = this.sql(
      `SELECT task, reason, source, created_at
         FROM task_holds
        WHERE task = :task
        ORDER BY created_at ASC, reason ASC, source ASC`,
    ).all({ task });
    return rows.map((row) => {
      const reason = asText(row, "reason");
      if (!isStoredHoldReason(reason)) throw new InvalidHoldReasonError({ reason });
      const createdAt = asNumber(row.created_at);
      if (createdAt === null) throw new Error("task_holds.created_at is not an integer");
      return { task: asText(row, "task"), reason, source: asText(row, "source"), createdAt };
    });
  }

  private requireHold(task: string, reason: string, source: string): TaskHold {
    const row = this.sql(
      `SELECT task, reason, source, created_at
         FROM task_holds
        WHERE task = :task AND reason = :reason AND source = :source`,
    ).get({ task, reason, source });
    if (!row) throw new Error(`hold ${task}/${reason}/${source} disappeared`);
    const createdAt = asNumber(row.created_at);
    if (!isStoredHoldReason(reason) || createdAt === null) throw new InvalidHoldReasonError({ reason });
    return { task, reason, source, createdAt };
  }

  private findCandidate(task: string, attempt: string, commitSha: string): CandidateRow | null {
    const row = this.sql(
      `SELECT id, task, attempt, epoch, commit_sha, payload, received_at
         FROM candidates
        WHERE task = :task AND attempt = :attempt AND commit_sha = :commit_sha`,
    ).get({ task, attempt, commit_sha: commitSha });
    if (!row) return null;
    const epoch = asNumber(row.epoch);
    const receivedAt = asNumber(row.received_at);
    if (epoch === null || receivedAt === null) throw new Error("candidate row is incomplete");
    return {
      id: asText(row, "id"),
      task: asText(row, "task"),
      attempt: asText(row, "attempt"),
      epoch,
      commitSha: asText(row, "commit_sha"),
      payload: asText(row, "payload"),
      receivedAt,
    };
  }

  private requireRuntime(task: string): RuntimeRow {
    const row = this.sql(
      `SELECT task, state, epoch, holder_attempt, lease_expires_at, submission_pending, updated_rev
         FROM task_runtime WHERE task = :task`,
    ).get({ task });
    if (!row) throw new TaskNotFoundError({ task });
    const state = asText(row, "state");
    if (!isTaskState(state)) throw new Error(`task ${task} has unknown state ${state}`);
    const epoch = asNumber(row.epoch);
    const pending = asNumber(row.submission_pending);
    const updatedRev = asNumber(row.updated_rev);
    if (epoch === null || updatedRev === null || (pending !== 0 && pending !== 1)) {
      throw new Error(`task_runtime row ${task} is incomplete`);
    }
    return {
      task,
      state,
      epoch,
      holderAttempt: asNullableText(row, "holder_attempt"),
      leaseExpiresAt: asNumber(row.lease_expires_at),
      submissionPending: pending,
      updatedRev,
    };
  }

  private readAttempt(attemptId: string): AttemptRow | null {
    const row = this.sql(
      `SELECT id, task, epoch, state, ended_at FROM attempts WHERE id = :id`,
    ).get({ id: attemptId });
    if (!row) return null;
    const epoch = asNumber(row.epoch);
    if (epoch === null) throw new Error(`attempt ${attemptId} has no epoch`);
    return {
      id: asText(row, "id"),
      task: asText(row, "task"),
      epoch,
      state: asText(row, "state"),
      endedAt: asNumber(row.ended_at),
    };
  }

  private assertRuntimeUntouched(before: RuntimeRow, after: RuntimeRow): void {
    if (
      before.state !== after.state ||
      before.epoch !== after.epoch ||
      before.holderAttempt !== after.holderAttempt ||
      before.leaseExpiresAt !== after.leaseExpiresAt ||
      before.submissionPending !== after.submissionPending ||
      before.updatedRev !== after.updatedRev
    ) {
      throw new Error(`hold write mutated task_runtime for ${before.task}`);
    }
  }

  private assertHoldIdentity(reason: string, source: string): void {
    if (!isStoredHoldReason(reason)) throw new InvalidHoldReasonError({ reason });
    if (source.length === 0) throw new Error("hold source is required");
  }

  private named(name: string): SqlStatement {
    const sql = this.queries.get(name);
    if (!sql) throw new Error(`missing canonical query ${name}`);
    return this.sql(sql);
  }

  private sql(text: string): SqlStatement {
    const cached = this.statements.get(text);
    if (cached) return cached;
    const statement = this.db.prepare(text);
    this.statements.set(text, statement);
    return statement;
  }

  private inTransaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch (rollbackError) {
        const message = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        throw new Error(`rollback failed after ${error instanceof Error ? error.message : String(error)}: ${message}`);
      }
      throw error;
    }
  }
}

function assertJsonObject(value: string, label: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
}

function assertJsonArray(value: string, label: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array`);
}

export function createTaskHoldAndSubmissionRepo(
  connection: StateConnection,
  queriesSql?: string,
): TaskHoldAndSubmissionRepo {
  return new TaskHoldAndSubmissionRepo(connection, loadCanonicalQueries(queriesSql));
}
