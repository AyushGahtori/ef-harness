import { DatabaseSync } from "node:sqlite";

import { holdKey, kernelReasonFor } from "./format.js";
import {
  HoldEngineError,
  type ActiveHold,
  type CheckpointView,
  type ClarificationCard,
  type ClarificationOption,
  type HoldMode,
  type KernelHoldReason,
  type QuarantinedCandidate,
  type ReadingChangeKind,
  type TaskSnapshot,
  type WipFile,
} from "./types.js";

export const HOLD_SCHEMA_SQL = `
CREATE TABLE task_runtime (
  task TEXT PRIMARY KEY,
  feature TEXT NOT NULL,
  state TEXT NOT NULL,
  level TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  holder_attempt TEXT,
  lease_expires_at INTEGER,
  submission_pending INTEGER NOT NULL CHECK (submission_pending IN (0, 1)),
  updated_rev INTEGER NOT NULL
) STRICT;

CREATE TABLE task_holds (
  task TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task, reason, source)
) STRICT;

CREATE TABLE hold_reason_details (
  task TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  reason_type TEXT NOT NULL,
  reason_ref_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('HARD_HOLD', 'SOFT_HOLD')),
  quarantine INTEGER NOT NULL CHECK (quarantine IN (0, 1)),
  explanation TEXT NOT NULL,
  message_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task, reason, source)
) STRICT;

CREATE TABLE task_checkpoints (
  task TEXT PRIMARY KEY,
  feature TEXT NOT NULL,
  label TEXT NOT NULL,
  progress REAL NOT NULL,
  state TEXT NOT NULL,
  slice_sha256 TEXT NOT NULL,
  brief_text TEXT NOT NULL,
  requirements_json TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  session_ref TEXT NOT NULL,
  step INTEGER NOT NULL,
  wip_json TEXT NOT NULL,
  critical_path INTEGER NOT NULL CHECK (critical_path IN (0, 1))
) STRICT;

CREATE TABLE feature_heads (
  feature TEXT PRIMARY KEY,
  commit_sha TEXT NOT NULL
) STRICT;

CREATE TABLE ambiguous_readings (
  message_id TEXT NOT NULL,
  reading_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  label TEXT NOT NULL,
  change_kind TEXT NOT NULL,
  delta_text TEXT NOT NULL,
  replacement_brief TEXT,
  contradicted_json TEXT NOT NULL,
  targets_json TEXT NOT NULL,
  subject TEXT NOT NULL,
  message_text TEXT NOT NULL,
  PRIMARY KEY (message_id, reading_id)
) STRICT;

CREATE TABLE hold_reading_hits (
  message_id TEXT NOT NULL,
  task TEXT NOT NULL,
  reading_id TEXT NOT NULL,
  PRIMARY KEY (message_id, task, reading_id)
) STRICT;

CREATE TABLE clarification_cards (
  message_id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  subject TEXT NOT NULL,
  options_json TEXT NOT NULL,
  affected_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved'))
) STRICT;

CREATE TABLE quarantined_candidates (
  task TEXT PRIMARY KEY,
  commit_sha TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  attempt TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submission_pending', 'discarded', 'landed', 'reverify_failed'))
) STRICT;

CREATE TABLE ambiguity_reminders (
  message_id TEXT PRIMARY KEY,
  surfaced_at INTEGER NOT NULL,
  text TEXT NOT NULL,
  auto_guessed INTEGER NOT NULL CHECK (auto_guessed = 0)
) STRICT;
`;

export function openHoldDatabase(filename = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec(HOLD_SCHEMA_SQL);
  return db;
}

export function withImmediateTransaction(db: DatabaseSync, body: () => void, trace?: string[]): void {
  trace?.push("BEGIN IMMEDIATE");
  db.exec("BEGIN IMMEDIATE");
  try {
    body();
    trace?.push("COMMIT");
    db.exec("COMMIT");
  } catch (error) {
    trace?.push("ROLLBACK");
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      const message = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      if (!/no transaction/i.test(message)) throw rollbackError;
    }
    throw error;
  }
}

export interface StoredReading {
  readonly id: string;
  readonly featureId: string;
  readonly label: string;
  readonly targetNodeIds: readonly string[];
  readonly changeKind: ReadingChangeKind;
  readonly deltaText: string;
  readonly replacementBrief: string | null;
  readonly contradictedTokens: readonly string[];
  readonly subject: string;
  readonly messageText: string;
}

