import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isHoldReason, bindTaskHolds } from "../../src/holds/index.js";
import { bindTaskLeases, pathLeaseModeForDatabase } from "../../src/leases/index.js";
import { IllegalFeatureTransitionError, bindLifecycles } from "../../src/lifecycles/index.js";
import { openProjectStateDb } from "../../src/state-db/index.js";

const closers: Array<() => void> = [];
const dirs: string[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
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

describe("ProjectStateDb claiming, holds, and lifecycles", () => {
  it("shares one writer for sweep leases, independent holds, and DONE scope checks", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c08-state-"));
    dirs.push(rootDir);
    const stateDb = openProjectStateDb({ projectId: "C08State", rootDir });
    closers.unshift(() => {
      if (!stateDb.isClosed()) stateDb.close();
    });

    stateDb.writer.run(
      "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES ('CS-1', 1, 'kernel', 'tester', 0)",
    );
    stateDb.writer.run(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES ('F1', 'feature', 1, 'h-F1', 'Feature', '', '{"feature":"F1"}', 'CS-1', 1, 1)`,
    );
    stateDb.writer.run(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES ('T07', 'task', 1, 'h-T07', 'Task', '', '{"feature":"F1"}', 'CS-1', 1, 1)`,
    );
    stateDb.writer.run(
      `INSERT INTO task_runtime(task, feature, state, level, epoch, updated_rev)
       VALUES ('T07', 'F1', 'READY', 'Mid', 0, 1)`,
    );

    const leases = bindTaskLeases(stateDb);
    const holds = bindTaskHolds(stateDb);
    const lifecycles = bindLifecycles(stateDb);

    expect(pathLeaseModeForDatabase("intent")).toBe("intent");
    expect(pathLeaseModeForDatabase("exclusive")).toBe("granted");
    expect(pathLeaseModeForDatabase("granted")).toBe("granted");
    expect(pathLeaseModeForDatabase("write")).toBeNull();
    expect(isHoldReason("user_pause")).toBe(true);
    expect(isHoldReason("requirement_change")).toBe(true);
    expect(isHoldReason("budget")).toBe(true);
    expect(isHoldReason("ccr")).toBe(true);
    expect(isHoldReason("governor")).toBe(true);
    expect(isHoldReason("revision_in_flight")).toBe(false);
    expect(isHoldReason("user_paused")).toBe(false);
    expect(isHoldReason("waiting_on_human_step")).toBe(false);

    expect(leases.registerTaskScopes("T07", ["src/app/kitchen/**"])).toEqual(["src/app/kitchen/"]);
    expect(
      leases.openSweepIntent({
        leaseId: "L-app",
        sweepTask: "S-app",
        globs: ["src/app/**"],
        now: 10,
      }),
    ).toEqual({ leaseId: "L-app", mode: "intent", prefixes: ["src/app/"] });
    expect(textCell(stateDb.writer.get("SELECT mode FROM path_leases WHERE id = 'L-app'"), "mode")).toBe("intent");
    expect(
      leases.claimTask({
        task: "T07",
        attemptId: "A-T07",
        expectedBrief: 1,
        expiresAt: 1_060_000,
        rev: 2,
        runtime: "own",
        model: "m",
        connection: "c",
        baseCommit: "abc",
        now: 1_000_000,
      }),
    ).toEqual({ claimed: false, reason: "sweep_overlap" });
    expect(leases.grantSweepLease("L-app")).toEqual({ granted: true, mode: "granted", blockedBy: null });
    expect(textCell(stateDb.writer.get("SELECT mode FROM path_leases WHERE id = 'L-app'"), "mode")).toBe("granted");
    expect(
      stateDb.writer.get("SELECT count(*) AS n FROM path_leases WHERE mode NOT IN ('intent', 'granted')"),
    ).toEqual({ n: 0 });

    holds.placeHold({ task: "T07", reason: "user_pause", source: "msg-1", now: 1, rev: 2 });
    holds.placeHold({ task: "T07", reason: "requirement_change", source: "CS-88", now: 2, rev: 2 });
    const released = holds.releaseHold({
      task: "T07",
      reason: "requirement_change",
      source: "CS-88",
      now: 3,
      rev: 3,
    });
    expect(released.remainingHolds.map((hold) => hold.reason)).toEqual(["user_pause"]);
    expect(holds.listActiveHolds("T07").map((hold) => [hold.reason, hold.source])).toEqual([["user_pause", "msg-1"]]);

    lifecycles.initFeature({ feature: "F1", planAuthor: "planner", rev: 4, now: 4 });
    lifecycles.transitionFeatureState({
      feature: "F1",
      to: "BLOCKED",
      expectedEpoch: 0,
      rev: 5,
      now: 5,
    });
    expect(() =>
      lifecycles.transitionFeatureState({
        feature: "F1",
        to: "JIT_READY",
        expectedEpoch: 0,
        rev: 6,
        now: 6,
      }),
    ).toThrow(IllegalFeatureTransitionError);
    expect(
      lifecycles.transitionFeatureState({
        feature: "F1",
        to: "PLANNED",
        expectedEpoch: 0,
        rev: 6,
        now: 6,
      }),
    ).toMatchObject({ from: "BLOCKED", to: "PLANNED" });

    const evidence = {
      feature: "F1",
      staticAudit: {
        clean: true,
        integratorCommitsIncluded: true,
        paths: ["src/app/kitchen/page.ts"],
      },
      journey: { passed: true, entryPoint: "/app", cleanEnvironment: true },
      integrationMerge: {
        ref: "refs/heads/harness/integration",
        mergeCommit: "abc123",
        earlierDoneRegressionGreen: true,
        regressedFeatureIds: [],
      },
      accessibility: { seriousFindingIds: [] },
    };
    expect(lifecycles.verifyFeatureDoneConditions(evidence).failedConditions).toContain("3");
    expect(
      lifecycles.verifyFeatureDoneConditions({
        ...evidence,
        staticAudit: { ...evidence.staticAudit, paths: ["src/app/"] },
      }).failedConditions,
    ).not.toContain("3");
  });
});
