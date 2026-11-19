import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  HOLD_REASONS,
  TaskHeldError,
  canonicalStateSqlPath,
  type TaskHold,
} from "../../src/holds/index.js";
import { countRows, openHarness, queryText, readRuntime, seedTask, setRuntime, type HarnessHandle } from "./fixture.js";

let handle: HarnessHandle | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
});

function setup(task = "T07"): HarnessHandle {
  handle = openHarness();
  seedTask(handle.db, task);
  return handle;
}

describe("multi-reason holds", () => {
  it("keeps user_pause after requirement_change is released and claim_task still refuses", () => {
    const { db, repo, queries } = setup();
    const before = readRuntime(db, "T07");

    const pause = repo.placeHold({
      task: "T07",
      reason: "user_pause",
      source: "msg-1",
      now: 10,
      rev: 2,
    });
    const steer = repo.placeHold({
      task: "T07",
      reason: "requirement_change",
      source: "CS-88",
      now: 11,
      rev: 2,
    });
    repo.placeHold({ task: "T07", reason: "budget", source: "grant-1", now: 12, rev: 2 });
    repo.placeHold({ task: "T07", reason: "ccr", source: "CCR-4", now: 13, rev: 2 });
    repo.placeHold({ task: "T07", reason: "governor", source: "yellow", now: 14, rev: 2 });

    expect(pause.placed).toBe(true);
    expect(steer.placed).toBe(true);
    expect(pause.taskState).toBe("READY");
    expect(readRuntime(db, "T07")).toEqual(before);
    expect(repo.listActiveHolds("T07").map((hold: TaskHold) => [hold.reason, hold.source])).toEqual([
      ["user_pause", "msg-1"],
      ["requirement_change", "CS-88"],
      ["budget", "grant-1"],
      ["ccr", "CCR-4"],
      ["governor", "yellow"],
    ]);

    const released = repo.releaseHold({
      task: "T07",
      reason: "requirement_change",
      source: "CS-88",
      now: 20,
      rev: 3,
    });
    expect(released.removed).toBe(true);
    expect(released.taskState).toBe("READY");
    expect(released.remainingHolds.map((hold) => hold.reason)).toEqual([
      "user_pause",
      "budget",
      "ccr",
      "governor",
    ]);
    expect(repo.isTaskHeld("T07")).toBe(true);
    expect(readRuntime(db, "T07")).toEqual(before);

    db.exec("BEGIN IMMEDIATE");
    const refused = db.prepare(queryText(queries, "claim_task")).all({
      task: "T07",
      attempt: "A-T07-1",
      expires_at: 5000,
      rev: 4,
      expected_brief: 1,
    });
    db.exec("ROLLBACK");
    expect(refused).toEqual([]);

    for (const reason of ["budget", "ccr", "governor"] as const) {
      const source = reason === "budget" ? "grant-1" : reason === "ccr" ? "CCR-4" : "yellow";
      repo.releaseHold({ task: "T07", reason, source, now: 21, rev: 4 });
    }
    expect(repo.isTaskHeld("T07")).toBe(true);

    const cleared = repo.releaseHold({
      task: "T07",
      reason: "user_pause",
      source: "msg-1",
      now: 22,
      rev: 5,
    });
    expect(cleared.removed).toBe(true);
    expect(cleared.remainingHolds).toEqual([]);
    expect(repo.isTaskHeld("T07")).toBe(false);
    expect(readRuntime(db, "T07")).toEqual(before);

    db.exec("BEGIN IMMEDIATE");
    const claimed = db.prepare(queryText(queries, "claim_task")).all({
      task: "T07",
      attempt: "A-T07-1",
      expires_at: 5000,
      rev: 6,
      expected_brief: 1,
    }) as Array<{ epoch: number }>;
    expect(claimed).toHaveLength(1);
    db.prepare(queryText(queries, "create_attempt")).run({
      attempt: "A-T07-1",
      task: "T07",
      epoch: claimed[0]?.epoch,
      expected_brief: 1,
      runtime: "own",
      model: "m",
      connection: "c",
      base_commit: "abc",
      now: 30,
    });
    db.exec("COMMIT");
    expect(readRuntime(db, "T07").state).toBe("LEASED");
  });

  it("emits TaskUnheld only when the last hold is released and registers deliveries", () => {
    const { db, repo } = setup();
    repo.placeHold({ task: "T07", reason: "user_pause", source: "msg-1", now: 1, rev: 2 });
    repo.placeHold({ task: "T07", reason: "requirement_change", source: "CS-88", now: 2, rev: 2 });
    repo.releaseHold({ task: "T07", reason: "requirement_change", source: "CS-88", now: 3, rev: 3 });

    const beforeLast = db.prepare("SELECT type FROM outbox ORDER BY seq").all() as Array<{ type: string }>;
    expect(beforeLast.map((row) => row.type)).toEqual([
      "TaskHoldPlaced",
      "TaskHoldPlaced",
      "TaskHoldReleased",
    ]);

    repo.releaseHold({ task: "T07", reason: "user_pause", source: "msg-1", now: 4, rev: 4 });
    const types = (db.prepare("SELECT type FROM outbox ORDER BY seq").all() as Array<{ type: string }>).map(
      (row) => row.type,
    );
    expect(types).toEqual([
      "TaskHoldPlaced",
      "TaskHoldPlaced",
      "TaskHoldReleased",
      "TaskHoldReleased",
      "TaskUnheld",
    ]);
    const deliveries = db.prepare("SELECT count(*) AS n FROM outbox_deliveries").get() as { n: number };
    expect(Number(deliveries.n)).toBe(types.length * 3);
    const consumers = db
      .prepare("SELECT DISTINCT consumer FROM outbox_deliveries ORDER BY consumer")
      .all() as Array<{ consumer: string }>;
    expect(consumers.map((row) => row.consumer)).toEqual(["exporter", "scheduler", "ui_projection"]);
  });

  it("treats a duplicate place and a missing release as idempotent", () => {
    const { db, repo } = setup();
    const first = repo.placeHold({ task: "T07", reason: "user_pause", source: "msg-1", now: 5, rev: 2 });
    const second = repo.placeHold({ task: "T07", reason: "user_pause", source: "msg-1", now: 9, rev: 3 });
    expect(second.placed).toBe(false);
    expect(second.hold.createdAt).toBe(first.hold.createdAt);
    expect(countRows(db, "task_holds")).toBe(1);
    expect(countRows(db, "outbox")).toBe(1);

    const missing = repo.releaseHold({
      task: "T07",
      reason: "requirement_change",
      source: "CS-88",
      now: 10,
      rev: 4,
    });
    expect(missing).toMatchObject({ removed: false, taskState: "READY" });
    expect(missing.remainingHolds).toEqual([first.hold]);
    expect(countRows(db, "outbox")).toBe(1);
    expect(repo.isTaskHeld("T07")).toBe(true);
  });

  it("does not change CODING or PARKED when a hold is placed", () => {
    const { db, repo } = setup();
    setRuntime(db, "T07", { state: "CODING", epoch: 4, leaseExpiresAt: 80, submissionPending: 0 });
    const coding = readRuntime(db, "T07");
    const placed = repo.placeHold({ task: "T07", reason: "governor", source: "orange", now: 8, rev: 5 });
    expect(placed.taskState).toBe("CODING");
    expect(readRuntime(db, "T07")).toEqual(coding);

    setRuntime(db, "T07", { state: "PARKED", epoch: 4, leaseExpiresAt: null });
    db.prepare("DELETE FROM task_holds").run();
    const parked = readRuntime(db, "T07");
    repo.placeHold({ task: "T07", reason: "user_pause", source: "msg-9", now: 9, rev: 6 });
    expect(readRuntime(db, "T07")).toEqual(parked);
  });

  it("parks an active attempt without dropping holds and resumes only when holds and policy allow", () => {
    const { db, repo } = setup();
    setRuntime(db, "T07", { state: "CODING", epoch: 3, leaseExpiresAt: 40 });
    repo.placeHold({ task: "T07", reason: "user_pause", source: "msg-1", now: 1, rev: 2 });
    const parked = repo.parkTask({
      task: "T07",
      epoch: 3,
      rev: 7,
      now: 50,
      checkpoint: {
        step: 4,
        wipRef: "refs/harness/checkpoints/A-T07-1/4",
        sessionRef: "session-7",
        handoffNote: "stopped at the print loop",
      },
    });
    expect(parked.state).toBe("PARKED");
    expect(parked.holderAttempt).toBeNull();
    expect(repo.isTaskHeld("T07")).toBe(true);
    expect(repo.listActiveHolds("T07")).toHaveLength(1);
    const checkpoint = db
      .prepare("SELECT wip_ref, step, session_ref, handoff_artifact FROM attempt_checkpoints")
      .get() as { wip_ref: string; step: number; session_ref: string; handoff_artifact: string };
    expect(checkpoint).toEqual({
      wip_ref: "refs/harness/checkpoints/A-T07-1/4",
      step: 4,
      session_ref: "session-7",
      handoff_artifact: "stopped at the print loop",
    });
    const attempt = db.prepare("SELECT state, outcome FROM attempts WHERE id = 'A-T07-1'").get() as {
      state: string;
      outcome: string;
    };
    expect(attempt).toEqual({ state: "parked", outcome: "PARKED" });

    expect(() =>
      repo.resumeParkedTask({ task: "T07", epoch: 3, rev: 8, now: 60, trigger: "user" }),
    ).toThrow(TaskHeldError);
    expect(readRuntime(db, "T07").state).toBe("PARKED");

    repo.releaseHold({ task: "T07", reason: "user_pause", source: "msg-1", now: 61, rev: 8 });
    const resumed = repo.resumeParkedTask({
      task: "T07",
      epoch: 3,
      rev: 9,
      now: 62,
      trigger: "resumption_policy",
    });
    expect(resumed).toMatchObject({ fromState: "PARKED", state: "READY", holderAttempt: null, submissionPending: 0 });
    expect(repo.isTaskHeld("T07")).toBe(false);
  });

  it("matches the closed hold reasons recorded on task_holds", () => {
    const sql = readFileSync(canonicalStateSqlPath(), "utf8");
    const line = sql.split(/\r?\n/).find((entry) => entry.includes("user_pause | requirement_change"));
    expect(line).toBeDefined();
    const reasons = (line ?? "").split("--")[1]?.split("|").map((part) => part.trim()) ?? [];
    expect(reasons).toEqual([...HOLD_REASONS]);
  });
});