export interface StageHoldInput {
  readonly taskId: string;
  readonly featureId: string;
  readonly reasonType: string;
  readonly reasonRefId: string;
  readonly mode: HoldMode;
  readonly quarantine: boolean;
  readonly explanation: string;
  readonly messageId: string;
  readonly createdAt: number;
}

interface HoldJoinRow {
  readonly task: string;
  readonly feature: string;
  readonly reason: string;
  readonly source: string;
  readonly reason_type: string;
  readonly reason_ref_id: string;
  readonly mode: string;
  readonly quarantine: number;
  readonly explanation: string;
  readonly message_id: string;
  readonly created_at: number;
}

export class HoldStore {
  constructor(readonly db: DatabaseSync) {}

  seedCheckpoint(task: TaskSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO task_runtime(task, feature, state, level, epoch, holder_attempt, lease_expires_at, submission_pending, updated_rev)
         VALUES (?, ?, ?, 'm3', 0, NULL, NULL, 0, 1)
         ON CONFLICT(task) DO UPDATE SET feature = excluded.feature, state = excluded.state`,
      )
      .run(task.taskId, task.featureId, task.state);
    this.db
      .prepare(
        `INSERT INTO task_checkpoints(
           task, feature, label, progress, state, slice_sha256, brief_text, requirements_json,
           base_commit, session_ref, step, wip_json, critical_path
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(task) DO UPDATE SET
           feature = excluded.feature,
           label = excluded.label,
           progress = excluded.progress,
           state = excluded.state,
           slice_sha256 = excluded.slice_sha256,
           brief_text = excluded.brief_text,
           requirements_json = excluded.requirements_json,
           base_commit = excluded.base_commit,
           session_ref = excluded.session_ref,
           step = excluded.step,
           wip_json = excluded.wip_json,
           critical_path = excluded.critical_path`,
      )
      .run(
        task.taskId,
        task.featureId,
        task.label,
        task.progress,
        task.state,
        task.sliceSha256,
        task.briefText,
        JSON.stringify(task.requirements),
        task.baseCommit,
        task.sessionRef,
        task.step,
        JSON.stringify(task.wipFiles),
        task.criticalPath ? 1 : 0,
      );
    this.db
      .prepare(
        `INSERT INTO feature_heads(feature, commit_sha) VALUES (?, ?)
         ON CONFLICT(feature) DO NOTHING`,
      )
      .run(task.featureId, task.baseCommit);
  }

  stageHold(input: StageHoldInput): void {
    const runtime = this.db.prepare(`SELECT task FROM task_runtime WHERE task = ?`).get(input.taskId);
    if (!runtime) throw new HoldEngineError(`task ${input.taskId} is not in task_runtime`);
    const kernelReason = kernelReasonFor(input.reasonType);
    const source = holdKey(input.reasonType, input.reasonRefId);
    this.db
      .prepare(
        `INSERT INTO task_holds(task, reason, source, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(input.taskId, kernelReason, source, input.createdAt);
    this.db
      .prepare(
        `INSERT INTO hold_reason_details(
           task, reason, source, reason_type, reason_ref_id, mode, quarantine, explanation, message_id, feature, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.taskId,
        kernelReason,
        source,
        input.reasonType,
        input.reasonRefId,
        input.mode,
        input.quarantine ? 1 : 0,
        input.explanation,
        input.messageId,
        input.featureId,
        input.createdAt,
      );
    this.bumpRev(input.taskId);
  }

  deleteHold(taskId: string, reasonType: string, reasonRefId: string): boolean {
    const kernelReason = kernelReasonFor(reasonType);
    const source = holdKey(reasonType, reasonRefId);
    const removed = this.db
      .prepare(`DELETE FROM task_holds WHERE task = ? AND reason = ? AND source = ?`)
      .run(taskId, kernelReason, source);
    this.db
      .prepare(`DELETE FROM hold_reason_details WHERE task = ? AND reason = ? AND source = ?`)
      .run(taskId, kernelReason, source);
    const changes = typeof removed.changes === "bigint" ? Number(removed.changes) : removed.changes;
    if (changes > 0) this.bumpRev(taskId);
    return changes > 0;
  }

  countHolds(taskId: string): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM task_holds WHERE task = ?`).get(taskId) as
      | { n: number }
      | undefined;
    return Number(row?.n ?? 0);
  }

  countAllHolds(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM task_holds`).get() as { n: number } | undefined;
    return Number(row?.n ?? 0);
  }

  listHolds(taskId?: string): ActiveHold[] {
    const rows = (
      taskId === undefined
        ? this.db
            .prepare(
              `SELECT d.task, d.feature, d.reason, d.source, d.reason_type, d.reason_ref_id, d.mode,
                      d.quarantine, d.explanation, d.message_id, d.created_at
                 FROM hold_reason_details d
                 JOIN task_holds h ON h.task = d.task AND h.reason = d.reason AND h.source = d.source
                ORDER BY d.task, d.source`,
            )
            .all()
        : this.db
            .prepare(
              `SELECT d.task, d.feature, d.reason, d.source, d.reason_type, d.reason_ref_id, d.mode,
                      d.quarantine, d.explanation, d.message_id, d.created_at
                 FROM hold_reason_details d
                 JOIN task_holds h ON h.task = d.task AND h.reason = d.reason AND h.source = d.source
                WHERE d.task = ?
                ORDER BY d.source`,
            )
            .all(taskId)
    ) as unknown as HoldJoinRow[];
    return rows.map((row) => this.toActiveHold(row));
  }

  saveReading(input: {
    readonly messageId: string;
    readonly messageText: string;
    readonly subject: string;
    readonly readingId: string;
    readonly featureId: string;
    readonly label: string;
    readonly changeKind: ReadingChangeKind;
    readonly deltaText: string;
    readonly replacementBrief: string | null;
    readonly contradictedTokens: readonly string[];
    readonly targetNodeIds: readonly string[];
  }): void {
    this.db
      .prepare(
        `INSERT INTO ambiguous_readings(
           message_id, reading_id, feature_id, label, change_kind, delta_text, replacement_brief,
           contradicted_json, targets_json, subject, message_text
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.messageId,
        input.readingId,
        input.featureId,
        input.label,
        input.changeKind,
        input.deltaText,
        input.replacementBrief,
        JSON.stringify(input.contradictedTokens),
        JSON.stringify(input.targetNodeIds),
        input.subject,
        input.messageText,
      );
  }

  saveHit(messageId: string, taskId: string, readingId: string): void {
    this.db
      .prepare(`INSERT INTO hold_reading_hits(message_id, task, reading_id) VALUES (?, ?, ?)`)
      .run(messageId, taskId, readingId);
  }

  saveCard(card: ClarificationCard, createdAt: number): void {
    this.db
      .prepare(
        `INSERT INTO clarification_cards(message_id, question, subject, options_json, affected_json, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      )
      .run(
        card.messageId,
        card.question,
        card.subject,
        JSON.stringify(card.options),
        JSON.stringify(card.affectedTaskIds),
        createdAt,
      );
  }

  markCardResolved(messageId: string): void {
    const result = this.db
      .prepare(`UPDATE clarification_cards SET status = 'resolved' WHERE message_id = ? AND status = 'open'`)
      .run(messageId);
    const changes = typeof result.changes === "bigint" ? Number(result.changes) : result.changes;
    if (changes !== 1) throw new HoldEngineError(`clarification ${messageId} is not open`);
  }

  cardStatus(messageId: string): string | null {
    const row = this.db.prepare(`SELECT status FROM clarification_cards WHERE message_id = ?`).get(messageId) as
      | { status: string }
      | undefined;
    return row?.status ?? null;
  }

  cardCreatedAt(messageId: string): number | null {
    const row = this.db.prepare(`SELECT created_at FROM clarification_cards WHERE message_id = ?`).get(messageId) as
      | { created_at: number }
      | undefined;
    return row ? Number(row.created_at) : null;
  }

  loadReadings(messageId: string): StoredReading[] {
    const rows = this.db
      .prepare(
        `SELECT reading_id, feature_id, label, change_kind, delta_text, replacement_brief, contradicted_json,
                targets_json, subject, message_text
           FROM ambiguous_readings WHERE message_id = ? ORDER BY reading_id`,
      )
      .all(messageId) as unknown as {
      readonly reading_id: string;
      readonly feature_id: string;
      readonly label: string;
      readonly change_kind: string;
      readonly delta_text: string;
      readonly replacement_brief: string | null;
      readonly contradicted_json: string;
      readonly targets_json: string;
      readonly subject: string;
      readonly message_text: string;
    }[];
    return rows.map((row) => ({
      id: row.reading_id,
      featureId: row.feature_id,
      label: row.label,
      changeKind: row.change_kind as ReadingChangeKind,
      deltaText: row.delta_text,
      replacementBrief: row.replacement_brief,
      contradictedTokens: readStringArray(row.contradicted_json),
      targetNodeIds: readStringArray(row.targets_json),
      subject: row.subject,
      messageText: row.message_text,
    }));
  }

  hitReadingIds(messageId: string, taskId: string): string[] {
    const rows = this.db
      .prepare(`SELECT reading_id FROM hold_reading_hits WHERE message_id = ? AND task = ? ORDER BY reading_id`)
      .all(messageId, taskId) as unknown as { reading_id: string }[];
    return rows.map((row) => row.reading_id);
  }

  affectedTaskIds(messageId: string): string[] {
    const rows = this.db
      .prepare(`SELECT DISTINCT task FROM hold_reading_hits WHERE message_id = ? ORDER BY task`)
      .all(messageId) as unknown as { task: string }[];
    return rows.map((row) => row.task);
  }

  loadCheckpoint(taskId: string): CheckpointView {
    const row = this.db.prepare(`SELECT * FROM task_checkpoints WHERE task = ?`).get(taskId) as
      | {
          task: string;
          feature: string;
          label: string;
          progress: number;
          state: string;
          slice_sha256: string;
          brief_text: string;
          requirements_json: string;
          base_commit: string;
          session_ref: string;
          step: number;
          wip_json: string;
          critical_path: number;
        }
      | undefined;
    if (!row) throw new HoldEngineError(`missing checkpoint for ${taskId}`);
    return {
      taskId: row.task,
      featureId: row.feature,
      label: row.label,
      progress: Number(row.progress),
      state: row.state,
      sliceSha256: row.slice_sha256,
      briefText: row.brief_text,
      requirements: readStringArray(row.requirements_json),
      baseCommit: row.base_commit,
      sessionRef: row.session_ref,
      step: Number(row.step),
      wipFiles: readWip(row.wip_json),
      criticalPath: Number(row.critical_path) === 1,
    };
  }

  updateSession(taskId: string, sessionRef: string): void {
    this.db.prepare(`UPDATE task_checkpoints SET session_ref = ? WHERE task = ?`).run(sessionRef, taskId);
  }

  featureHead(featureId: string): string {
    const row = this.db.prepare(`SELECT commit_sha FROM feature_heads WHERE feature = ?`).get(featureId) as
      | { commit_sha: string }
      | undefined;
    if (!row) throw new HoldEngineError(`missing feature head for ${featureId}`);
    return row.commit_sha;
  }

  advanceFeatureHead(featureId: string, commitSha: string): void {
    const existing = this.db.prepare(`SELECT feature FROM feature_heads WHERE feature = ?`).get(featureId);
    if (!existing) {
      this.db.prepare(`INSERT INTO feature_heads(feature, commit_sha) VALUES (?, ?)`).run(featureId, commitSha);
      return;
    }
    this.db.prepare(`UPDATE feature_heads SET commit_sha = ? WHERE feature = ?`).run(commitSha, featureId);
  }

  saveCandidate(input: QuarantinedCandidate): void {
    this.db
      .prepare(
        `INSERT INTO quarantined_candidates(task, commit_sha, base_commit, attempt, received_at, status)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(task) DO UPDATE SET
           commit_sha = excluded.commit_sha,
           base_commit = excluded.base_commit,
           attempt = excluded.attempt,
           received_at = excluded.received_at,
           status = excluded.status`,
      )
      .run(input.taskId, input.commitSha, input.baseCommit, input.attempt, input.receivedAt, input.status);
  }

  loadCandidate(taskId: string): QuarantinedCandidate | null {
    const row = this.db.prepare(`SELECT * FROM quarantined_candidates WHERE task = ?`).get(taskId) as
      | {
          task: string;
          commit_sha: string;
          base_commit: string;
          attempt: string;
          received_at: number;
          status: QuarantinedCandidate["status"];
        }
      | undefined;
    if (!row) return null;
    return {
      taskId: row.task,
      commitSha: row.commit_sha,
      baseCommit: row.base_commit,
      attempt: row.attempt,
      receivedAt: Number(row.received_at),
      status: row.status,
    };
  }

  setCandidateStatus(taskId: string, status: QuarantinedCandidate["status"], commitSha?: string): void {
    if (commitSha === undefined) {
      this.db.prepare(`UPDATE quarantined_candidates SET status = ? WHERE task = ?`).run(status, taskId);
      return;
    }
    this.db
      .prepare(`UPDATE quarantined_candidates SET status = ?, commit_sha = ? WHERE task = ?`)
      .run(status, commitSha, taskId);
  }

  setSubmissionPending(taskId: string, pending: boolean): void {
    this.db
      .prepare(`UPDATE task_runtime SET submission_pending = ? WHERE task = ?`)
      .run(pending ? 1 : 0, taskId);
    this.bumpRev(taskId);
  }

  submissionPending(taskId: string): boolean {
    const row = this.db.prepare(`SELECT submission_pending FROM task_runtime WHERE task = ?`).get(taskId) as
      | { submission_pending: number }
      | undefined;
    return Number(row?.submission_pending ?? 0) === 1;
  }

  openAmbiguousMessageIds(): string[] {
    const rows = this.db
      .prepare(`SELECT message_id FROM clarification_cards WHERE status = 'open' ORDER BY message_id`)
      .all() as unknown as { message_id: string }[];
    return rows.map((row) => row.message_id);
  }

  criticalHeldTasks(messageId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT h.task AS task
           FROM hold_reading_hits h
           JOIN task_checkpoints c ON c.task = h.task
           JOIN task_holds t ON t.task = h.task
          WHERE h.message_id = ? AND c.critical_path = 1
          ORDER BY h.task`,
      )
      .all(messageId) as unknown as { task: string }[];
    return rows.map((row) => row.task);
  }

  reminderExists(messageId: string): boolean {
    const row = this.db.prepare(`SELECT message_id FROM ambiguity_reminders WHERE message_id = ?`).get(messageId);
    return row !== undefined;
  }

  saveReminder(messageId: string, surfacedAt: number, text: string): void {
    this.db
      .prepare(
        `INSERT INTO ambiguity_reminders(message_id, surfaced_at, text, auto_guessed) VALUES (?, ?, ?, 0)`,
      )
      .run(messageId, surfacedAt, text);
  }

  loadCard(messageId: string): ClarificationCard | null {
    const row = this.db
      .prepare(
        `SELECT message_id, question, subject, options_json, affected_json, status FROM clarification_cards WHERE message_id = ?`,
      )
      .get(messageId) as
      | {
          message_id: string;
          question: string;
          subject: string;
          options_json: string;
          affected_json: string;
          status: string;
        }
      | undefined;
    if (!row || row.status !== "open") return null;
    const options = JSON.parse(row.options_json) as ClarificationOption[];
    return {
      messageId: row.message_id,
      question: row.question,
      subject: row.subject,
      options,
      affectedTaskIds: readStringArray(row.affected_json),
      cardCount: 1,
    };
  }

  private bumpRev(taskId: string): void {
    this.db.prepare(`UPDATE task_runtime SET updated_rev = updated_rev + 1 WHERE task = ?`).run(taskId);
  }

  private toActiveHold(row: HoldJoinRow): ActiveHold {
    const mode = row.mode === "SOFT_HOLD" ? "SOFT_HOLD" : "HARD_HOLD";
    return {
      taskId: row.task,
      featureId: row.feature,
      holdKey: row.source,
      reasonType: row.reason_type,
      reasonRefId: row.reason_ref_id,
      kernelReason: row.reason as KernelHoldReason,
      source: row.source,
      mode,
      quarantine: Number(row.quarantine) === 1,
      explanation: row.explanation,
      messageId: row.message_id,
      createdAt: Number(row.created_at),
    };
  }
}

function readStringArray(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new HoldEngineError("expected a string array");
  }
  return parsed;
}

function readWip(text: string): WipFile[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new HoldEngineError("expected wip files");
  return parsed.map((item) => {
    if (typeof item !== "object" || item === null) throw new HoldEngineError("expected a wip file");
    const record = item as { path?: unknown; content?: unknown };
    if (typeof record.path !== "string" || typeof record.content !== "string") {
      throw new HoldEngineError("expected a wip file");
    }
    return { path: record.path, content: record.content };
  });
}
