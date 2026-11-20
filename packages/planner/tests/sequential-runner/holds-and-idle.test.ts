import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  KernelEventBus,
  SequentialBuildRunner,
  type CleanVerifierHarnessPort,
} from "../../src/sequential-runner/index.js";
import { deferred, feature, lab, task, writingWorker, type Lab } from "./helpers.js";

describe("sequential-runner smoke, holds, stop, and idle", { timeout: 60_000, hookTimeout: 30_000 }, () => {
  const envs: Lab[] = [];

  afterEach(() => {
    for (const env of envs.splice(0)) env.cleanup();
  });

  it("rolls a broken barrel back to the pre-merge sha and opens hint 1", async () => {
    const env = open();
    env.db.ensureProject({ wave: 0, gate0: "PASSED" });
    const branch = feature(env, "barrel", 1);
    task(env, { id: "T-barrel", feature: "barrel", title: "Barrel", basis: "explicit", tags: ["ui"] });
    const original = env.git.head(branch);
    const runner = new SequentialBuildRunner({
      db: env.db,
      git: env.git,
      worker: writingWorker((context) => {
        const file = path.join(context.worktree, "src", "index.ts");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const body = context.hintStep < 1 ? 'export { missing } from "./missing.js";\n' : "export const ready = 1;\n";
        fs.writeFileSync(file, body, "utf8");
        return null;
      }),
    });
    const report = await runner.run();
    const rollback = report.events.find((event) => event.phase === "SMOKE_ROLLBACK");
    expect(rollback?.detail).toContain("TS2307: Cannot find module './missing.js'");
    expect(rollback?.featureSha).toBe(original);
    expect(env.git.head(`${branch}^`)).toBe(original);
    expect(env.git.logSubjects(branch)).not.toContain("land A-T-barrel-1");
    expect(env.git.logSubjects(branch)).toContain("land A-T-barrel-2");
    const second = env.db.checkpointJson("A-T-barrel-2");
    expect(second).toContain("Hint 1:");
    expect(second).toContain("TS2307");
    expect(report.merged).toEqual(["T-barrel"]);
    expect(env.db.ladderStep("T-barrel")).toBe(1);
  }, 30_000);

  it("refuses to merge while a hold is active during verification", async () => {
    const env = open();
    env.db.ensureProject({ wave: 0, gate0: "PASSED" });
    const branch = feature(env, "held", 1);
    task(env, { id: "T-2", feature: "held", title: "Held verify", basis: "explicit" });
    const original = env.git.head(branch);
    const entered = deferred();
    const release = deferred();
    let calls = 0;
    const verifier: CleanVerifierHarnessPort = {
      async verify() {
        calls += 1;
        entered.resolve();
        await release.promise;
        return { verdict: "pass", errors: [] };
      },
    };
    const bus = new KernelEventBus();
    const runner = new SequentialBuildRunner({ db: env.db, git: env.git, worker: writingWorker(), verifier, bus });
    const pending = runner.run();
    await entered.promise;
    env.db.addHold("T-2", "user_pause", "owner", Date.now());
    release.resolve();
    await runner.whenStatus("submission_pending");
    expect(env.git.head(branch)).toBe(original);
    expect(env.db.submissionPending("T-2")).toBe(1);
    expect(env.db.candidateCount("T-2")).toBe(0);
    expect(calls).toBe(1);
    env.db.releaseHold("T-2");
    bus.publish({ type: "task_hold_released", taskId: "T-2" });
    const report = await pending;
    expect(report.merged).toEqual(["T-2"]);
    expect(env.git.head(branch)).not.toBe(original);
    expect(env.db.submissionPending("T-2")).toBe(0);
  }, 30_000);

  it("parks a stopped task, keeps the feature branch clean, and saves a checkpoint", async () => {
    const env = open();
    env.db.ensureProject({ wave: 0, gate0: "PASSED" });
    const branch = feature(env, "stop", 1);
    task(env, { id: "T-6", feature: "stop", title: "Stop me", basis: "explicit" });
    const original = env.git.head(branch);
    const entered = deferred();
    const bus = new KernelEventBus();
    const runner = new SequentialBuildRunner({
      db: env.db,
      git: env.git,
      bus,
      worker: {
        async run(context) {
          const file = path.join(context.worktree, "src", "wip.ts");
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, "export const wip = 1;\n", "utf8");
          entered.resolve();
          await new Promise<void>((resolve) => {
            if (context.signal.aborted) {
              resolve();
              return;
            }
            context.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return { ok: false, turns: 1, costMicroUsd: 20, errorClass: "interrupted", message: "stopped" };
        },
      },
    });
    const pending = runner.run();
    await entered.promise;
    bus.publish({ type: "stop" });
    const report = await pending;
    expect(report.status).toBe("stopped");
    expect(report.merged).toEqual([]);
    expect(env.git.head(branch)).toBe(original);
    expect(env.db.taskState("T-6")).toBe("PARKED");
    const checkpoint = env.db.raw.prepare("SELECT wip_ref FROM attempt_checkpoints").get() as { wip_ref: string | null };
    expect(checkpoint.wip_ref).toContain("refs/harness/checkpoints/");
    expect(env.git.porcelain()).toBe("");
  }, 30_000);

  it("idles with zero polling until a hold is released", async () => {
    const env = open();
    env.db.ensureProject({ wave: 1, gate0: "PASSED" });
    feature(env, "wait", 1);
    task(env, { id: "T-held", feature: "wait", title: "Held", basis: "explicit" });
    task(env, { id: "T-ask", feature: "wait", title: "Ask", basis: "explicit", state: "WAITING_INPUT" });
    env.db.addHold("T-held", "user_pause", "owner", 1);
    const bus = new KernelEventBus();
    const runner = new SequentialBuildRunner({ db: env.db, git: env.git, bus, worker: writingWorker() });
    const pending = runner.run({ blockOnIdle: true, maxTasks: 1 });
    await runner.whenStatus("idle_waiting_on_user");
    expect(runner.pollTicks).toBe(0);
    expect(runner.idleWaits).toBe(1);
    expect(runner.status).toBe("idle_waiting_on_user");
    env.db.releaseHold("T-held");
    bus.publish({ type: "task_hold_released", taskId: "T-held" });
    const report = await pending;
    expect(report.merged).toEqual(["T-held"]);
    expect(env.db.taskState("T-ask")).toBe("WAITING_INPUT");
    expect(runner.pollTicks).toBe(0);
  }, 30_000);

  function open(): Lab {
    const env = lab();
    envs.push(env);
    return env;
  }
});
