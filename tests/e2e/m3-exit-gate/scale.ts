import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { percentile } from "./report.ts";
import type { BoardCertificate, DbCertificate } from "./types.ts";

export const DB_WORKERS = 50;
export const DB_ROUNDS = 8;
export const DB_SCENARIO_WINDOW_SEC = 60;
export const BOARD_TASKS = 500;
export const BOARD_REQUIREMENTS_PER_TASK = 10;
export const BOARD_WINDOW = 24;

const LANES = ["backlog", "ready", "running", "verifying", "merge", "done", "held"] as const;

export interface BoardTask {
  id: string;
  lane: string;
  requirements: string[];
}

export interface BoardDelta {
  id: string;
  lane: string;
}

interface PendingWrite {
  worker: number;
  n: number;
  resolve: (latencyMs: number) => void;
  reject: (error: unknown) => void;
}

function isBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String(error.code) : "";
  return code.includes("BUSY") || error.message.includes("SQLITE_BUSY") || error.message.includes("database is locked");
}

function rowField(row: unknown, key: string): string {
  if (!row || typeof row !== "object" || !(key in row)) return "";
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "number" || typeof value === "string" ? String(value) : "";
}

export function judgeDb(
  samples: readonly number[],
  busy: number,
  slow: { sql: string; durationMs: number },
): Pick<DbCertificate, "p99Ms" | "busy" | "slowSql" | "slowMs" | "pass" | "detail"> {
  const p99Ms = percentile(samples, 99);
  const detail: string[] = [];
  if (!(p99Ms < 50)) {
    detail.push(`dbWriteP99Ms ${p99Ms} >= 50; slow query: ${slow.sql} (${slow.durationMs} ms) from telemetry.db`);
  }
  if (busy !== 0) detail.push(`SQLITE_BUSY ${busy}`);
  return {
    p99Ms,
    busy,
    slowSql: slow.sql,
    slowMs: slow.durationMs,
    pass: detail.length === 0,
    detail,
  };
}

export function judgeBoard(initialMs: number, burstMs: readonly number[]): Pick<
  BoardCertificate,
  "initialMs" | "boardUpdateMs" | "boardPaintP95Ms" | "pass" | "detail"
> {
  const boardUpdateMs = burstMs.length === 0 ? initialMs : Math.max(initialMs, ...burstMs);
  const boardPaintP95Ms = percentile(burstMs.length === 0 ? [initialMs] : burstMs, 95);
  const detail: string[] = [];
  if (!(boardUpdateMs < 10)) detail.push(`boardUpdateMs ${boardUpdateMs} >= 10`);
  if (!(boardPaintP95Ms < 50)) detail.push(`boardPaintP95Ms ${boardPaintP95Ms} >= 50`);
  return { initialMs, boardUpdateMs, boardPaintP95Ms, pass: detail.length === 0, detail };
}

export class BoardCockpitView {
  private readonly byId = new Map<string, BoardTask>();
  private readonly order: string[] = [];

  constructor(tasks: readonly BoardTask[]) {
    for (const task of tasks) {
      this.byId.set(task.id, { id: task.id, lane: task.lane, requirements: task.requirements });
      this.order.push(task.id);
    }
  }

  get taskCount(): number {
    return this.order.length;
  }

  get requirementCount(): number {
    let total = 0;
    for (const task of this.byId.values()) total += task.requirements.length;
    return total;
  }

  mount(): number {
    const started = performance.now();
    this.visibleRows();
    return performance.now() - started;
  }

  applyBurst(deltas: readonly BoardDelta[]): number {
    const started = performance.now();
    for (const delta of deltas) {
      const task = this.byId.get(delta.id);
      if (task) task.lane = delta.lane;
    }
    this.visibleRows();
    return performance.now() - started;
  }

  private visibleRows(): string[] {
    const rows: string[] = [];
    const end = Math.min(this.order.length, BOARD_WINDOW);
    for (let index = 0; index < end; index += 1) {
      const id = this.order[index];
      const task = id ? this.byId.get(id) : undefined;
      if (!task) continue;
      rows.push(`${task.id}|${task.lane}|${task.requirements.length}`);
    }
    return rows;
  }
}

export function buildKitchenBoard(): BoardCockpitView {
  const tasks: BoardTask[] = [];
  for (let index = 0; index < BOARD_TASKS; index += 1) {
    const requirements: string[] = [];
    for (let requirement = 0; requirement < BOARD_REQUIREMENTS_PER_TASK; requirement += 1) {
      requirements.push(`R-${index}-${requirement}`);
    }
    const lane = LANES[index % LANES.length] ?? "backlog";
    tasks.push({ id: `T-${index}`, lane, requirements });
  }
  return new BoardCockpitView(tasks);
}

