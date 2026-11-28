import { AttemptCheckpointRepo, openStateConnection, type SqlConnection } from "@ef-harness/db";
import { defaultCheckpointUpcasters } from "@ef-harness/shared-contracts";
import { ResumeError } from "./errors.js";
import type {
  DeltaKind,
  ForeignRuntimeCheckpoint,
  IdleWaitKind,
  ParkReason,
  TimelineEntry,
} from "./types.js";
import { PARK_REASONS, IDLE_WAIT_KINDS } from "./types.js";

/**
 * Foreign-runtime rows live in `attempt_checkpoints.contract_versions` under
 * `foreignRuntimeCheckpoint`. Sibling keys written by Task 053 stay in place.
 * The connection is `@ef-harness/db` `openStateConnection` (schema/state.sql).
 */
export const FOREIGN_RUNTIME_CHECKPOINT_KEY = "foreignRuntimeCheckpoint";

export interface AttemptCheckpointStore {
  save(record: ForeignRuntimeCheckpoint, updatedAt: number): void;
  get(attemptId: string): ForeignRuntimeCheckpoint | null;
}

export interface CheckpointStoreOptions {
  readonly database?: SqlConnection;
  /** When true, insert the task, runtime, and attempt rows the frozen foreign keys need. */
  readonly ensureAttemptRow?: boolean;
}

export class SqliteAttemptCheckpointStore implements AttemptCheckpointStore {
  private readonly db: SqlConnection;
  private readonly checkpoints: AttemptCheckpointRepo;
  private readonly ensureAttemptRow: boolean;
  private failNext = false;

  constructor(options: CheckpointStoreOptions = {}) {
    this.db = options.database ?? openStateConnection();
    this.checkpoints = new AttemptCheckpointRepo(this.db);
    this.ensureAttemptRow = options.ensureAttemptRow ?? true;
  }

  /** Test hook. The next save aborts inside the transaction and leaves the prior row intact. */
  failNextTransaction(): void {
    this.failNext = true;
  }

  save(record: ForeignRuntimeCheckpoint, updatedAt: number): void {
    upcastHeader(record, updatedAt);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.failNext) {
        this.failNext = false;
        throw new ResumeError("store_fault", "Injected checkpoint transaction fault");
      }
      if (this.ensureAttemptRow) this.ensureGraph(record, updatedAt);
      const existing = this.existingContract(record.attemptId);
      const payload = JSON.stringify(mergeContract(existing, record));
      this.db
        .prepare(
          `INSERT INTO attempt_checkpoints (
             attempt, step, wip_ref, session_ref, contract_versions, pending_effects, handoff_artifact, updated_at
           ) VALUES (
             :attempt, :step, :wip_ref, :session_ref, :contract_versions, :pending_effects, :handoff_artifact, :updated_at
           )
           ON CONFLICT(attempt) DO UPDATE SET
             step = excluded.step,
             wip_ref = excluded.wip_ref,
             session_ref = excluded.session_ref,
             contract_versions = excluded.contract_versions,
             pending_effects = attempt_checkpoints.pending_effects,
             handoff_artifact = excluded.handoff_artifact,
             updated_at = excluded.updated_at`,
        )
        .run({
          attempt: record.attemptId,
          step: record.step,
          wip_ref: record.wipTreeSha,
          session_ref: record.nativeSessionId,
          contract_versions: payload,
          pending_effects: "[]",
          handoff_artifact: record.lastHandoff,
          updated_at: updatedAt,
        });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  get(attemptId: string): ForeignRuntimeCheckpoint | null {
    const row = this.db
      .prepare("SELECT contract_versions FROM attempt_checkpoints WHERE attempt = :attempt")
      .get({ attempt: attemptId });
    if (!row) return null;
    const raw = row.contract_versions;
    if (typeof raw !== "string") {
      throw new ResumeError("store", `Checkpoint ${attemptId} is missing contract_versions`);
    }
    return parseStoredCheckpoint(raw, attemptId);
  }

  /** Frozen-column projection for inspectors that read `attempt_checkpoints` directly. */
  projection(attemptId: string): {
    readonly attempt: string;
    readonly step: number;
    readonly wipRef: string | null;
    readonly sessionRef: string | null;
    readonly handoffArtifact: string | null;
  } | null {
    const row = this.db
      .prepare(
        `SELECT attempt, step, wip_ref, session_ref, handoff_artifact
           FROM attempt_checkpoints WHERE attempt = :attempt`,
      )
      .get({ attempt: attemptId });
    if (!row) return null;
    return {
      attempt: stringField(row.attempt, "attempt"),
      step: numberField(row.step, "step"),
      wipRef: nullableString(row.wip_ref),
      sessionRef: nullableString(row.session_ref),
      handoffArtifact: nullableString(row.handoff_artifact),
    };
  }

  private existingContract(attemptId: string): Record<string, unknown> {
    const raw = this.rawContract(attemptId);
    const parsed = raw ? parseObject(raw) : {};
    try {
      const native = this.checkpoints.read(attemptId);
      if (!native) return parsed;
      return { ...native.contractVersions, ...parsed };
    } catch (error) {
      if (error instanceof Error && error.message.includes("must be an integer")) return parsed;
      throw error;
    }
  }

  private rawContract(attemptId: string): string | null {
    const row = this.db
      .prepare("SELECT contract_versions FROM attempt_checkpoints WHERE attempt = :attempt")
      .get({ attempt: attemptId });
    if (!row) return null;
    return typeof row.contract_versions === "string" ? row.contract_versions : null;
  }

