import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AttemptCheckpointRepo, openStateConnection } from "@ef-harness/db";
import { ManualClock } from "../../src/resume/clock.js";
import { SqliteAttemptCheckpointStore } from "../../src/resume/checkpoint-store.js";
import { createForeignRuntimeResumeCoordinator } from "../../src/resume/coordinator.js";
import { ScriptedChildProcesses } from "../../src/resume/ports.js";
import { brief, commitFile, initRepo, FakeAdapter } from "./fixture.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.length = 0;
});

describe("foreign checkpoints on schema/state.sql", { timeout: 60_000 }, () => {
  it("keeps native contract_versions siblings and resumes Native from Codex", async () => {
    const created = initRepo();
    cleanups.push(created.cleanup);
    const repo = created.repo;
    const base = commitFile(repo, "keep.ts", "export const header = true\n", "base");
    writeFileSync(path.join(repo, "orders.ts"), "export const orders = 1\n");
    const db = openStateConnection();
    const store = new SqliteAttemptCheckpointStore({ database: db });
    const nativeRepo = new AttemptCheckpointRepo(db);
    const codex = new FakeAdapter("codex", "1.2.3");
    const native = new FakeAdapter("native-worker-loop", "1.0.0");
    const procs = new ScriptedChildProcesses();
    const coordinator = createForeignRuntimeResumeCoordinator({
      adapters: new Map([
        [codex.adapterId, codex],
        [native.adapterId, native],
      ]),
      processes: procs,
      clock: new ManualClock(1_700_000_000_000),
      store,
    });
    const pid = procs.spawn("codex").pid;
    await coordinator.persist({
      attemptId: "attempt-1",
      adapterId: "codex",
      adapterVersion: "1.2.3",
      nativeSessionId: "thread-77",
      pinnedBaseCommitSha: base,
      pinnedSliceSha256: "slice-1",
      repoPath: repo,
      slotId: "slot-1",
      reason: "turn_completed",
      lastStepSummary: "paused after the last turn",
      briefText: "Use REST for orders",
      requirements: ["orders endpoint"],
      childPid: pid,
      residentRamMb: 280,
      contextUtilization: 0.2,
    });
    const seeded = db
      .prepare("SELECT contract_versions FROM attempt_checkpoints WHERE attempt = :attempt")
      .get({ attempt: "attempt-1" });
    if (!seeded || typeof seeded.contract_versions !== "string") throw new Error("missing checkpoint");
    const withSiblings = {
      ...(JSON.parse(seeded.contract_versions) as Record<string, unknown>),
      prompt: 2,
      skill: 4,
    };
    db.prepare("UPDATE attempt_checkpoints SET contract_versions = :json WHERE attempt = :attempt").run({
      attempt: "attempt-1",
      json: JSON.stringify(withSiblings),
    });
    expect(() => nativeRepo.read("attempt-1")).toThrow(/integer/);
    await coordinator.persist({
      attemptId: "attempt-1",
      adapterId: "codex",
      adapterVersion: "1.2.3",
      nativeSessionId: "thread-77",
      pinnedBaseCommitSha: base,
      pinnedSliceSha256: "slice-1",
      repoPath: repo,
      slotId: "slot-1",
      reason: "turn_completed",
      lastStepSummary: "kept the native keys",
      briefText: "Use REST for orders",
      requirements: ["orders endpoint"],
      childPid: pid,
      residentRamMb: 280,
    });
    const merged = db
      .prepare("SELECT contract_versions FROM attempt_checkpoints WHERE attempt = :attempt")
      .get({ attempt: "attempt-1" });
    if (!merged || typeof merged.contract_versions !== "string") throw new Error("missing merged checkpoint");
    const parsed = JSON.parse(merged.contract_versions) as {
      prompt: number;
      skill: number;
      foreignRuntimeCheckpoint: { lastStepSummary: string };
    };
    expect(parsed.prompt).toBe(2);
    expect(parsed.skill).toBe(4);
    expect(parsed.foreignRuntimeCheckpoint.lastStepSummary).toBe("kept the native keys");
    const attempt = db.prepare("SELECT task, state FROM attempts WHERE id = :id").get({ id: "attempt-1" });
    expect(attempt).toMatchObject({ task: "attempt-1", state: "parked" });
    const columns = db.prepare("SELECT name FROM pragma_table_info('attempts')").all();
    expect(columns.map((column) => column.name)).toContain("task");

    const resumed = await coordinator.resume({
      attemptId: "attempt-1",
      slotPath: path.join(repo, "..", "slot-native"),
      brief: brief({
        text: "Use REST for orders",
        sliceSha256: "slice-1",
        requirements: ["orders endpoint"],
        changeKind: "none",
      }),
    });
    expect(resumed.strategy).toBe("native_resume");
    expect(resumed.adapterId).toBe("codex");
    mkdirSync(path.join(repo, "..", "slot-switch"), { recursive: true });
    const switched = await coordinator.switchConnection(
      "attempt-1",
      "native-worker-loop",
      brief({
        text: "Use REST for orders",
        sliceSha256: "slice-1",
        requirements: ["orders endpoint"],
      }),
      path.join(repo, "..", "slot-switch"),
    );
    expect(switched.strategy).toBe("fresh_session");
    expect(switched.adapterId).toBe("native-worker-loop");
    db.close();
  });
});
