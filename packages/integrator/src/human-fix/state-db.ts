import { DatabaseSync } from "node:sqlite";
import { TaskNotFoundError } from "./errors.js";
import type { TaskRecord, TaskState } from "./types.js";
import { HUMAN_OWNED, VERIFICATION_HUMAN_OVERRIDE } from "./constants.js";

export type SqlValue = null | number | string | bigint | Uint8Array;

const DDL = `
CREATE TABLE IF NOT EXISTS hf_tasks (
  task_id             TEXT PRIMARY KEY,
  feature_id          TEXT NOT NULL,
  state               TEXT NOT NULL,
  write_scope_json    TEXT NOT NULL DEFAULT '[]',
  downstream_json     TEXT NOT NULL DEFAULT '[]',
  worker_pid          INTEGER,
  checkpoint_ref      TEXT NOT NULL DEFAULT '',
  human_paths_json    TEXT NOT NULL DEFAULT '[]',
  verification_status TEXT NOT NULL DEFAULT '',
  overridden_json     TEXT NOT NULL DEFAULT '[]'
) STRICT;

CREATE TABLE IF NOT EXISTS hf_contracts (
  contract_id   TEXT NOT NULL,
  field         TEXT NOT NULL,
  basis         TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  PRIMARY KEY (contract_id, field)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS hf_active_workers (
  task_id   TEXT PRIMARY KEY,
  pid       INTEGER NOT NULL,
  paths_json TEXT NOT NULL DEFAULT '[]'
) STRICT;
`;

class HfDb {
  constructor(private readonly sqlite: DatabaseSync) {}

  run(sql: string, params: readonly SqlValue[]): number {
    const stmt = this.sqlite.prepare(sql);
    const result = stmt.run(...params);
    return Number(result.changes ?? 0);
  }

  get(sql: string, params: readonly SqlValue[]): Readonly<Record<string, SqlValue>> | undefined {
    const stmt = this.sqlite.prepare(sql);
    return stmt.get(...params) as Readonly<Record<string, SqlValue>> | undefined;
  }

  all(sql: string, params: readonly SqlValue[]): readonly Readonly<Record<string, SqlValue>>[] {
    const stmt = this.sqlite.prepare(sql);
    return stmt.all(...params) as readonly Readonly<Record<string, SqlValue>>[];
  }

  transaction<T>(fn: () => T): T {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.sqlite.exec("COMMIT");
      return value;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String);
  } catch {
    return [];
  }
}

function rowToTask(row: Readonly<Record<string, SqlValue>>): TaskRecord {
  const pid = row.worker_pid;
  return {
    taskId: String(row.task_id),
    featureId: String(row.feature_id),
    state: String(row.state) as TaskState,
    writeScope: parseJsonArray(row.write_scope_json),
    downstreamTaskIds: parseJsonArray(row.downstream_json),
    activeWorkerPid: typeof pid === "number" ? pid : pid == null ? null : Number(pid),
    checkpointRef: String(row.checkpoint_ref ?? ""),
    humanAuthoredPaths: parseJsonArray(row.human_paths_json),
    verificationStatus: String(row.verification_status ?? ""),
    overriddenCheckIds: parseJsonArray(row.overridden_json),
  };
}

export interface TaskSeed {
  readonly taskId: string;
  readonly featureId: string;
  readonly state: TaskState;
  readonly writeScope: readonly string[];
  readonly downstreamTaskIds?: readonly string[];
  readonly workerPid?: number | null;
  readonly checkpointRef?: string;
}

/**
 * Runtime store for human-fix flow until Task 013 / Task 021 barrels are wired on integration.
 */
export class HumanFixStateDb {
  private constructor(
    private readonly db: HfDb,
    private readonly sqlite: DatabaseSync,
  ) {}

