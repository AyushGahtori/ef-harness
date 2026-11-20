import { afterEach, describe, expect, it } from "vitest";
import { CompiledPlanMissingError, ExplicitFirstReadyQueue } from "../../src/sequential-runner/index.js";
import { feature, lab, task, type Lab } from "./helpers.js";

describe("sequential-runner explicit-first queue", { timeout: 30_000, hookTimeout: 30_000 }, () => {
  const envs: Lab[] = [];

  afterEach(() => {
    for (const env of envs.splice(0)) env.cleanup();
  });

  it("orders explicit work ahead of delegated and defaulted work at the same depth, blockers first", () => {
    const env = open();
    env.db.ensureProject({ wave: 1, gate0: "PASSED" });
    feature(env, "wave", 1);
    task(env, { id: "M", feature: "wave", title: "Merged dependency", basis: "explicit", state: "MERGED_TO_FEATURE" });
    task(env, { id: "D-def", feature: "wave", title: "Defaulted leaf", basis: "defaulted" });
    task(env, { id: "G-del", feature: "wave", title: "Delegated leaf", basis: "delegated" });
    task(env, { id: "E-leaf", feature: "wave", title: "Explicit leaf", basis: "explicit" });
    task(env, { id: "E-crit", feature: "wave", title: "Explicit blocker", basis: "explicit", criticalPath: true });
    task(env, { id: "Dep-wait", feature: "wave", title: "Waiting on blocker", basis: "defaulted", dependsOn: ["E-crit"] });
    task(env, { id: "Deep", feature: "wave", title: "Deeper explicit", basis: "explicit", dependsOn: ["M"] });
    task(env, { id: "Held", feature: "wave", title: "Held explicit", basis: "explicit" });
    env.db.addHold("Held", "user_pause", "owner", 1);
    task(env, { id: "Uncompiled", feature: "wave", title: "Missing snapshot", basis: "explicit", snapshotId: null });

    const ids = new ExplicitFirstReadyQueue(env.db).list().map((item) => item.id);
    expect(ids).toEqual(["E-crit", "E-leaf", "G-del", "D-def", "Deep"]);
    expect(ids).not.toContain("Dep-wait");
    expect(ids).not.toContain("Held");
    expect(ids).not.toContain("Uncompiled");
    expect(ids).not.toContain("M");
  }, 20_000);

  it("keeps wave tasks out until gate0 passes, and still offers phase 0", () => {
    const env = open();
    env.db.ensureProject({ wave: 0, gate0: "PENDING" });
    feature(env, "phase0", 0);
    feature(env, "menu", 1);
    task(env, { id: "P0", feature: "phase0", title: "Scaffold", basis: "explicit", phase: "phase0" });
    task(env, { id: "T-menu", feature: "menu", title: "Menu", basis: "explicit" });
    const ids = new ExplicitFirstReadyQueue(env.db).list().map((item) => item.id);
    expect(ids).toEqual(["P0"]);
  });

  it("refuses to claim a task that has no compiled plan snapshot", () => {
    const env = open();
    env.db.ensureProject({ wave: 1, gate0: "PASSED" });
    feature(env, "wave", 1);
    task(env, { id: "Bare", feature: "wave", title: "Bare", basis: "explicit", snapshotId: null });
    expect(() =>
      env.db.claim({
        taskId: "Bare",
        expectedBrief: 1,
        baseCommit: env.git.head("harness/integration"),
        now: 1,
        amount: 1,
        leaseMs: 1_000,
      }),
    ).toThrow(CompiledPlanMissingError);
  });

  it("does not claim a held task", () => {
    const env = open();
    env.db.ensureProject({ wave: 1, gate0: "PASSED" });
    feature(env, "wave", 1);
    task(env, { id: "Held", feature: "wave", title: "Held", basis: "explicit" });
    env.db.addHold("Held", "user_pause", "owner", 1);
    const claimed = env.db.claim({
      taskId: "Held",
      expectedBrief: 1,
      baseCommit: env.git.head("harness/f/wave"),
      now: 1,
      amount: 1,
      leaseMs: 1_000,
    });
    expect(claimed).toBeNull();
  });

  function open(): Lab {
    const env = lab();
    envs.push(env);
    return env;
  }
});