export class CoordinatorWriteQueue {
  async pound(dbPath: string, rounds = DB_ROUNDS, workers = DB_WORKERS): Promise<DbCertificate> {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    const samples: number[] = [];
    let busy = 0;
    const sql = "INSERT INTO task_holds (task, reason, source, created_at) VALUES (?, ?, ?, ?)";
    let slowMs = 0;
    const startedAt = performance.now();
    try {
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = NORMAL");
      db.exec("PRAGMA temp_store = MEMORY");
      db.exec("PRAGMA busy_timeout = 0");
      db.exec(
        `CREATE TABLE task_holds (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task TEXT NOT NULL,
          reason TEXT NOT NULL,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`,
      );
      db.exec("CREATE INDEX task_holds_task ON task_holds(task)");
      db.exec("CREATE TABLE query_trace (id INTEGER PRIMARY KEY AUTOINCREMENT, sql TEXT NOT NULL, duration_ms REAL NOT NULL)");
      const insert = db.prepare(
        "INSERT INTO task_holds (task, reason, source, created_at) VALUES (?, ?, 'm3-scale', '2026-11-22T00:00:00.000Z')",
      );
      const pending: PendingWrite[] = [];
      let pumpScheduled = false;
      const pump = (): void => {
        while (pending.length > 0) {
          const batch = pending.splice(0, 32);
          const started = performance.now();
          try {
            db.exec("BEGIN IMMEDIATE");
            db.exec("SAVEPOINT group_commit");
            for (const job of batch) insert.run(`worker-${job.worker}`, `n-${job.n}`);
            db.exec("RELEASE group_commit");
            db.exec("COMMIT");
          } catch (error) {
            try {
              db.exec("ROLLBACK");
            } catch (rollbackError) {
              if (isBusy(rollbackError)) busy += 1;
            }
            if (isBusy(error)) busy += batch.length;
            for (const job of batch) job.reject(error);
            continue;
          }
          const commitMs = performance.now() - started;
          if (commitMs >= slowMs) slowMs = commitMs;
          for (const job of batch) job.resolve(commitMs);
        }
      };
      const schedulePump = (): void => {
        if (pumpScheduled) return;
        pumpScheduled = true;
        queueMicrotask(() => {
          pumpScheduled = false;
          pump();
        });
      };
      const submit = (worker: number, n: number): Promise<number> =>
        new Promise((resolve, reject) => {
          pending.push({ worker, n, resolve, reject });
          schedulePump();
        });
      await submit(-1, 0);
      await Promise.all(
        Array.from({ length: workers }, async (_, worker) => {
          for (let round = 0; round < rounds; round += 1) {
            const enqueued = performance.now();
            await submit(worker, round);
            samples.push(performance.now() - enqueued);
          }
        }),
      );
      pump();
      db.prepare("INSERT INTO query_trace (sql, duration_ms) VALUES (?, ?)").run(sql, slowMs);
    } finally {
      db.close();
    }
    const judged = judgeDb(samples, busy, { sql, durationMs: slowMs });
    return {
      ...judged,
      samples: samples.length,
      workers,
      windowMs: performance.now() - startedAt,
      scenarioWindowSec: DB_SCENARIO_WINDOW_SEC,
    };
  }
}

export class M3ScaleAndLatencyCertifier {
  private readonly writer = new CoordinatorWriteQueue();

  async certifyDatabase(options?: { dbPath?: string; rounds?: number; workers?: number }): Promise<DbCertificate> {
    const dbPath = options?.dbPath ?? path.join(process.cwd(), "telemetry.db");
    return this.writer.pound(dbPath, options?.rounds ?? DB_ROUNDS, options?.workers ?? DB_WORKERS);
  }

  certifyBoard(): BoardCertificate {
    const view = buildKitchenBoard();
    const initialMs = view.mount();
    const burst: number[] = [];
    for (let worker = 0; worker < 20; worker += 1) {
      const deltas: BoardDelta[] = [];
      for (let step = 0; step < 25; step += 1) {
        const lane = LANES[(worker + step) % LANES.length] ?? "running";
        deltas.push({ id: `T-${(worker * 25 + step) % BOARD_TASKS}`, lane });
      }
      burst.push(view.applyBurst(deltas));
    }
    const judged = judgeBoard(initialMs, burst);
    return {
      ...judged,
      tasks: view.taskCount,
      requirements: view.requirementCount,
    };
  }

  certifyInjectedDb(dbPath: string): DbCertificate {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    const sql = "SELECT id FROM task_holds WHERE reason = ?";
    try {
      db.exec("CREATE TABLE query_trace (sql TEXT NOT NULL, duration_ms REAL NOT NULL)");
      db.prepare("INSERT INTO query_trace (sql, duration_ms) VALUES (?, ?)").run(sql, 64);
      const row = db.prepare("SELECT sql, duration_ms FROM query_trace ORDER BY duration_ms DESC LIMIT 1").get();
      const tracedSql = rowField(row, "sql") || sql;
      const tracedMs = Number(rowField(row, "duration_ms")) || 64;
      const samples = Array.from({ length: 100 }, () => tracedMs);
      const judged = judgeDb(samples, 0, { sql: tracedSql, durationMs: tracedMs });
      return {
        ...judged,
        samples: samples.length,
        workers: DB_WORKERS,
        windowMs: DB_SCENARIO_WINDOW_SEC * 1000,
        scenarioWindowSec: DB_SCENARIO_WINDOW_SEC,
      };
    } finally {
      db.close();
    }
  }

  certifyInjectedBoard(initialMs: number, burstMs: readonly number[]): BoardCertificate {
    const judged = judgeBoard(initialMs, burstMs);
    return {
      ...judged,
      tasks: BOARD_TASKS,
      requirements: BOARD_TASKS * BOARD_REQUIREMENTS_PER_TASK,
    };
  }
}
