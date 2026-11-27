import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OutboxTransactionRequiredError, bindOutbox } from "../../src/outbox/index.js";
import { RollupWriteForbiddenError, bindReadModels } from "../../src/read-models/index.js";
import { openProjectStateDb } from "../../src/state-db/index.js";
import { bindCoordinatorWriteQueue } from "../../src/write-queue/index.js";

const closers: Array<() => Promise<void> | void> = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function textCell(row: unknown, key: string): string {
  if (row === null || typeof row !== "object") throw new Error(`expected a row when reading ${key}`);
  const value = Reflect.get(row, key);
  if (typeof value !== "string") throw new Error(`${key} is not text`);
  return value;
}

function numberCell(row: unknown, key: string): number {
  if (row === null || typeof row !== "object") throw new Error(`expected a row when reading ${key}`);
  const value = Reflect.get(row, key);
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "number") throw new Error(`${key} is not a number`);
  return value;
}

describe("ProjectStateDb outbox and read models", () => {
  it("appends deliveries in the write queue and pages rollups with zero drift", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c10-state-"));
    dirs.push(rootDir);
    const stateDb = openProjectStateDb({ projectId: "C10State", rootDir });
    const queue = bindCoordinatorWriteQueue(stateDb, {
      coalesceWindowMs: 0,
      pruneIntervalMs: Number.POSITIVE_INFINITY,
    });
    closers.unshift(async () => {
      await queue.drainAndClose();
      if (!stateDb.isClosed()) stateDb.close();
    });

    const outbox = bindOutbox(stateDb);
    const readModels = bindReadModels(stateDb);

    stateDb.writer.run(
      "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES ('CS-1', 1, 'kernel', 'c10', 0)",
    );
    stateDb.writer.run(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES ('F1', 'feature', 1, 'h-F1', 'Feature one', '', '{}', 'CS-1', 1, 1)`,
    );
    stateDb.writer.run(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES ('F2', 'feature', 1, 'h-F2', 'Feature two', '', '{}', 'CS-1', 1, 1)`,
    );
    stateDb.writer.run(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES ('T07', 'task', 1, 'h-T07', 'Task seven', '', '{"feature":"F1"}', 'CS-1', 1, 1)`,
    );
    stateDb.writer.run(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES ('T08', 'task', 1, 'h-T08', 'Task eight', '', '{"feature":"F2"}', 'CS-1', 1, 1)`,
    );
    stateDb.writer.run(
      `INSERT INTO task_runtime(task, feature, state, level, epoch, updated_rev)
       VALUES ('T07', 'F1', 'READY', 'Mid', 0, 1)`,
    );
    stateDb.writer.run(
      `INSERT INTO task_runtime(task, feature, state, level, epoch, updated_rev)
       VALUES ('T08', 'F2', 'READY', 'Mid', 0, 1)`,
    );

    const first = readModels.getBoardSnapshot(undefined, 1);
    expect(first.features.map((row) => row.feature)).toEqual(["F1"]);
    expect(first.features[0]?.taskTotal).toBe(1);
    expect(first.features[0]?.taskCounts.READY).toBe(1);
    expect(first.nextCursor).toBe("F1");
    const cursor = first.nextCursor;
    if (cursor === null) throw new Error("expected a board cursor");
    const second = readModels.getBoardSnapshot(cursor, 1);
    expect(second.features.map((row) => row.feature)).toEqual(["F2"]);
    expect(second.nextCursor).toBe(null);
    expect(readModels.getFeatureRollups().map((row) => row.feature)).toEqual(["F1", "F2"]);
    expect(readModels.recomputeRollupsAndVerifyZeroDrift().drifted).toBe(false);

    expect(() => readModels.database.exec("UPDATE rollup_feature_tasks SET n = 9")).toThrow(
      RollupWriteForbiddenError,
    );
    stateDb.writer.run("UPDATE rollup_feature_tasks SET n = n + 4 WHERE feature = 'F1' AND state = 'READY'");
    const healed = readModels.recomputeRollupsAndVerifyZeroDrift();
    expect(healed.drifted).toBe(true);
    expect(healed.healed).toBe(true);
    expect(healed.taskRollup.length).toBeGreaterThan(0);
    expect(readModels.recomputeRollupsAndVerifyZeroDrift().drifted).toBe(false);
    expect(
      numberCell(
        stateDb.writer.get(
          "SELECT n FROM rollup_feature_tasks WHERE feature = 'F1' AND state = 'READY'",
        ),
        "n",
      ),
    ).toBe(1);

    expect(outbox.currentStreamEpoch()).toBe("1");
    expect(textCell(stateDb.writer.get("SELECT value FROM meta WHERE key = 'stream_epoch'"), "value")).toBe("1");
    expect(() =>
      outbox.appendEvent({ id: "EV-x", type: "TaskAccepted", payload: { task: "T07" } }, ["scheduler"]),
    ).toThrow(OutboxTransactionRequiredError);

    let busy = 0;
    try {
      const receipt = queue.submitOperationSync({
        opId: "op-outbox-1",
        kind: "outbox.append",
        request: { ids: ["EV-1", "EV-2"] },
        execute: () => {
          const firstEvent = outbox.appendEvent(
            { id: "EV-1", type: "TaskAccepted", subject: "T07", payload: { task: "T07" }, createdAt: 10 },
            ["scheduler"],
          );
          const secondEvent = outbox.appendEvent(
            { id: "EV-2", type: "DependencyReady", subject: "T08", payload: { task: "T08" }, createdAt: 11 },
            ["scheduler"],
          );
          return { seqs: [firstEvent.seq, secondEvent.seq], consumers: firstEvent.consumers.length };
        },
      });
      expect(receipt.replayed).toBe(false);
      expect(receipt.result).toEqual({ seqs: [1, 2], consumers: 3 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/SQLITE_BUSY|database is locked/u.test(message)) busy += 1;
      else throw error;
    }
    expect(busy).toBe(0);

    expect(
      numberCell(
        stateDb.writer.get(
          "SELECT count(*) AS n FROM outbox o WHERE NOT EXISTS (SELECT 1 FROM outbox_deliveries d WHERE d.event_id = o.id)",
        ),
        "n",
      ),
    ).toBe(0);
    expect(numberCell(stateDb.writer.get("SELECT count(*) AS n FROM outbox"), "n")).toBe(2);
    expect(numberCell(stateDb.writer.get("SELECT count(*) AS n FROM outbox_deliveries"), "n")).toBeGreaterThan(0);

    const live = outbox.readSinceSeq("1", 0, 10);
    expect(live.resyncRequired).toBe(false);
    expect(live.streamEpoch).toBe("1");
    expect(live.events.map((event) => event.id)).toEqual(["EV-1", "EV-2"]);
    const stale = outbox.readSinceSeq("2", 0, 10);
    expect(stale.resyncRequired).toBe(true);
    expect(stale.events).toEqual([]);
    expect(stale.streamEpoch).toBe("1");
    expect(outbox.ackDelivery("EV-1", "scheduler", 20)).toBe(true);

    readModels.close();
    expect(stateDb.isClosed()).toBe(false);
    expect(outbox.currentStreamEpoch()).toBe("1");
  });
});
