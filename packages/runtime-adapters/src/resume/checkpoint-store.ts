import { DatabaseSync } from "node:sqlite";
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
 * Local port of Task 053 `AttemptCheckpointStore` on the frozen
 * `attempt_checkpoints` table. Rich foreign-runtime fields live in
 * `contract_versions.foreignRuntimeCheckpoint` because `schema/state.sql`
 * cannot be altered from this task.
 */
export const FOREIGN_RUNTIME_CHECKPOINT_KEY = "foreignRuntimeCheckpoint";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS attempt_checkpoints (
  attempt           TEXT PRIMARY KEY REFERENCES attempts(id),
  step              INTEGER NOT NULL,
  wip_ref           TEXT,
  session_ref       TEXT,
  contract_versions TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(contract_versions)),
  pending_effects   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(pending_effects)),
  handoff_artifact  TEXT,
  updated_at        INTEGER NOT NULL
);
`;

export interface AttemptCheckpointStore {
  save(record: ForeignRuntimeCheckpoint, updatedAt: number): void;
  get(attemptId: string): ForeignRuntimeCheckpoint | null;
}

export interface CheckpointStoreOptions {
  readonly database?: DatabaseSync;
  /** When true, ensure a stub `attempts` row so the frozen foreign key holds. */
  readonly ensureAttemptRow?: boolean;
}

export class SqliteAttemptCheckpointStore implements AttemptCheckpointStore {
  private readonly db: DatabaseSync;
  private readonly ensureAttemptRow: boolean;
  private failNext = false;

  constructor(options: CheckpointStoreOptions = {}) {
    this.db = options.database ?? new DatabaseSync(":memory:");
    this.ensureAttemptRow = options.ensureAttemptRow ?? true;
    this.db.exec(SCHEMA);
  }

  /** Test hook. The next save aborts inside the transaction and leaves the prior row intact. */
  failNextTransaction(): void {
    this.failNext = true;
  }

  save(record: ForeignRuntimeCheckpoint, updatedAt: number): void {
    const payload = JSON.stringify({ [FOREIGN_RUNTIME_CHECKPOINT_KEY]: record });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.failNext) {
        this.failNext = false;
        throw new ResumeError("store_fault", "Injected checkpoint transaction fault");
      }
      if (this.ensureAttemptRow) {
        this.db.prepare("INSERT INTO attempts (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run(record.attemptId);
      }
      this.db
        .prepare(
          `INSERT INTO attempt_checkpoints (
             attempt, step, wip_ref, session_ref, contract_versions, pending_effects, handoff_artifact, updated_at
           ) VALUES (?, ?, ?, ?, ?, '[]', ?, ?)
           ON CONFLICT(attempt) DO UPDATE SET
             step = excluded.step,
             wip_ref = excluded.wip_ref,
             session_ref = excluded.session_ref,
             contract_versions = excluded.contract_versions,
             pending_effects = excluded.pending_effects,
             handoff_artifact = excluded.handoff_artifact,
             updated_at = excluded.updated_at`,
        )
        .run(
          record.attemptId,
          record.step,
          record.wipTreeSha,
          record.nativeSessionId,
          payload,
          record.lastHandoff,
          updatedAt,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  get(attemptId: string): ForeignRuntimeCheckpoint | null {
    const row = this.db
      .prepare("SELECT contract_versions FROM attempt_checkpoints WHERE attempt = ?")
      .get(attemptId);
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
        "SELECT attempt, step, wip_ref, session_ref, handoff_artifact FROM attempt_checkpoints WHERE attempt = ?",
      )
      .get(attemptId);
    if (!row) return null;
    return {
      attempt: stringField(row.attempt, "attempt"),
      step: numberField(row.step, "step"),
      wipRef: nullableString(row.wip_ref),
      sessionRef: nullableString(row.session_ref),
      handoffArtifact: nullableString(row.handoff_artifact),
    };
  }
}

function parseStoredCheckpoint(raw: string, attemptId: string): ForeignRuntimeCheckpoint {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid json";
    throw new ResumeError("store", `Checkpoint ${attemptId} JSON is unreadable: ${message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ResumeError("store", `Checkpoint ${attemptId} payload is not an object`);
  }
  const envelope = parsed as Record<string, unknown>;
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