  private ensureGraph(record: ForeignRuntimeCheckpoint, updatedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO change_sets(id, rev, origin, author, created_at)
         VALUES ('CS-resume', 1, 'kernel', 'resume', 0)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run();
    this.db
      .prepare(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
         VALUES (:id, 'task', 1, :hash, :title, '', '{}', 'CS-resume', 1, 1)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run({
        id: record.attemptId,
        hash: `h-${record.attemptId}`,
        title: record.attemptId,
      });
    this.db
      .prepare(
        `INSERT INTO task_runtime(task, feature, state, level, epoch, updated_rev)
         VALUES (:task, 'F-resume', 'READY', 'Mid', 1, 1)
         ON CONFLICT(task) DO NOTHING`,
      )
      .run({ task: record.attemptId });
    this.db
      .prepare(
        `INSERT INTO attempts(
           id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at
         ) VALUES (
           :id, :task, 1, 1, 1, :runtime, 'model', 'connection', :base, 'parked', :started
         )
         ON CONFLICT(id) DO NOTHING`,
      )
      .run({
        id: record.attemptId,
        task: record.attemptId,
        runtime: record.adapterId,
        base: record.pinnedBaseCommitSha,
        started: updatedAt,
      });
  }
}

function upcastHeader(record: ForeignRuntimeCheckpoint, updatedAt: number): void {
  if (record.attemptId.length === 0 || record.attemptId.length > 128) return;
  const step = Math.trunc(record.step);
  const at = Math.trunc(updatedAt);
  if (step < 0 || at < 0) return;
  defaultCheckpointUpcasters.upcast({
    format_version: 0,
    attempt: record.attemptId,
    step,
    updated_at: at,
  });
}

function mergeContract(existing: Record<string, unknown>, record: ForeignRuntimeCheckpoint): Record<string, unknown> {
  return {
    ...existing,
    [FOREIGN_RUNTIME_CHECKPOINT_KEY]: record,
  };
}

function parseObject(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid json";
    throw new ResumeError("store", `Checkpoint JSON is unreadable: ${message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return { ...parsed };
}

function parseStoredCheckpoint(raw: string, attemptId: string): ForeignRuntimeCheckpoint {
  const envelope = parseObject(raw);
  return asCheckpoint(envelope[FOREIGN_RUNTIME_CHECKPOINT_KEY], attemptId);
}

function asCheckpoint(value: unknown, attemptId: string): ForeignRuntimeCheckpoint {
  if (!value || typeof value !== "object") {
    throw new ResumeError("store", `Checkpoint ${attemptId} is missing ${FOREIGN_RUNTIME_CHECKPOINT_KEY}`);
  }
  const record = value as Record<string, unknown>;
  const parkReason = optionalEnum(record.parkReason, PARK_REASONS);
  const idleKind = optionalEnum(record.idleKind, IDLE_WAIT_KINDS);
  return {
    attemptId: stringField(record.attemptId, "attemptId"),
    adapterId: stringField(record.adapterId, "adapterId"),
    adapterVersion: stringField(record.adapterVersion, "adapterVersion"),
    nativeSessionId: nullableString(record.nativeSessionId),
    pinnedBaseCommitSha: stringField(record.pinnedBaseCommitSha, "pinnedBaseCommitSha"),
    pinnedSliceSha256: stringField(record.pinnedSliceSha256, "pinnedSliceSha256"),
    wipTreeSha: stringField(record.wipTreeSha, "wipTreeSha"),
    modifiedFiles: stringList(record.modifiedFiles),
    lastStepSummary: stringField(record.lastStepSummary, "lastStepSummary"),
    lastVerificationError: nullableString(record.lastVerificationError),
    parkedAt: nullableNumber(record.parkedAt),
    parkReason,
    resumeFailCount: numberField(record.resumeFailCount, "resumeFailCount"),
    disableNativeResumeForAttempt: record.disableNativeResumeForAttempt === true,
    contextUtilization: numberField(record.contextUtilization, "contextUtilization"),
    step: numberField(record.step, "step"),
    residentRamMb: numberField(record.residentRamMb, "residentRamMb"),
    idleKind,
    idleSince: nullableNumber(record.idleSince),
    childPid: nullableNumber(record.childPid),
    processAlive: record.processAlive === true,
    briefText: stringField(record.briefText, "briefText"),
    requirements: stringList(record.requirements),
    timeline: timeline(record.timeline),
    worktreePath: stringField(record.worktreePath, "worktreePath"),
    slotId: stringField(record.slotId, "slotId"),
    lastHandoff: nullableString(record.lastHandoff),
  };
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string") throw new ResumeError("store", `${label} must be a string`);
  return value;
}

function numberField(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ResumeError("store", `${label} must be a finite number`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new ResumeError("store", "expected a string or null");
  return value;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ResumeError("store", "expected a number or null");
  }
  return value;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ResumeError("store", "expected a string list");
  }
  return value;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ResumeError("store", `unexpected enum value ${String(value)}`);
  }
  return value as T;
}

function timeline(value: unknown): TimelineEntry[] {
  if (!Array.isArray(value)) throw new ResumeError("store", "timeline must be a list");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new ResumeError("store", "timeline entry is not an object");
    const record = entry as Record<string, unknown>;
    return {
      at: numberField(record.at, "timeline.at"),
      message: stringField(record.message, "timeline.message"),
    };
  });
}

export function isParkReason(value: string): value is ParkReason {
  return (PARK_REASONS as readonly string[]).includes(value);
}

export function isIdleWaitKind(value: string): value is IdleWaitKind {
  return (IDLE_WAIT_KINDS as readonly string[]).includes(value);
}

export function isDeltaKind(value: string): value is DeltaKind {
  return value === "none" || value === "additive" || value === "contradictory";
}
