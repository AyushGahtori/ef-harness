import { afterEach, describe, expect, it } from "vitest";

import {
  CoordinatorWriteQueue,
  ProjectSafeModeError,
  QueueBackpressureError,
  QueueClosedError,
} from "../../src/write-queue/index.js";
import { openState, scalar, type OpenedState } from "./state-db.js";

const openDatabases: OpenedState[] = [];
const queues: CoordinatorWriteQueue[] = [];

afterEach(async () => {
  for (const queue of queues.splice(0)) await queue.drainAndClose();
  for (const opened of openDatabases.splice(0)) opened.close();
});

function startQueue(opened: OpenedState): CoordinatorWriteQueue {
  openDatabases.push(opened);
  const queue = new CoordinatorWriteQueue({
    stateDb: opened.stateDb,
    coalesceWindowMs: 0,
    pruneIntervalMs: Number.POSITIVE_INFINITY,
  });
  queues.push(queue);
  return queue;
}

const MUTATIONS = `
CREATE TABLE mutations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id TEXT NOT NULL,
  payload TEXT NOT NULL
) STRICT;
CREATE TABLE counter (id INTEGER PRIMARY KEY CHECK (id = 1), value INTEGER NOT NULL) STRICT;
INSERT INTO counter (id, value) VALUES (1, 0);
`;

