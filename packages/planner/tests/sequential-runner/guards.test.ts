import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  KernelEventBus,
  LocalCleanVerifier,
  LocalStaticAudit,
  SequentialBuildRunner,
  type WaveCompileResult,
} from "../../src/sequential-runner/index.js";
import { feature, lab, task, writingWorker, type Lab } from "./helpers.js";

describe("sequential-runner scope, circuit breaker, and wave halt", { timeout: 60_000, hookTimeout: 30_000 }, () => {
  const envs: Lab[] = [];

  afterEach(() => {
    for (const env of envs.splice(0)) env.cleanup();
  });

  it("rejects a sql migration written by a ui-only task before verification", async () => {
    const env = open();
    env.db.ensureProject({ wave: 0, gate0: "PASSED" });
    const branch = feature(env, "scope", 1);
    task(env, { id: "T-4", feature: "scope", title: "UI only", basis: "explicit", tags: ["ui"] });
    const original = env.git.head(branch);
    let verifierCalls = 0;
    let auditCalls = 0;
    const runner = new SequentialBuildRunner({
      db: env.db,
      git: env.git,
      worker: writingWorker((context) => {
        const file = path.join(context.worktree, "migrations", "001.sql");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "CREATE TABLE menu(id INTEGER);\n", "utf8");
        return null;
      }),
      verifier: {
        verify() {
          verifierCalls += 1;
          return { verdict: "pass", errors: [] };
        },
      },
      audit: {
        audit() {
          auditCalls += 1;
          return { pass: true, fingerprint: "", findings: [] };
        },
      },
    });
    const report = await runner.run();
    expect(verifierCalls).toBe(0);
    expect(auditCalls).toBe(0);
    expect(env.git.head(branch)).toBe(original);
    expect(env.db.taskState("T-4")).toBe("ESCALATED");
    expect(env.db.ladderStep("T-4")).toBe(0);
    expect(env.db.candidateCount("T-4")).toBe(0);
    expect(report.events.some((event) => event.phase === "WRITE_SCOPE_REJECTED")).toBe(true);
  });

  it("pauses on two provider 503s without burning code-fix retries", async () => {
    const env = open();
    env.db.ensureProject({ wave: 0, gate0: "PASSED" });
    feature(env, "net", 1);
    task(env, { id: "T-5", feature: "net", title: "Network", basis: "explicit" });
    task(env, { id: "T-next", feature: "net", title: "Should not start", basis: "explicit" });
    const runner = new SequentialBuildRunner({
      db: env.db,
      git: env.git,
      worker: {
        async run() {
          return {
            ok: false,
            turns: 1,
            costMicroUsd: 10,
            errorClass: "infrastructure",
            errorCode: "503",
            message: "503 Service Unavailable",
          };
        },
      },
    });
    const report = await runner.run();
    expect(report.status).toBe("paused_infrastructure");
    expect(report.card?.message).toBe("Provider temporarily unavailable");
    expect(report.claimed.filter((id) => id === "T-5")).toHaveLength(2);
    expect(report.merged).toEqual([]);
    expect(report.claimed).not.toContain("T-next");
    expect(env.db.ladderStep("T-5")).toBe(0);
    expect(env.db.taskState("T-5")).toBe("READY");
  });

  it("escalates a DisputeTest without climbing the hint ladder", async () => {
    const env = open();
    env.db.ensureProject({ wave: 0, gate0: "PASSED" });
    feature(env, "dispute", 1);
    task(env, { id: "T-dispute", feature: "dispute", title: "Dispute", basis: "explicit" });
    const runner = new SequentialBuildRunner({
      db: env.db,
      git: env.git,
      worker: writingWorker(() => "export const value = 'DISPUTE_TEST';\n"),
      verifier: new LocalCleanVerifier(),
    });
    await runner.run();
    expect(env.db.taskState("T-dispute")).toBe("ESCALATED");
    expect(env.db.ladderStep("T-dispute")).toBe(0);
  });

  it("escalates three identical static findings without touching the hidden ladder", async () => {
    const env = open();
    env.db.ensureProject({ wave: 0, gate0: "PASSED" });
    feature(env, "audit", 1);
    task(env, { id: "T-audit", feature: "audit", title: "Audit", basis: "explicit" });
    let verifierCalls = 0;
    const runner = new SequentialBuildRunner({
      db: env.db,
      git: env.git,
      worker: writingWorker(() => "export const broken = 'STATIC_AUDIT_FAIL';\n"),
      audit: new LocalStaticAudit(),
      verifier: {
        verify() {
          verifierCalls += 1;
          return { verdict: "pass", errors: [] };
        },
      },
    });
    await runner.run();
    expect(verifierCalls).toBe(0);
    expect(env.db.taskState("T-audit")).toBe("ESCALATED");
    expect(env.db.ladderStep("T-audit")).toBe(0);
    expect(env.db.staticFailures("T-audit")).toBe(3);
  });

  it("jumps the hint ladder to step 3 when the same verification failure repeats", async () => {
    const env = open();
    env.db.ensureProject({ wave: 0, gate0: "PASSED" });
    feature(env, "hint", 1);
    task(env, { id: "T-hint", feature: "hint", title: "Hint", basis: "explicit" });
    const runner = new SequentialBuildRunner({
      db: env.db,
      git: env.git,
      worker: writingWorker(() => "export const broken = 'VERIFIER_FAIL';\n"),
      verifier: new LocalCleanVerifier(),
    });
    await runner.run();
    expect(env.db.taskState("T-hint")).toBe("ESCALATED");
    expect(env.db.ladderStep("T-hint")).toBe(3);
    const second = env.db.checkpointJson("A-T-hint-2");
    expect(second).toContain("Hint 1:");
    expect(second).toContain("verification failed");
  });

  it("suspends at the next checkpoint on budget wind-down and does not start the next task", async () => {
    const env = open();
    env.db.ensureProject({ wave: 0, gate0: "PASSED" });
    const branch = feature(env, "budget", 1);
    task(env, { id: "T-budget", feature: "budget", title: "Budget", basis: "explicit" });
    task(env, { id: "T-later", feature: "budget", title: "Later", basis: "explicit" });
    const original = env.git.head(branch);
    const bus = new KernelEventBus();
    const runner = new SequentialBuildRunner({
      db: env.db,
      git: env.git,
      bus,
      worker: {
        async run(context) {
          bus.publish({ type: "budget_wind_down" });
          const decision = await context.checkpoint(1);
          if (decision !== "suspend") throw new Error(`expected suspend, got ${decision}`);
          const file = path.join(context.worktree, "src", "dirty.ts");
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, "export const dirty = 1;\n", "utf8");
          return { ok: false, turns: 1, costMicroUsd: 5, errorClass: "suspended", message: "budget" };
        },
      },
    });
    const report = await runner.run();
    expect(report.status).toBe("paused_budget");
    expect(report.claimed).toEqual(["T-budget"]);
    expect(env.git.head(branch)).toBe(original);
    expect(env.db.taskState("T-budget")).toBe("CODING");
    expect(env.db.taskState("T-later")).toBe("READY");
    expect(env.git.porcelain()).toBe("");
  });

  it("halts wave 2 when just-in-time compilation reports an architecture mismatch", async () => {
    const env = open();
    env.db.ensureProject({ wave: 1, gate0: "PASSED" });
    feature(env, "done", 1);
    task(env, { id: "T-done", feature: "done", title: "Finish wave", basis: "explicit" });
    const repairs: string[] = [];
    const runner = new SequentialBuildRunner({
      db: env.db,
      git: env.git,
      worker: writingWorker(),
      wave: {
        compile(): WaveCompileResult {
          return { status: "architecture_mismatch", message: "payment service was removed from the architecture" };
        },
      },
      repair: {
        repair(input) {
          repairs.push(`${input.wave}:${input.message}`);
          return { invoked: true, bounded: true };
        },
      },
    });
    const report = await runner.run();
    expect(report.status).toBe("wave_transition_halted");
    expect(report.repairInvoked).toBe(true);
    expect(repairs).toEqual(["2:payment service was removed from the architecture"]);
    expect(report.merged).toEqual(["T-done"]);
    const tasks = env.db.raw.prepare("SELECT task FROM task_runtime").all() as Array<{ task: string }>;
    expect(tasks.map((row) => row.task)).toEqual(["T-done"]);
  });

  function open(): Lab {
    const env = lab();
    envs.push(env);
    return env;
  }
});