  static open(filePath: string): HumanFixStateDb {
    const sqlite = new DatabaseSync(filePath);
    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);
    sqlite.exec(DDL);
    return new HumanFixStateDb(new HfDb(sqlite), sqlite);
  }

  seedTask(input: TaskSeed): TaskRecord {
    this.db.run(
      `INSERT INTO hf_tasks (task_id, feature_id, state, write_scope_json, downstream_json, worker_pid, checkpoint_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET
         feature_id = excluded.feature_id,
         state = excluded.state,
         write_scope_json = excluded.write_scope_json,
         downstream_json = excluded.downstream_json,
         worker_pid = excluded.worker_pid,
         checkpoint_ref = excluded.checkpoint_ref`,
      [
        input.taskId,
        input.featureId,
        input.state,
        JSON.stringify(input.writeScope),
        JSON.stringify(input.downstreamTaskIds ?? []),
        input.workerPid ?? null,
        input.checkpointRef ?? "",
      ],
    );
    return this.requireTask(input.taskId);
  }

  registerActiveWorker(taskId: string, pid: number, paths: readonly string[]): void {
    this.db.run(
      `INSERT INTO hf_active_workers (task_id, pid, paths_json) VALUES (?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET pid = excluded.pid, paths_json = excluded.paths_json`,
      [taskId, pid, JSON.stringify(paths)],
    );
  }

  listActiveWorkers(): { readonly taskId: string; readonly pid: number; readonly paths: readonly string[] }[] {
    return this.db.all("SELECT * FROM hf_active_workers", []).map((row) => ({
      taskId: String(row.task_id),
      pid: Number(row.pid),
      paths: parseJsonArray(row.paths_json),
    }));
  }

  requireTask(taskId: string): TaskRecord {
    const task = this.getTask(taskId);
    if (!task) throw new TaskNotFoundError(taskId);
    return task;
  }

  getTask(taskId: string): TaskRecord | null {
    const row = this.db.get("SELECT * FROM hf_tasks WHERE task_id = ?", [taskId]);
    return row ? rowToTask(row) : null;
  }

  setTaskState(taskId: string, state: TaskState): TaskRecord {
    const changed = this.db.run("UPDATE hf_tasks SET state = ? WHERE task_id = ?", [state, taskId]);
    if (changed === 0) throw new TaskNotFoundError(taskId);
    return this.requireTask(taskId);
  }

  enterHumanOwned(taskId: string, haltedPid: number | null): TaskRecord {
    return this.db.transaction(() => {
      const task = this.requireTask(taskId);
      if (task.state !== HUMAN_OWNED) {
        this.db.run("UPDATE hf_tasks SET state = ?, worker_pid = NULL WHERE task_id = ?", [HUMAN_OWNED, taskId]);
      }
      if (haltedPid != null) {
        this.db.run("DELETE FROM hf_active_workers WHERE task_id = ?", [taskId]);
      }
      for (const downstream of task.downstreamTaskIds) {
        this.db.run("UPDATE hf_tasks SET state = 'PARKED' WHERE task_id = ? AND state NOT IN ('CANCELLED','MERGED_TO_FEATURE')", [
          downstream,
        ]);
      }
      const parkedSibling = this.db.all(
        "SELECT task_id FROM hf_tasks WHERE task_id != ? AND state NOT IN ('CANCELLED','MERGED_TO_FEATURE','HUMAN_OWNED','PARKED')",
        [taskId],
      );
      if (parkedSibling.length > 0 && haltedPid == null) {
        // sibling workers untouched (zero-unrelated-pause)
      }
      return this.requireTask(taskId);
    });
  }

  unparkDownstream(taskId: string): readonly string[] {
    const task = this.requireTask(taskId);
    const unblocked: string[] = [];
    for (const downstream of task.downstreamTaskIds) {
      const row = this.db.get("SELECT state FROM hf_tasks WHERE task_id = ?", [downstream]);
      if (row && String(row.state) === "PARKED") {
        this.db.run("UPDATE hf_tasks SET state = 'READY' WHERE task_id = ?", [downstream]);
        unblocked.push(downstream);
      }
    }
    return unblocked;
  }

  tagHumanPaths(taskId: string, paths: readonly string[]): TaskRecord {
    const task = this.requireTask(taskId);
    const merged = [...new Set([...task.humanAuthoredPaths, ...paths])];
    this.db.run("UPDATE hf_tasks SET human_paths_json = ? WHERE task_id = ?", [JSON.stringify(merged), taskId]);
    return this.requireTask(taskId);
  }

  recordOverride(taskId: string, checkIds: readonly string[], reason: string): TaskRecord {
    const task = this.requireTask(taskId);
    const merged = [...new Set([...task.overriddenCheckIds, ...checkIds])];
    this.db.run("UPDATE hf_tasks SET verification_status = ?, overridden_json = ? WHERE task_id = ?", [
      VERIFICATION_HUMAN_OVERRIDE,
      JSON.stringify(merged),
      taskId,
    ]);
    void reason;
    return this.requireTask(taskId);
  }

  setVerificationStatus(taskId: string, status: string): TaskRecord {
    this.db.run("UPDATE hf_tasks SET verification_status = ? WHERE task_id = ?", [status, taskId]);
    return this.requireTask(taskId);
  }

  upsertContract(contractId: string, field: string, taskId: string, basis: "explicit"): void {
    this.db.run(
      `INSERT INTO hf_contracts (contract_id, field, basis, task_id) VALUES (?, ?, ?, ?)
       ON CONFLICT(contract_id, field) DO UPDATE SET basis = excluded.basis, task_id = excluded.task_id`,
      [contractId, field, basis, taskId],
    );
  }

  listContracts(taskId: string): readonly { readonly contractId: string; readonly field: string; readonly basis: string }[] {
    return this.db.all("SELECT * FROM hf_contracts WHERE task_id = ?", [taskId]).map((row) => ({
      contractId: String(row.contract_id),
      field: String(row.field),
      basis: String(row.basis),
    }));
  }

  close(): void {
    this.sqlite.close();
  }
}