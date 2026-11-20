import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalStateSqlPath,
  createTaskHoldAndSubmissionRepo,
  loadCanonicalQueries,
  type StateConnection,
  type TaskHoldAndSubmissionRepo,
  type TaskState,
} from "../../src/holds/index.js";

export interface RuntimeSnapshot {
  readonly state: string;
  readonly epoch: number;
  readonly holderAttempt: string | null;
  readonly leaseExpiresAt: number | null;
  readonly submissionPending: number;
  readonly updatedRev: number;
}

export interface HarnessHandle {
  readonly db: DatabaseSync;
  readonly repo: TaskHoldAndSubmissionRepo;
  readonly queries: Map<string, string>;
  close(): void;
}

function searchText(value: string | null): string {
  if (!value) return "";
  const extra = String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-./:]+/g, " ");
  return `${value} ${extra}`;
}

export function openHarness(): HarnessHandle {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.function("ef_search_text", { deterministic: true }, searchText);
  db.exec(readFileSync(canonicalStateSqlPath(), "utf8"));
  db.exec("BEGIN IMMEDIATE");
  db.prepare(
    "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES ('CS-1', 1, 'kernel', 'test', 0)",
  ).run();
  db.prepare(
    `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
     VALUES ('F12', 'feature', 1, 'h-F12', 'Feature', '', '{"feature":"F12"}', 'CS-1', 1, 1)`,
  ).run();
  db.exec("COMMIT");
  const repo = createTaskHoldAndSubmissionRepo(db as unknown as StateConnection);
  return {
    db,
    repo,
    queries: loadCanonicalQueries(),
    close() {
      db.close();
    },
  };
}

export function seedTask(db: DatabaseSync, task = "T07"): void {
  db.prepare(
    `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
     VALUES (?, 'task', 1, ?, ?, '', ?, 'CS-1', 1, 1)`,
  ).run(task, `h-${task}`, `Task ${task}`, JSON.stringify({ feature: "F12" }));
  db.prepare(
    `INSERT INTO task_runtime(task, feature, state, level, epoch, updated_rev)
     VALUES (?, 'F12', 'READY', 'Mid', 1, 1)`,
  ).run(task);
}

export function readRuntime(db: DatabaseSync, task: string): RuntimeSnapshot {
  const row = db
    .prepare(
      `SELECT state, epoch, holder_attempt, lease_expires_at, submission_pending, updated_rev
         FROM task_runtime WHERE task = ?`,
    )
    .get(task) as Record<string, number | string | null> | undefined;
  if (!row) throw new Error(`missing task ${task}`);
  return {
    state: String(row.state),
    epoch: Number(row.epoch),
    holderAttempt: row.holder_attempt === null ? null : String(row.holder_attempt),
    leaseExpiresAt: row.lease_expires_at === null ? null : Number(row.lease_expires_at),
    submissionPending: Number(row.submission_pending),
    updatedRev: Number(row.updated_rev),
  };
}

export function countRows(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
  return Number(row.n);
}

export function setRuntime(
  db: DatabaseSync,
  task: string,
  input: {
    readonly state: TaskState;
    readonly epoch?: number;
    readonly attempt?: string | null;
    readonly attemptState?: string;
    readonly leaseExpiresAt?: number | null;
    readonly submissionPending?: 0 | 1;
    readonly rev?: number;
  },
): string | null {
  const epoch = input.epoch ?? 1;
  const attempt = input.attempt === undefined ? `A-${task}-1` : input.attempt;
  db.exec("BEGIN IMMEDIATE");
  db.prepare("UPDATE task_runtime SET holder_attempt = NULL WHERE task = ?").run(task);
  db.prepare("DELETE FROM attempt_checkpoints").run();
  db.prepare("DELETE FROM edge_read_sets").run();
  db.prepare("DELETE FROM search_reads").run();
  db.prepare("DELETE FROM candidates").run();
  db.prepare("DELETE FROM check_results").run();
  db.prepare("DELETE FROM read_sets").run();
  db.prepare("DELETE FROM turn_log").run();
  db.prepare("DELETE FROM attempts WHERE task = ?").run(task);
  if (attempt) {
    db.prepare(
      `INSERT INTO attempts(
         id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at
       ) VALUES (?, ?, 1, ?, 1, 'own', 'm', 'c', 'abc', ?, 1)`,
    ).run(attempt, task, epoch, input.attemptState ?? "running");
  }
  db.prepare(
    `UPDATE task_runtime
        SET state = ?, epoch = ?, holder_attempt = ?, lease_expires_at = ?, submission_pending = ?, updated_rev = ?
      WHERE task = ?`,
  ).run(
    input.state,
    epoch,
    attempt,
    input.leaseExpiresAt === undefined ? 50 : input.leaseExpiresAt,
    input.submissionPending ?? 0,
    input.rev ?? 1,
    task,
  );
  db.exec("COMMIT");
  return attempt;
}

export function queryText(queries: Map<string, string>, name: string): string {
  const sql = queries.get(name);
  if (!sql) throw new Error(`missing query ${name}`);
  return sql;
}
