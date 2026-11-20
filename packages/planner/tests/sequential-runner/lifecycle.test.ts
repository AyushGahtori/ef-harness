import { afterEach, describe, expect, it } from "vitest";
import {
  PostMergeSmokeChecker,
  SMOKE_TIMEOUT_MS,
  SequentialBuildRunner,
  type WaveAdvancementPort,
  type WaveCompileResult,
} from "../../src/sequential-runner/index.js";
import { feature, lab, task, writingWorker, type Lab } from "./helpers.js";

describe("sequential-runner lifecycle", { timeout: 60_000, hookTimeout: 30_000 }, () => {
  const envs: Lab[] = [];

  afterEach(() => {
    for (const env of envs.splice(0)) env.cleanup();
  });

  it(
    "runs phase 0, an explicit-first wave, leaves-merged, then wave 2",
    async () => {
      const env = open();
      env.db.ensureProject({ wave: 0, gate0: "PENDING" });
      feature(env, "phase0", 0);
      feature(env, "menu", 1);
      feature(env, "order", 1);
      task(env, { id: "P0", feature: "phase0", title: "Scaffold", basis: "explicit", phase: "phase0" });
      task(env, { id: "T-menu", feature: "menu", title: "Menu list", basis: "explicit", criticalPath: true, tags: ["ui"] });
      task(env, { id: "T-print", feature: "menu", title: "Menu print", basis: "defaulted", dependsOn: ["T-menu"], tags: ["ui"] });
      task(env, { id: "T-order", feature: "order", title: "Place order", basis: "explicit", tags: ["api"] });

      const wave: WaveAdvancementPort = {
        compile({ completedWave }): WaveCompileResult {
          if (completedWave === 1) {
            return {
              status: "compiled",
              features: [{ id: "pay", title: "Pay", wave: 2, branch: "harness/f/pay" }],
              tasks: [
                { id: "T-pay", feature: "pay", title: "Charge", basis: "explicit", criticalPath: true, snapshotId: "snap-T-pay", tags: ["api"] },
                {
                  id: "T-receipt",
                  feature: "pay",
                  title: "Receipt",
                  basis: "defaulted",
                  dependsOn: ["T-pay"],
                  snapshotId: "snap-T-receipt",
                  tags: ["api"],
                },
              ],
            };
          }
          return { status: "final_wave" };
        },
      };
      const runner = new SequentialBuildRunner({ db: env.db, git: env.git, worker: writingWorker(), wave });
      const report = await runner.run();

      expect(report.claimed).toEqual(["P0", "T-menu", "T-order", "T-print", "T-pay", "T-receipt"]);
      expect(report.merged).toEqual(["P0", "T-menu", "T-order", "T-print", "T-pay", "T-receipt"]);
      expect(report.leavesMerged).toEqual(["phase0", "order", "menu", "pay"]);
      expect(report.featureDone).toEqual(["phase0", "order", "menu", "pay"]);
      expect(report.jitWaves).toContain(1);
      expect(report.completionLaunched).toBe(true);
      expect(report.status).toBe("completion_wave_launched");
      expect(env.db.gate0()).toBe("PASSED");
      for (const id of ["phase0", "menu", "order", "pay"]) {
        const row = env.db.raw.prepare("SELECT state FROM feature_runtime WHERE feature = ?").get(id) as { state: string };
        expect(row.state).toBe("DONE");
      }
      const checkpoints = env.db.raw.prepare("SELECT contract_versions, handoff_artifact FROM attempt_checkpoints").all() as Array<{
        contract_versions: string;
        handoff_artifact: string;
      }>;
      expect(checkpoints.length).toBe(6);
      for (const checkpoint of checkpoints) {
        const manifest = JSON.parse(checkpoint.contract_versions) as { sliceSha256: string; tools: string[] };
        expect(manifest.sliceSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(manifest.tools).toEqual(["kb.get_fact", "kb.contract", "kb.code", "harness.run"]);
        expect(checkpoint.handoff_artifact).toContain("harness.run");
      }
      for (const id of report.merged) {
        const receipt = env.db.receiptsFor(id).at(-1);
        expect(receipt?.claimedAt).toBeGreaterThan(0);
        expect(receipt?.briefTokens).toBeGreaterThan(0);
        expect(receipt?.workerTurns).toBe(2);
        expect(receipt?.costMicroUsd).toBe(1_500);
        expect(receipt?.verifierVerdict).toBe("pass");
        expect(receipt?.mergedCommitSha).toMatch(/^[0-9a-f]{40}$/);
        expect(receipt?.smokeMs).toBeGreaterThanOrEqual(0);
        expect(receipt?.staticAudit).toBe("pass");
      }
      expect(env.git.logSubjects("harness/f/menu")).toContain("land A-T-menu-1");
      expect(env.git.logSubjects("harness/integration").some((line) => line.includes("integrate harness/f/menu"))).toBe(true);
      expect(env.git.porcelain()).toBe("");
    },
    120_000,
  );

  it("bounds post-merge smoke at 30 seconds", async () => {
    expect(SMOKE_TIMEOUT_MS).toBe(30_000);
    let seen = 0;
    const checker = new PostMergeSmokeChecker([
      {
        run(_cwd, timeoutMs) {
          seen = timeoutMs;
          return { ok: true, error: "" };
        },
      },
    ]);
    const result = await checker.run(process.cwd());
    expect(seen).toBe(30_000);
    expect(result.ok).toBe(true);
    const started = Date.now();
    const slow = await new PostMergeSmokeChecker([
      {
        run(_cwd, timeoutMs) {
          return new Promise((resolve) => {
            setTimeout(() => resolve({ ok: false, error: "smoke timeout" }), timeoutMs + 50);
          });
        },
      },
    ]).run(process.cwd(), 40);
    expect(slow.ok).toBe(false);
    expect(slow.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  function open(): Lab {
    const env = lab();
    envs.push(env);
    return env;
  }
});
