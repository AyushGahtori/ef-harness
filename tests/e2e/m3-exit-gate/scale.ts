import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CoordinatorWriteQueue, GlobalBrokerDb, TelemetryDb, openProjectStateDb } from "@ef-harness/db";
import type { PreparedWrite, ProjectStateDb, SafeModeDiagnostics, SafeModeReason } from "@ef-harness/db";
import { WindowsDpapiSecretsVault } from "@ef-harness/governor";
import { BoardCockpitView } from "@ef-harness/renderer";
import type { BoardTaskRecord, ThreePoolCapacitySnapshot } from "@ef-harness/renderer";
import type { BoardCertificate, DbCertificate } from "./types.js";

export const DB_WORKERS = 50;
export const DB_ROUNDS = 8;
export const DB_SCENARIO_WINDOW_SEC = 60;
export const BOARD_TASKS = 500;
export const BOARD_REQUIREMENTS = 5000;
export const HOLD_SQL = "SELECT task, reason, source FROM task_holds WHERE reason = ?";

const CAPACITY: ThreePoolCapacitySnapshot = {
  thinkingUsed: 4,
  thinkingCapacity: 20,
  runSlotsUsed: 1,
  runSlotsCapacity: 4,
  verifierRunSlots: 1,
  workerRunSlots: 3,
  runSlotQueueDepth: 0,
  mergeQueueIdle: true,
  mergeQueueDetail: "",
};

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}

function taskRecord(index: number): BoardTaskRecord {
  const lane = index % 7;
  return {
    taskId: `T${index.toString().padStart(3, "0")}`,
    feature: `F${(index % 20).toString().padStart(2, "0")}`,
    state: lane === 6 ? "PARKED" : "READY",
    level: "mid",
    title: `kitchen task ${index}`,
    agentId: `A${(index % 12).toString().padStart(4, "0")}`,
    connectionId: "chatgpt-plan",
    connectionLabel: "ChatGPT plan",
    providerId: "openai",
    holderAttempt: null,
    submissionPending: false,
    holds: [],
    openInboxItemId: null,
    inboxNeed: null,
    inboxBlockedTaskIds: [],
    blockedBy: [],
    mergeBehindCount: null,
    mergeBehindLabel: null,
    activity: "none",
    reviewer: null,
    poolPhase: null,
    runSlot: null,
    runSlotCapacity: null,
    queuePosition: null,
    queueBlocker: null,
    runningCommand: null,
    elapsedSeconds: null,
    verifyFlow: null,
    retry: null,
    retryMax: null,
    hint: null,
    statusEvent: null,
    requirementCount: BOARD_REQUIREMENTS / BOARD_TASKS,
    updatedAtMs: index,
    acceptedLabel: null,
    spendLabel: null,
  };
}

function ports() {
  return {
    inspector: { open(): void { /* viewport selection is unused by the latency probe */ } },
    actions: { perform(): void { /* quick actions are unused by the latency probe */ } },
    health: { signalsFor: () => [] },
  };
}

function paint(view: BoardCockpitView): number {
  const started = performance.now();
  view.snapshot();
  view.renderHtml();
  return performance.now() - started;
}

