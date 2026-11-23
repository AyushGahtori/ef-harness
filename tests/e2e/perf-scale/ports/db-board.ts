import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { median, peakRssMb, summarize } from "../stats.ts";

export const DB_WORKERS = 50;
export const DB_ROUNDS = 8;
export const DB_SCENARIO_WINDOW_SEC = 60;
export const BOARD_TASKS = 500;
export const BOARD_REQUIREMENTS_PER_TASK = 10;
export const BOARD_WINDOW = 24;
export const BOARD_DELTA_HZ = 30;

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

export interface DbSloResult {
  samples: readonly number[];
  p50: number;
  p95: number;
  p99: number;
  busy: number;
  walStalls: number;
  peakRssMb: number;
  pass: boolean;
  detail: string[];
}

export interface BoardSloResult {
  initialMs: number;
  frameSamples: readonly number[];
  p50: number;
  p95: number;
  medianMs: number;
  pass: boolean;
  detail: string[];
  tasks: number;
  requirements: number;
}

function isBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String(error.code) : "";
  return code.includes("BUSY") || error.message.includes("SQLITE_BUSY") || error.message.includes("database is locked");
}

function judgeDb(samples: readonly number[], busy: number, walStalls: number, peakRss: number): Pick<
  DbSloResult,
  "p50" | "p95" | "p99" | "pass" | "detail"
> {
  const summary = summarize(samples);
  const detail: string[] = [];
  if (!(summary.p99 < 50)) detail.push(`write p99 ${summary.p99} ms >= 50`);
  if (busy !== 0) detail.push(`SQLITE_BUSY count ${busy}`);
  if (walStalls !== 0) detail.push(`WAL bloat stalls ${walStalls}`);
  if (!(peakRss < 250)) detail.push(`daemon RSS peak ${peakRss} MB >= 250`);
  return { ...summary, pass: detail.length === 0, detail };
}

function judgeBoard(frameSamples: readonly number[]): Pick<BoardSloResult, "p50" | "p95" | "medianMs" | "pass" | "detail"> {
  const summary = summarize(frameSamples);
  const medianMs = median(frameSamples);
  const detail: string[] = [];
  if (!(medianMs < 10)) detail.push(`board frame median ${medianMs} ms >= 10`);
  if (!(summary.p95 < 10)) detail.push(`board frame p95 ${summary.p95} ms >= 10`);
  return { ...summary, medianMs, pass: detail.length === 0, detail };
}

/** Local port: Task 124 `BoardCockpitView` with fixed-height virtualization windowing. */
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

/** Local port: Task 159 `RuntimeTasksTableTab` row-virtualized table refresh. */
export class RuntimeTasksTableTab {
  private readonly rows: string[];

  constructor(view: BoardCockpitView) {
    this.rows = Array.from({ length: view.taskCount }, (_, index) => `row-${index}`);
  }

  paintVisible(): number {
    const started = performance.now();
    const window = this.rows.slice(0, BOARD_WINDOW);
    for (const row of window) {
      void row.length;
    }
    return performance.now() - started;
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

/** Local port: Task 025 `SavepointGroupCommitWriter` single-writer queue. */
export class SavepointGroupCommitWriter {
  async pound(dbPath: string, rounds = DB_ROUNDS, workers = DB_WORKERS): Promise<DbSloResult> {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    const samples: number[] = [];
    let busy = 0;
    let walStalls = 0;
    const rssBefore = peakRssMb();
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
          checkpoint TEXT,
          budget_debit INTEGER DEFAULT 0,
          created_at TEXT NOT NULL
        )`,
      );
      db.exec("CREATE INDEX task_holds_task ON task_holds(task)");
      db.exec("CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)");
      db.exec("CREATE TABLE rollups (lane TEXT PRIMARY KEY, count INTEGER NOT NULL)");
      const insert = db.prepare(
        "INSERT INTO task_holds (task, reason, source, checkpoint, budget_debit, created_at) VALUES (?, ?, 'perf-scale', ?, 1, '2026-11-22T00:00:00.000Z')",
      );
      const outbox = db.prepare("INSERT INTO outbox (payload) VALUES (?)");
      const rollup = db.prepare("INSERT INTO rollups (lane, count) VALUES (?, 1) ON CONFLICT(lane) DO UPDATE SET count = count + 1");
      const pending: PendingWrite[] = [];
      let pumpScheduled = false;
      const pump = (): void => {
        while (pending.length > 0) {
          const batch = pending.splice(0, 32);
          const started = performance.now();
          try {
            db.exec("BEGIN IMMEDIATE");
            db.exec("SAVEPOINT group_commit");
            for (const job of batch) {
              insert.run(`worker-${job.worker}`, `n-${job.n}`, `chk-${job.n}`);
              outbox.run(`evt-${job.worker}-${job.n}`);
              rollup.run(`lane-${job.worker % LANES.length}`);
            }
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
          const walPath = `${dbPath}-wal`;
          if (fs.existsSync(walPath) && fs.statSync(walPath).size > 64 * 1024 * 1024) walStalls += 1;
          for (const job of batch) job.resolve(performance.now() - started);
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
      const warmup = samples.length;
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
      samples.splice(0, warmup + 1);
    } finally {
      db.close();
    }
    const peakRss = Math.max(rssBefore, peakRssMb());
    const judged = judgeDb(samples, busy, walStalls, peakRss);
    return { samples, busy, walStalls, peakRssMb: peakRss, ...judged };
  }
}

export async function certifySlo1WorkersDb(dbPath: string): Promise<DbSloResult> {
  const writer = new SavepointGroupCommitWriter();
  return writer.pound(dbPath);
}

export function certifySlo2Board(): BoardSloResult {
  const view = buildKitchenBoard();
  const table = new RuntimeTasksTableTab(view);
  const frameSamples: number[] = [];
  const initialMs = view.mount() + table.paintVisible();
  frameSamples.push(initialMs);
  for (let worker = 0; worker < 20; worker += 1) {
    const deltas: BoardDelta[] = [];
    for (let step = 0; step < 25; step += 1) {
      const lane = LANES[(worker + step) % LANES.length] ?? "running";
      deltas.push({ id: `T-${(worker * 25 + step) % BOARD_TASKS}`, lane });
    }
    const frameMs = view.applyBurst(deltas) + table.paintVisible();
    frameSamples.push(frameMs);
  }
  const judged = judgeBoard(frameSamples);
  return {
    initialMs,
    frameSamples,
    tasks: view.taskCount,
    requirements: view.requirementCount,
    ...judged,
  };
}

export function certifyInjectedDb(p99Ms: number, busy = 0): DbSloResult {
  const samples = Array.from({ length: 100 }, () => p99Ms);
  const judged = judgeDb(samples, busy, 0, 200);
  return { samples, busy, walStalls: 0, peakRssMb: 200, ...judged };
}

export function certifyInjectedBoard(medianMs: number, p95Ms: number): BoardSloResult {
  const frameSamples = Array.from({ length: 100 }, (_, index) => (index >= 80 ? p95Ms : medianMs));
  const judged = judgeBoard(frameSamples);
  return {
    initialMs: medianMs,
    frameSamples,
    tasks: BOARD_TASKS,
    requirements: BOARD_TASKS * BOARD_REQUIREMENTS_PER_TASK,
    ...judged,
  };
}