describe("write-queue group commit", () => {
  it("isolates a failed savepoint and replays a duplicate op_id inside the same batch", async () => {
    const opened = openState({ extraSql: MUTATIONS });
    const queue = startQueue(opened);
    const shared = { step: 2 };
    const calls = new Map<string, number>();
    const tasks = Array.from({ length: 10 }, (_, index) => {
      const number = index + 1;
      const duplicate = number === 7;
      const opId = duplicate ? "op-2" : `op-${number}`;
      const request = duplicate ? shared : { step: number };
      return queue.submitOperation({
        opId,
        kind: "runtime",
        request,
        execute: (tx) => {
          calls.set(opId, (calls.get(opId) ?? 0) + 1);
          if (number === 3) {
            tx.prepare("INSERT INTO mutations (op_id, payload) VALUES (:op_id, 'leak')").run({
              op_id: "leak",
            });
            throw new Error("stale epoch");
          }
          tx.prepare("INSERT INTO mutations (op_id, payload) VALUES (:op_id, :payload)").run({
            op_id: opId,
            payload: String(number),
          });
          return { step: duplicate ? 2 : number };
        },
      });
    });
    const settled = await Promise.allSettled(tasks);
    const rejected = settled.filter((entry) => entry.status === "rejected");
    const fulfilled = settled.filter((entry) => entry.status === "fulfilled");
    expect(rejected).toHaveLength(1);
    expect(fulfilled).toHaveLength(9);
    expect(settled[2]?.status).toBe("rejected");
    if (settled[2]?.status === "rejected") {
      expect((settled[2].reason as Error).message).toContain("stale epoch");
    }
    expect(settled[6]?.status).toBe("fulfilled");
    if (settled[1]?.status === "fulfilled" && settled[6]?.status === "fulfilled") {
      expect(settled[6].value.replayed).toBe(true);
      expect(settled[6].value.result).toEqual(settled[1].value.result);
    }
    expect(calls.get("op-2")).toBe(1);
    expect(scalar(opened.database, "SELECT count(*) AS n FROM mutations")).toBe(8);
    expect(scalar(opened.database, "SELECT count(*) AS n FROM mutations WHERE op_id = 'leak'")).toBe(0);
    expect(scalar(opened.database, "SELECT count(*) AS n FROM operations WHERE op_id = 'op-3'")).toBe(0);
    expect(opened.commits.count).toBe(1);
  });

  it("rolls one unexpected error out of a 20-operation batch and commits the other 19", async () => {
    const opened = openState({ extraSql: MUTATIONS });
    const queue = startQueue(opened);
    const tasks = Array.from({ length: 20 }, (_, index) =>
      queue.submitOperation({
        opId: `batch-${index}`,
        kind: "check",
        request: { index },
        execute: (tx) => {
          tx.prepare("INSERT INTO mutations (op_id, payload) VALUES (:op_id, :payload)").run({
            op_id: index === 9 ? "leak" : `batch-${index}`,
            payload: String(index),
          });
          if (index === 9) throw new Error("unexpected validation crash");
          return { index };
        },
      }),
    );
    const settled = await Promise.allSettled(tasks);
    expect(settled.filter((entry) => entry.status === "fulfilled")).toHaveLength(19);
    expect(settled[9]?.status).toBe("rejected");
    expect(scalar(opened.database, "SELECT count(*) AS n FROM mutations")).toBe(19);
    expect(scalar(opened.database, "SELECT count(*) AS n FROM mutations WHERE op_id = 'leak'")).toBe(0);
    expect(opened.commits.count).toBe(1);
  });

  it("lets operation i+1 observe the savepoint state left by operation i", async () => {
    const opened = openState({ extraSql: MUTATIONS });
    const queue = startQueue(opened);
    const first = queue.submitOperation({
      opId: "inc-1",
      kind: "runtime",
      request: { n: 1 },
      execute: (tx) => {
        tx.exec("UPDATE counter SET value = value + 1 WHERE id = 1");
        const row = tx.prepare("SELECT value FROM counter WHERE id = 1").get();
        return { value: Number(row?.value) };
      },
    });
    const second = queue.submitOperation({
      opId: "inc-2",
      kind: "runtime",
      request: { n: 2 },
      execute: (tx) => {
        const row = tx.prepare("SELECT value FROM counter WHERE id = 1").get();
        tx.exec("UPDATE counter SET value = value + 1 WHERE id = 1");
        return { seen: Number(row?.value) };
      },
    });
    const [left, right] = await Promise.all([first, second]);
    expect(left.result).toEqual({ value: 1 });
    expect(right.result).toEqual({ seen: 1 });
    expect(scalar(opened.database, "SELECT value AS n FROM counter")).toBe(2);
  });

  it("runs interactive work before runtime work already queued in the same batch", async () => {
    const opened = openState({
      extraSql:
        "CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL) STRICT;",
    });
    const queue = startQueue(opened);
    const runtime = Array.from({ length: 6 }, (_, index) =>
      queue.submitOperation({
        opId: `rt-${index}`,
        kind: "runtime",
        priority: "runtime",
        request: { index },
        execute: (tx) => {
          tx.prepare("INSERT INTO events (label) VALUES (:label)").run({ label: "runtime" });
          return { index };
        },
      }),
    );
    const interactive = queue.submitOperation({
      opId: "stop-1",
      kind: "stop",
      priority: "interactive",
      request: { action: "stop" },
      execute: (tx) => {
        tx.prepare("INSERT INTO events (label) VALUES ('interactive')").run();
        return { stopped: true };
      },
    });
    await Promise.all([...runtime, interactive]);
    const first = opened.database.prepare("SELECT label FROM events ORDER BY id LIMIT 1").get() as
      | { label: string }
      | undefined;
    expect(first?.label).toBe("interactive");
    expect(opened.commits.count).toBe(1);
  });

  it("rejects every caller when COMMIT fails with SQLITE_FULL and enters safe mode", async () => {
    const opened = openState({ extraSql: MUTATIONS });
    opened.stateDb.execHook = (sql) => {
      if (/^\s*COMMIT\b/i.test(sql)) {
        const error = new Error("SQLITE_FULL: database or disk is full");
        (error as Error & { code: string }).code = "SQLITE_FULL";
        throw error;
      }
      opened.database.exec(sql);
    };
    const queue = startQueue(opened);
    const tasks = Array.from({ length: 10 }, (_, index) =>
      queue.submitOperation({
        opId: `full-${index}`,
        kind: "reserve",
        request: { index },
        execute: (tx) => {
          tx.prepare("INSERT INTO mutations (op_id, payload) VALUES (:op_id, 'ok')").run({
            op_id: `full-${index}`,
          });
          return { index };
        },
      }),
    );
    const settled = await Promise.allSettled(tasks);
    expect(settled.every((entry) => entry.status === "rejected")).toBe(true);
    expect(settled.some((entry) => entry.status === "fulfilled")).toBe(false);
    expect(opened.stateDb.safeModeEntries.map((entry) => entry.reason)).toEqual(["disk_full"]);
    expect(opened.stateDb.isSafeMode()).toBe(true);
    expect(scalar(opened.database, "SELECT count(*) AS n FROM mutations")).toBe(0);
    expect(scalar(opened.database, "SELECT count(*) AS n FROM operations")).toBe(0);
    expect(() =>
      queue.submitOperation({
        opId: "after-full",
        kind: "reserve",
        request: { index: 99 },
        execute: () => ({ ok: true }),
      }),
    ).toThrow(ProjectSafeModeError);
  });

  it("rejects new writes with backpressure and halts dequeue in safe mode", async () => {
    const opened = openState();
    openDatabases.push(opened);
    const queue = new CoordinatorWriteQueue({
      stateDb: opened.stateDb,
      coalesceWindowMs: 0,
      pruneIntervalMs: Number.POSITIVE_INFINITY,
      caps: { runtime: 2, interactive: 1, knowledge_barrier: 1 },
    });
    queues.push(queue);
    const first = queue.submitOperation({
      opId: "cap-1",
      kind: "runtime",
      request: { n: 1 },
      execute: () => ({ n: 1 }),
    });
    const second = queue.submitOperation({
      opId: "cap-2",
      kind: "runtime",
      request: { n: 2 },
      execute: () => ({ n: 2 }),
    });
    expect(() =>
      queue.submitOperation({
        opId: "cap-3",
        kind: "runtime",
        request: { n: 3 },
        execute: () => ({ n: 3 }),
      }),
    ).toThrow(QueueBackpressureError);
    await Promise.all([first, second]);
    expect(queue.getQueueMetrics().backpressureRejections).toBe(1);

    const blocked = openState();
    openDatabases.push(blocked);
    const blockedQueue = new CoordinatorWriteQueue({
      stateDb: blocked.stateDb,
      coalesceWindowMs: 30,
      pruneIntervalMs: Number.POSITIVE_INFINITY,
    });
    queues.push(blockedQueue);
    const pending = blockedQueue.submitOperation({
      opId: "held",
      kind: "runtime",
      request: { n: 1 },
      execute: () => ({ ok: true }),
    });
    blocked.stateDb.armSafeMode();
    await expect(pending).rejects.toBeInstanceOf(ProjectSafeModeError);
    expect(blocked.commits.count).toBe(0);
  });

  it("flushRuntimeBatch commits queued runtime work without waiting out the coalesce window", async () => {
    const opened = openState();
    openDatabases.push(opened);
    const queue = new CoordinatorWriteQueue({
      stateDb: opened.stateDb,
      coalesceWindowMs: 5_000,
      pruneIntervalMs: Number.POSITIVE_INFINITY,
    });
    queues.push(queue);
    const pending = queue.submitOperation({
      opId: "flush-1",
      kind: "runtime",
      request: { n: 1 },
      execute: () => ({ flushed: true }),
    });
    const started = performance.now();
    await queue.flushRuntimeBatch();
    await expect(pending).resolves.toMatchObject({ result: { flushed: true } });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(opened.commits.count).toBe(1);
  });

  it("drains queued work and then refuses new writes", async () => {
    const opened = openState();
    openDatabases.push(opened);
    const queue = new CoordinatorWriteQueue({
      stateDb: opened.stateDb,
      coalesceWindowMs: 40,
      pruneIntervalMs: Number.POSITIVE_INFINITY,
    });
    queues.push(queue);
    const pending = queue.submitOperation({
      opId: "drain-1",
      kind: "runtime",
      request: { n: 1 },
      execute: () => ({ drained: true }),
    });
    const closed = queue.drainAndClose();
    await expect(pending).resolves.toMatchObject({ result: { drained: true } });
    await closed;
    expect(() =>
      queue.submitOperation({
        opId: "drain-2",
        kind: "runtime",
        request: { n: 2 },
        execute: () => ({ drained: false }),
      }),
    ).toThrow(QueueClosedError);
  });
});