export function certifyBoard(): BoardCertificate {
  const tasks = Array.from({ length: BOARD_TASKS }, (_, index) => taskRecord(index));
  const view = new BoardCockpitView({
    tasks,
    capacity: CAPACITY,
    ...ports(),
    theme: "light",
    viewportHeightPx: 720,
    overscanPx: 200,
  });
  const initialMs = paint(view);
  const samples = [initialMs];
  for (let burst = 0; burst < 8; burst += 1) {
    const next = tasks.map((task, index) => (index === burst ? { ...task, title: `updated ${burst}` } : task));
    const started = performance.now();
    view.replaceSnapshot(next, CAPACITY);
    view.snapshot();
    view.renderHtml();
    samples.push(performance.now() - started);
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const boardUpdateMs = samples[1] ?? initialMs;
  const boardPaintP95Ms = percentile(sorted, 0.95);
  const pass = initialMs < 10 && boardUpdateMs < 10 && boardPaintP95Ms < 50;
  return {
    tasks: BOARD_TASKS,
    requirements: BOARD_REQUIREMENTS,
    initialMs,
    boardUpdateMs,
    boardPaintP95Ms,
    pass,
    detail: [
      `BoardCockpitView ${BOARD_TASKS} tasks / ${BOARD_REQUIREMENTS} requirements`,
      `initial ${initialMs.toFixed(3)} ms update ${boardUpdateMs.toFixed(3)} ms paint p95 ${boardPaintP95Ms.toFixed(3)} ms`,
    ],
  };
}

export function certifyInjectedBoard(initialMs: number, bursts: readonly number[]): BoardCertificate {
  const view = new BoardCockpitView({
    tasks: [taskRecord(0)],
    capacity: CAPACITY,
    ...ports(),
    theme: "light",
    viewportHeightPx: 720,
    overscanPx: 0,
  });
  view.snapshot();
  const boardUpdateMs = bursts.reduce((max, sample) => Math.max(max, sample), 0);
  const pass = initialMs < 10 && boardUpdateMs < 10;
  return {
    tasks: BOARD_TASKS,
    requirements: BOARD_REQUIREMENTS,
    initialMs,
    boardUpdateMs,
    boardPaintP95Ms: boardUpdateMs,
    pass,
    detail: [`injected board update ${boardUpdateMs} ms`],
  };
}

function seedState(writer: { exec(sql: string): void; prepare(sql: string): { run(params?: Record<string, string | number>): unknown } }): void {
  writer.exec("INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES ('CS-m3', 1, 'kernel', 'm3', 0)");
  const node = writer.prepare(
    "INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev) VALUES (:id, :kind, 1, :hash, :title, '', '{}', 'CS-m3', 1, 1)",
  );
  const feature = writer.prepare("INSERT INTO feature_runtime(feature, state, updated_rev) VALUES (:id, 'IN_WAVE', 1)");
  const task = writer.prepare("INSERT INTO task_runtime(task, feature, state, level, updated_rev) VALUES (:id, :feature, 'READY', 'Mid', 1)");
  node.run({ id: "F-scale", kind: "feature", hash: "h-F-scale", title: "F-scale" });
  feature.run({ id: "F-scale" });
  for (let worker = 0; worker < DB_WORKERS; worker += 1) {
    const id = `T${worker.toString().padStart(2, "0")}`;
    node.run({ id, kind: "task", hash: `h-${id}`, title: id });
    task.run({ id, feature: "F-scale" });
  }
}

function queueState(state: ProjectStateDb) {
  return {
    isSafeMode: () => state.isSafeMode(),
    enterSafeMode: (reason: string, diagnostics?: Readonly<Record<string, string | number>>) => {
      const full: SafeModeDiagnostics = {
        message: typeof diagnostics?.message === "string" ? diagnostics.message : reason,
        worktreesPreserved: true,
        checkpointsPreserved: true,
      };
      state.enterSafeMode(reason as SafeModeReason, full);
    },
    writer: {
      exec: (sql: string) => {
        state.writer.exec(sql);
      },
      prepare: (sql: string): PreparedWrite => {
        const prepared = state.writer.prepare(sql);
        return {
          get: (params) => prepared.get(params) as unknown as ReturnType<PreparedWrite["get"]>,
          all: (params) => prepared.all(params) as unknown as ReturnType<PreparedWrite["all"]>,
          run: (params) => prepared.run(params),
        };
      },
    },
  };
}

async function measureQueue(root: string, rounds: number): Promise<{ p99Ms: number; busy: number; samples: number; windowMs: number }> {
  const projectId = `m3-${path.basename(root)}`;
  const state = openProjectStateDb({ projectId, rootDir: root });
  const queue = new CoordinatorWriteQueue({
    stateDb: queueState(state),
    coalesceWindowMs: 0,
    maxBatchSize: 32,
    pruneIntervalMs: Number.POSITIVE_INFINITY,
  });
  let busy = 0;
  const started = performance.now();
  try {
    await queue.submitOperation({
      opId: "seed-holds",
      kind: "seed",
      request: { workers: DB_WORKERS },
      execute: (tx) => {
        seedState(tx);
        return { seeded: DB_WORKERS };
      },
    });
    await Promise.all(
      Array.from({ length: DB_WORKERS }, async (_, worker) => {
        for (let round = 0; round < rounds; round += 1) {
          try {
            await queue.submitOperation({
              opId: `hold-${worker}-${round}`,
              kind: "hold",
              request: { worker, round },
              execute: (tx) => {
                const taskId = `T${worker.toString().padStart(2, "0")}`;
                tx.prepare(
                  "INSERT INTO task_holds (task, reason, source, created_at) VALUES (:task, 'governor', :source, :created_at)",
                ).run({ task: taskId, source: `w${worker}-r${round}`, created_at: round + 1 });
                tx.prepare(HOLD_SQL.replace("?", ":reason")).run({ reason: "governor" });
                return { worker, round };
              },
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("SQLITE_BUSY") || message.includes("database is locked")) busy += 1;
            else throw error;
          }
        }
      }),
    );
    const metrics = queue.getQueueMetrics();
    return { p99Ms: metrics.p99Ms, busy, samples: metrics.samples, windowMs: performance.now() - started };
  } finally {
    await queue.drainAndClose();
    state.close();
  }
}

function recordTrace(file: string, sql: string, p99Ms: number): void {
  const telemetry = TelemetryDb.open({ filePath: file });
  try {
    telemetry.enqueue({
      ts: Date.now(),
      kind: "metric",
      data: { sql, p99Ms, name: "task_holds" },
    });
    telemetry.flush();
  } finally {
    telemetry.close();
  }
}

export async function certifyDatabase(options: { dbPath: string; rounds?: number }): Promise<DbCertificate> {
  const rounds = options.rounds ?? DB_ROUNDS;
  const root = path.dirname(options.dbPath);
  fs.mkdirSync(root, { recursive: true });
  const measured = await measureQueue(root, rounds);
  recordTrace(options.dbPath, HOLD_SQL, measured.p99Ms);
  const pass = measured.p99Ms < 50 && measured.busy === 0 && measured.samples >= DB_WORKERS;
  return {
    p99Ms: measured.p99Ms,
    busy: measured.busy,
    samples: measured.samples,
    workers: DB_WORKERS,
    windowMs: measured.windowMs,
    scenarioWindowSec: DB_SCENARIO_WINDOW_SEC,
    slowSql: HOLD_SQL,
    slowMs: measured.p99Ms,
    pass,
    detail: [
      `${HOLD_SQL} via CoordinatorWriteQueue`,
      `${options.dbPath} workers ${DB_WORKERS} samples ${measured.samples} p99 ${measured.p99Ms.toFixed(3)} ms busy ${measured.busy}`,
    ],
  };
}

export async function certifyInjectedDb(dbPath: string): Promise<DbCertificate> {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "m3-injected-db-"));
  try {
    await measureQueue(root, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const p99Ms = 64;
  recordTrace(dbPath, HOLD_SQL, p99Ms);
  return {
    p99Ms,
    busy: 0,
    samples: 1,
    workers: DB_WORKERS,
    windowMs: p99Ms,
    scenarioWindowSec: DB_SCENARIO_WINDOW_SEC,
    slowSql: HOLD_SQL,
    slowMs: p99Ms,
    pass: false,
    detail: [`${HOLD_SQL} p99 ${p99Ms} ms`, dbPath],
  };
}

export class M3ScaleAndLatencyCertifier {
  certifyDatabase(options: { dbPath: string; rounds?: number }): Promise<DbCertificate> {
    return certifyDatabase(options);
  }

  certifyBoard(): BoardCertificate {
    return certifyBoard();
  }

  certifyInjectedDb(dbPath: string): Promise<DbCertificate> {
    return certifyInjectedDb(dbPath);
  }

  certifyInjectedBoard(initialMs: number, bursts: readonly number[]): BoardCertificate {
    return certifyInjectedBoard(initialMs, bursts);
  }
}

export async function storeWithRealVault(root: string, name: string, value: string): Promise<"stored" | "windows_only"> {
  const global = GlobalBrokerDb.open({ root: path.join(root, "global") });
  const state = openProjectStateDb({ projectId: `vault-${path.basename(root)}`, rootDir: path.join(root, "state") });
  try {
    const vault = new WindowsDpapiSecretsVault({
      global,
      state,
      vaultDir: path.join(root, "vault"),
    });
    await vault.storeSecret({ projectId: state.projectId, envScope: "dev", name, value });
    return "stored";
  } catch (error) {
    const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
    if (message.includes("dpapi_windows_only") || message.includes("Windows DPAPI")) return "windows_only";
    throw error;
  } finally {
    state.close();
    global.close();
  }
}
