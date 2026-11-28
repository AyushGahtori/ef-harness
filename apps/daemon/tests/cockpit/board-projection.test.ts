import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openProjectStateDb, TelemetryDb } from "@ef-harness/db";
import { explainCockpit } from "../../src/cockpit/explain.js";
import { readBoardProjection } from "../../src/cockpit/board-projection.js";
import { recordHealthMetric } from "../../src/cockpit/telemetry.js";
import type { SqlDb, SqlStatement } from "../../src/bootstrap/databases.js";

const closers: Array<() => void> = [];
const dirs: string[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("cockpit board projection", () => {
  it("joins task runtime, holds, and inbox into a pool snapshot", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c49-board-"));
    dirs.push(rootDir);
    const stateDb = openProjectStateDb({ projectId: `c49-${process.pid}`, rootDir, appVersion: "0.0.0" });
    closers.push(() => {
      stateDb.close();
    });
    stateDb.writer.run(
      "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES ('CS-1', 1, 'kernel', 'c49', 0)",
    );
    stateDb.writer.run(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES ('F1', 'feature', 1, 'h-F1', 'Feature', '', '{}', 'CS-1', 1, 1)`,
    );
    stateDb.writer.run(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES ('T07', 'task', 1, 'h-T07', 'Print the page', '', '{"feature":"F1"}', 'CS-1', 1, 4)`,
    );
    stateDb.writer.run(
      `INSERT INTO task_runtime(task, feature, state, level, epoch, updated_rev)
       VALUES ('T07', 'F1', 'CODING', 'Mid', 1, 4)`,
    );
    stateDb.writer.run(
      "INSERT INTO task_holds(task, reason, source, created_at) VALUES ('T07', 'user_pause', 'msg-1', 10)",
    );
    stateDb.writer.run(
      `INSERT INTO inbox_items(id, kind, priority, status, payload, created_at)
       VALUES ('Q1', 'question', 1, 'open', '{}', 11)`,
    );
    stateDb.writer.run("INSERT INTO inbox_subscribers(item, task) VALUES ('Q1', 'T07')");

    const projection = readBoardProjection(asSql(stateDb.writer));
    expect(projection.revision).toBe(4);
    expect(projection.tasks).toHaveLength(1);
    const task = projection.tasks[0];
    expect(task?.task).toBe("T07");
    expect(task?.title).toBe("Print the page");
    expect(task?.state).toBe("CODING");
    expect(task?.pool_phase).toBe("thinking");
    expect(task?.holds).toEqual([{ reason: "user_pause", source: "msg-1", summary: "user_pause (msg-1)" }]);
    expect(task?.open_inbox_item).toBe("Q1");
    expect(task?.inbox_need).toBe("question");
    expect(projection.capacity.thinkingUsed).toBe(1);
    expect(projection.capacity.thinkingCapacity).toBe(12);
    expect(projection.capacity.runSlotsCapacity).toBe(2);
    expect(projection.capacity.workerRunSlots).toBe(1);
    expect(projection.capacity.mergeQueueIdle).toBe(true);
  });

  it("validates cockpit-explainer@1 and writes the metric to telemetry.db", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c49-telemetry-"));
    dirs.push(rootDir);
    const telemetry = TelemetryDb.open({ filePath: path.join(rootDir, "telemetry.db") });
    closers.push(() => {
      telemetry.close();
    });
    const accepted = explainCockpit({ text: "It was trying to print the page. It stalled on a type error." });
    expect(accepted.ok).toBe(true);
    expect(accepted.reason).toBe("ok");
    const essay = explainCockpit({
      text: Array.from({ length: 10 }, (_, index) => `Speculation paragraph ${index + 1}.`).join(" "),
    });
    expect(essay.ok).toBe(false);
    expect(essay.reason).toBe("essay");
    expect(explainCockpit(undefined).reason).toBe("blocked");

    const ts = Date.now();
    const written = recordHealthMetric(telemetry, {
      attempt: "attempt-7",
      ts,
      data: { event: "health_signal_triggered", signal: "stuck_no_progress", taskId: "T07" },
    });
    expect(written.written).toBe(1);
    const page = telemetry.readPage();
    expect(page).toHaveLength(1);
    expect(page[0]).toMatchObject({
      attempt: "attempt-7",
      ts,
      kind: "metric",
      data: { event: "health_signal_triggered", signal: "stuck_no_progress", taskId: "T07" },
    });
  });
});

function asSql(writer: { prepare(sql: string): { get(params?: unknown): unknown; all(params?: unknown): unknown[]; run(params?: unknown): unknown } }): SqlDb {
  return {
    exec() {},
    prepare(sql: string): SqlStatement {
      const statement = writer.prepare(sql);
      return {
        run(...params: readonly unknown[]) {
          statement.run(params.length === 0 ? undefined : params);
        },
        get(...params: readonly unknown[]) {
          return statement.get(params.length === 0 ? undefined : params);
        },
        all(...params: readonly unknown[]) {
          return statement.all(params.length === 0 ? undefined : params);
        },
      };
    },
  };
}
