import { createHash } from "node:crypto";
import path from "node:path";
import { openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";
import { TaskNotFoundError } from "./errors.js";
import type { TaskRecord, TaskState } from "./types.js";
import { HUMAN_OWNED, VERIFICATION_HUMAN_OVERRIDE } from "./constants.js";

const TASK_STATE_VALUES = [
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
] as const satisfies readonly TaskState[];

type SqlParam = string | number | bigint | null;

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
 * Human-fix flow on `ProjectStateDb`: `nodes`, `task_runtime`, and `attempts`
 * are the canonical rows. Extra card fields live in additive v2 tables.
 */
export class HumanFixStateDb {
  private constructor(private readonly stateDb: ProjectStateDb) {}

  static open(filePath: string): HumanFixStateDb {
    const resolved = path.resolve(filePath);
    const projectId = `hf${createHash("sha256").update(resolved).digest("hex").slice(0, 20)}`;
    const stateDb = openProjectStateDb({ projectId, rootDir: path.dirname(resolved) });
    if (stateDb.mode !== "readwrite") {
      stateDb.close();
      throw new Error(`human-fix state database for ${projectId} is not writable`);
    }
    return new HumanFixStateDb(stateDb);
  }

  seedTask(input: TaskSeed): TaskRecord {
    const now = Date.now();
    this.stateDb.writer.transaction(() => {
      this.ensureChangeSet(now);
      this.ensureFeatureNode(input.featureId);
      this.ensureTaskNode(input.taskId, input.featureId);
      this.run(
        `INSERT INTO task_runtime(task, feature, state, level, epoch, updated_rev)
         VALUES (?, ?, ?, 'Mid', 0, 1)
         ON CONFLICT(task) DO UPDATE SET
           feature = excluded.feature,
           state = excluded.state`,
        [input.taskId, input.featureId, input.state],
      );
      this.run(
        `INSERT INTO human_fix_tasks(
           task_id, write_scope_json, downstream_json, checkpoint_ref,
           human_paths_json, verification_status, overridden_json, worker_pid
         ) VALUES (?, ?, ?, ?, '[]', '', '[]', ?)
         ON CONFLICT(task_id) DO UPDATE SET
           write_scope_json = excluded.write_scope_json,
           downstream_json = excluded.downstream_json,
           checkpoint_ref = excluded.checkpoint_ref,
           worker_pid = excluded.worker_pid`,
        [
          input.taskId,
          JSON.stringify(input.writeScope),
          JSON.stringify(input.downstreamTaskIds ?? []),
          input.checkpointRef ?? "",
          input.workerPid ?? null,
        ],
      );
      if (typeof input.workerPid === "number") {
        this.ensureRunningAttempt(input.taskId, now);
      }
    });
    return this.requireTask(input.taskId);
  }

  registerActiveWorker(taskId: string, pid: number, paths: readonly string[]): void {
    this.run(
      `INSERT INTO human_fix_workers (task_id, pid, paths_json) VALUES (?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET pid = excluded.pid, paths_json = excluded.paths_json`,
      [taskId, pid, JSON.stringify(paths)],
    );
  }

  listActiveWorkers(): { readonly taskId: string; readonly pid: number; readonly paths: readonly string[] }[] {
    return this.all("SELECT task_id, pid, paths_json FROM human_fix_workers", []).map((row) => ({
      taskId: text(row, "task_id"),
      pid: integer(row, "pid"),
      paths: parseJsonArray(row.paths_json),
    }));
  }

  requireTask(taskId: string): TaskRecord {
    const task = this.getTask(taskId);
    if (!task) throw new TaskNotFoundError(taskId);
    return task;
  }

  getTask(taskId: string): TaskRecord | null {
    const runtime = this.get(
      `SELECT task, feature, state FROM task_runtime WHERE task = ?`,
      [taskId],
    );
    if (!runtime) return null;
    const meta = this.get(
      `SELECT write_scope_json, downstream_json, checkpoint_ref, human_paths_json,
              verification_status, overridden_json, worker_pid
         FROM human_fix_tasks WHERE task_id = ?`,
      [taskId],
    );
    const pid = meta ? meta.worker_pid : null;
    return {
      taskId: text(runtime, "task"),
      featureId: text(runtime, "feature"),
      state: asTaskState(runtime.state),
      writeScope: parseJsonArray(meta?.write_scope_json),
      downstreamTaskIds: parseJsonArray(meta?.downstream_json),
      activeWorkerPid:
        typeof pid === "number" || typeof pid === "bigint" ? integer({ worker_pid: pid }, "worker_pid") : null,
      checkpointRef: meta ? text(meta, "checkpoint_ref") : "",
      humanAuthoredPaths: parseJsonArray(meta?.human_paths_json),
      verificationStatus: meta ? text(meta, "verification_status") : "",
      overriddenCheckIds: parseJsonArray(meta?.overridden_json),
    };
  }

  setTaskState(taskId: string, state: TaskState): TaskRecord {
    const changed = this.run("UPDATE task_runtime SET state = ? WHERE task = ?", [state, taskId]);
    if (changed === 0) throw new TaskNotFoundError(taskId);
    return this.requireTask(taskId);
  }

  enterHumanOwned(taskId: string, haltedPid: number | null): TaskRecord {
    const now = Date.now();
    this.stateDb.writer.transaction(() => {
      const task = this.requireTask(taskId);
      if (task.state !== HUMAN_OWNED) {
        this.ensureRunningAttempt(taskId, now);
        this.run(
          `UPDATE attempts
              SET state = 'parked', ended_at = ?, outcome = 'HUMAN_OWNED'
            WHERE task = ? AND state = 'running'`,
          [now, taskId],
        );
        this.run(
          `UPDATE task_runtime
              SET state = ?, holder_attempt = NULL
            WHERE task = ?`,
          [HUMAN_OWNED, taskId],
        );
        this.run(`UPDATE human_fix_tasks SET worker_pid = NULL WHERE task_id = ?`, [taskId]);
      }
      if (haltedPid !== null) {
        this.run("DELETE FROM human_fix_workers WHERE task_id = ?", [taskId]);
      }
      for (const downstream of task.downstreamTaskIds) {
        this.run(
          `UPDATE task_runtime
              SET state = 'PARKED'
            WHERE task = ? AND state NOT IN ('CANCELLED', 'MERGED_TO_FEATURE')`,
          [downstream],
        );
      }
    });
    return this.requireTask(taskId);
  }

  unparkDownstream(taskId: string): readonly string[] {
    const task = this.requireTask(taskId);
    const unblocked: string[] = [];
    for (const downstream of task.downstreamTaskIds) {
      const row = this.get("SELECT state FROM task_runtime WHERE task = ?", [downstream]);
      if (row && text(row, "state") === "PARKED") {
        this.run("UPDATE task_runtime SET state = 'READY' WHERE task = ?", [downstream]);
        unblocked.push(downstream);
      }
    }
    return unblocked;
  }

  tagHumanPaths(taskId: string, paths: readonly string[]): TaskRecord {
    const task = this.requireTask(taskId);
    const merged = [...new Set([...task.humanAuthoredPaths, ...paths])];
    this.run("UPDATE human_fix_tasks SET human_paths_json = ? WHERE task_id = ?", [
      JSON.stringify(merged),
      taskId,
    ]);
    return this.requireTask(taskId);
  }

  recordOverride(taskId: string, checkIds: readonly string[], reason: string): TaskRecord {
    const task = this.requireTask(taskId);
    const merged = [...new Set([...task.overriddenCheckIds, ...checkIds])];
    this.run(
      "UPDATE human_fix_tasks SET verification_status = ?, overridden_json = ? WHERE task_id = ?",
      [VERIFICATION_HUMAN_OVERRIDE, JSON.stringify(merged), taskId],
    );
    if (reason.length === 0) {
      throw new Error("override reason is required");
    }
    return this.requireTask(taskId);
  }

  setVerificationStatus(taskId: string, status: string): TaskRecord {
    this.run("UPDATE human_fix_tasks SET verification_status = ? WHERE task_id = ?", [status, taskId]);
    return this.requireTask(taskId);
  }

  upsertContract(contractId: string, field: string, taskId: string, basis: "explicit"): void {
    this.run(
      `INSERT INTO human_fix_contracts (contract_id, field, basis, task_id) VALUES (?, ?, ?, ?)
       ON CONFLICT(contract_id, field) DO UPDATE SET basis = excluded.basis, task_id = excluded.task_id`,
      [contractId, field, basis, taskId],
    );
  }

  listContracts(taskId: string): readonly { readonly contractId: string; readonly field: string; readonly basis: string }[] {
    return this.all("SELECT contract_id, field, basis FROM human_fix_contracts WHERE task_id = ?", [taskId]).map(
      (row) => ({
        contractId: text(row, "contract_id"),
        field: text(row, "field"),
        basis: text(row, "basis"),
      }),
    );
  }

  close(): void {
    this.stateDb.close();
  }

  private ensureChangeSet(now: number): void {
    this.run(
      `INSERT INTO change_sets(id, rev, origin, author, created_at)
       VALUES ('CS-HF', 1, 'kernel', 'human-fix', ?)
       ON CONFLICT(id) DO NOTHING`,
      [now],
    );
  }

  private ensureFeatureNode(featureId: string): void {
    this.run(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES (?, 'feature', 1, ?, ?, '', '{}', 'CS-HF', 1, 1)
       ON CONFLICT(id) DO NOTHING`,
      [featureId, `h-${featureId}`, featureId],
    );
  }

  private ensureTaskNode(taskId: string, featureId: string): void {
    this.run(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES (?, 'task', 1, ?, ?, '', ?, 'CS-HF', 1, 1)
       ON CONFLICT(id) DO NOTHING`,
      [taskId, `h-${taskId}`, taskId, JSON.stringify({ feature: featureId })],
    );
  }

  private ensureRunningAttempt(taskId: string, now: number): void {
    const existing = this.get(
      `SELECT id FROM attempts WHERE task = ? AND state = 'running' ORDER BY n DESC LIMIT 1`,
      [taskId],
    );
    if (existing) {
      this.run(`UPDATE task_runtime SET holder_attempt = ? WHERE task = ?`, [text(existing, "id"), taskId]);
      return;
    }
    const countRow = this.get(`SELECT COUNT(*) AS n FROM attempts WHERE task = ?`, [taskId]);
    const n = (countRow ? integer(countRow, "n") : 0) + 1;
    const attemptId = `${taskId}-attempt-${n}`;
    this.run(
      `INSERT INTO attempts(
         id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at
       ) VALUES (?, ?, ?, 0, 1, 'local', 'human-fix', 'local', ?, 'running', ?)`,
      [attemptId, taskId, n, "0".repeat(40), now],
    );
    this.run(`UPDATE task_runtime SET holder_attempt = ? WHERE task = ?`, [attemptId, taskId]);
  }

  private run(sql: string, params: readonly SqlParam[]): number {
    const result = this.stateDb.writer.prepare(sql).run([...params]);
    return typeof result.changes === "bigint" ? Number(result.changes) : result.changes;
  }

  private get(sql: string, params: readonly SqlParam[]): Record<string, unknown> | null {
    const row = this.stateDb.writer.prepare(sql).get([...params]);
    if (!row || typeof row !== "object") return null;
    return row as Record<string, unknown>;
  }

  private all(sql: string, params: readonly SqlParam[]): readonly Record<string, unknown>[] {
    const rows = this.stateDb.writer.prepare(sql).all([...params]);
    return rows.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
  }
}

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Expected text column ${key}`);
  return value;
}

function integer(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`Expected integer column ${key}`);
}

function asTaskState(value: unknown): TaskState {
  const state = String(value);
  if ((TASK_STATE_VALUES as readonly string[]).includes(state)) return state as TaskState;
  throw new Error(`unexpected task state ${state}`);
}
