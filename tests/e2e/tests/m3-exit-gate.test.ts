import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { loadM3Fixtures } from "../m3-exit-gate/fixtures.ts";
import {
  KitchenHiddenAcceptanceSuite,
  M2KitchenE2eBenchmarkRunner,
  buildWorkerPrompts,
  kitchenFromLanded,
  plantNeedle,
  promptsLeakHidden,
  scanTreeForSecrets,
} from "../m3-exit-gate/kitchen.ts";
import { MergeBatchBisector, ProjectMergeQueue } from "../m3-exit-gate/merge-queue.ts";
import { evaluateM3ExitGate, renderScorecard, signReport, signingView } from "../m3-exit-gate/report.ts";
import { M3ParallelBenchmarkRunner, runLiveCertification } from "../m3-exit-gate/runner.ts";
import { M3ScaleAndLatencyCertifier } from "../m3-exit-gate/scale.ts";
import { runAdditiveCcr, runFeatureUndo, runGovernorStress, runStopAndResume, runSurgicalHold } from "../m3-exit-gate/scenarios.ts";
import { HeftCriticalPathScheduler, mergesOverlap, speedupAgainst } from "../m3-exit-gate/schedule.ts";
import type { GateInput } from "../m3-exit-gate/report.ts";
import type { QueueFeature } from "../m3-exit-gate/types.ts";

const fixtures = loadM3Fixtures();

function healthyInput(overrides: Partial<GateInput> = {}): GateInput {
  return {
    speedupRatio: 2.8,
    m3PassRate: 1,
    m2PassRate: 1,
    dbWriteP99Ms: 4,
    boardUpdateMs: 1,
    boardPaintP95Ms: 2,
    stopLatencyMs: 1,
    leakedPids: 0,
    secretsFound: 0,
    paperworkPct: 0.18,
    viewsTracked: 0,
    postStopMerges: 0,
    unauthorizedClaims: 0,
    unauthorizedTokens: 0,
    sqliteBusy: 0,
    scenariosPassed: 5,
    scenariosTotal: 5,
    ...overrides,
  };
}

function queueFeature(id: string, slug: string, finishedAtSec: number, regression: boolean): QueueFeature {
  return {
    id,
    slug,
    buildId: `${slug}-build`,
    tasks: `T-${slug}`,
    requirements: `R-${slug}`,
    checks: "H-M2-01",
    finishedAtSec,
    body: `${id} body\n`,
    regression,
  };
}

it("keeps the M2 cassette, hidden canary, and fail-closed gate math", () => {
  const baseline = new M2KitchenE2eBenchmarkRunner(fixtures.baseline).readBaseline();
  expect(baseline.totalWallClockSec).toBe(2820);
  expect(baseline.paperworkPct).toBe(0.18);
  expect(baseline.passRatePct).toBe(100);
  expect(baseline.hiddenTotalCount).toBe(29);
  expect(fixtures.opening.startsWith("Office kitchen meal ordering")).toBe(true);
  const prompts = buildWorkerPrompts(
    fixtures.opening,
    fixtures.graph.tasks.map((task) => task.id),
    fixtures.suite.checks.length,
  );
  expect(promptsLeakHidden(prompts, fixtures.suite)).toBe(false);
  expect(prompts[0]?.includes("checks_hidden_count: 29")).toBe(true);
  expect(evaluateM3ExitGate(healthyInput()).exitCode).toBe(0);
  const dropped = evaluateM3ExitGate(healthyInput({ m2PassRate: 0.96, m3PassRate: 0.88 }));
  expect(dropped.exitCode).toBe(1);
  expect(dropped.reasons).toContain("passRate");
  expect(dropped.passRateDeltaPct).toBeCloseTo(-8, 5);
  expect(evaluateM3ExitGate(healthyInput({ speedupRatio: 1.77 })).reasons).toContain("speedup");
  expect(evaluateM3ExitGate(healthyInput({ paperworkPct: 0.24 })).reasons).toContain("paperworkPct");
  expect(evaluateM3ExitGate(healthyInput({ secretsFound: 1 })).reasons).toContain("secretsFound");
  expect(evaluateM3ExitGate(healthyInput({ viewsTracked: 1 })).reasons).toContain("viewsTracked");
  expect(evaluateM3ExitGate(healthyInput({ sqliteBusy: 2 })).reasons).toContain("sqliteBusy");
  expect(evaluateM3ExitGate(healthyInput({ stopLatencyMs: 100 })).reasons).toContain("stopLatencyMs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-secret-"));
  try {
    plantNeedle(path.join(dir, "leak.txt"));
    expect(scanTreeForSecrets(dir)).toBeGreaterThan(0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("schedules the kitchen graph at least twice as fast as the M2 cassette", () => {
  const scheduled = new HeftCriticalPathScheduler().schedule(fixtures.graph, fixtures.profile);
  expect(scheduled.sequentialSec).toBeCloseTo(2820, 5);
  expect(scheduled.wEff).toBe(4);
  expect(scheduled.preset).toBe("Balanced");
  expect(mergesOverlap(scheduled.assignments, fixtures.graph.tasks)).toBe(false);
  const speedup = speedupAgainst(fixtures.baseline.totalWallClockSec, scheduled.makespanSec);
  expect(speedup).toBeGreaterThanOrEqual(2);
  const serial = new HeftCriticalPathScheduler().scheduleOn(fixtures.graph, 1);
  expect(speedupAgainst(fixtures.baseline.totalWallClockSec, serial.makespanSec)).toBeLessThan(2);
  const jittered = new HeftCriticalPathScheduler().schedule(
    {
      ...fixtures.graph,
      tasks: fixtures.graph.tasks.map((task) =>
        task.id === fixtures.curve.jitterTaskId
          ? { ...task, avgExecSec: task.avgExecSec + fixtures.curve.jitterRetrySec }
          : task,
      ),
    },
    fixtures.profile,
  );
  expect(speedupAgainst(fixtures.baseline.totalWallClockSec, jittered.makespanSec)).toBeGreaterThanOrEqual(2);
});

it("serializes same-second merges and bisects a failing half", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-merge-"));
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), "m3-bisect-"));
  try {
    const queue = new ProjectMergeQueue();
    const landed = queue.land(dir, [
      queueFeature("F-Menu", "menu", 10, false),
      queueFeature("F-Orders", "orders", 10, false),
    ]);
    expect(landed.clean).toBe(true);
    expect(landed.held).toEqual([]);
    expect(landed.sameSecondSerialized).toBe(true);
    expect(landed.commits).toHaveLength(2);
    for (const commit of landed.commits) {
      expect(commit.parents).toBe(2);
      expect(commit.trailers["EF-Feature"]).toBeTruthy();
      expect(commit.trailers["EF-Tasks"]).toBeTruthy();
      expect(commit.trailers["EF-Requirements"]).toBeTruthy();
      expect(commit.trailers["EF-Checks-Passed"]).toBeTruthy();
      expect(commit.trailers["EF-Harness-Version"]).toBe("0.0.0");
      expect(commit.branch.startsWith("harness/f/")).toBe(true);
    }
    const split = new MergeBatchBisector().split(["F-Menu", "F-Orders"]);
    expect(split).toEqual([["F-Menu"], ["F-Orders"]]);
    const bisected = queue.land(bad, [
      queueFeature("F-Menu", "menu", 10, false),
      queueFeature("F-Orders", "orders", 10, true),
    ]);
    expect(bisected.clean).toBe(true);
    expect(bisected.commits.map((commit) => commit.featureId)).toEqual(["F-Menu"]);
    expect(bisected.held).toEqual(["F-Orders"]);
    expect(fs.existsSync(path.join(bad, "src", "menu.txt"))).toBe(true);
    expect(fs.existsSync(path.join(bad, "src", "orders.txt"))).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(bad, { recursive: true, force: true });
  }
});

it("fails closed on a slow task_holds trace, a 22 ms board burst, a leaked pid, and a pre-resume claim", async () => {
  const certifier = new M3ScaleAndLatencyCertifier();
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-db-"));
  try {
    const slow = certifier.certifyInjectedDb(path.join(dbDir, "telemetry.db"));
    expect(slow.pass).toBe(false);
    expect(slow.p99Ms).toBeGreaterThanOrEqual(50);
    expect(slow.detail.join(" ")).toContain("SELECT id FROM task_holds WHERE reason = ?");
    expect(slow.detail.join(" ")).toContain("telemetry.db");
    const board = certifier.certifyInjectedBoard(8, [22]);
    expect(board.initialMs).toBe(8);
    expect(board.boardUpdateMs).toBe(22);
    expect(board.pass).toBe(false);
    expect(board.tasks).toBe(500);
    expect(board.requirements).toBe(5000);
  } finally {
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
  const leaked = await runStopAndResume({ leak: true });
  expect(leaked.leakedPids).toBe(1);
  expect(leaked.result.pass).toBe(false);
  const early = await runStopAndResume({ bypassResume: true });
  expect(early.unauthorizedClaims).toBe(1);
  expect(early.unauthorizedTokens).toBeGreaterThan(0);
  expect(early.result.pass).toBe(false);
  const stripped = new KitchenHiddenAcceptanceSuite(fixtures.suite).run(
    kitchenFromLanded(["F-Menu", "F-Orders", "F-Print", "F-CateringEmail"], "strip-cutoff"),
  );
  const passed = stripped.filter((check) => check.pass).length;
  expect(stripped.find((check) => check.id === "H-M2-05")?.pass).toBe(false);
  expect(stripped.find((check) => check.id === "H-M2-29")?.pass).toBe(false);
  const rateGate = evaluateM3ExitGate(healthyInput({ m3PassRate: passed / stripped.length, m2PassRate: 1 }));
  expect(rateGate.exitCode).toBe(1);
  expect(rateGate.reasons).toContain("passRate");
});

it("passes the five steering, undo, and governor scenarios on their own", async () => {
  expect(runSurgicalHold().pass).toBe(true);
  const stop = await runStopAndResume();
  expect(stop.result.pass).toBe(true);
  expect(stop.stopLatencyMs).toBeLessThan(100);
  expect(stop.leakedPids).toBe(0);
  expect(stop.postStopMerges).toBe(0);
  expect(stop.unauthorizedClaims).toBe(0);
  expect(stop.unauthorizedTokens).toBe(0);
  expect(stop.wipBranch).toBe("wip/menu");
  expect(runFeatureUndo(fixtures.suite).pass).toBe(true);
  expect(runAdditiveCcr().pass).toBe(true);
  expect(runGovernorStress(fixtures.profile).pass).toBe(true);
});

it("certifies the parallel kitchen exit gate in ci-replay", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-report-"));
  try {
    const report = await new M3ParallelBenchmarkRunner().run({ outDir });
    expect(report.gate.exitCode).toBe(0);
    expect(report.gate.reasons).toEqual([]);
    expect(report.speedupRatio).toBeGreaterThanOrEqual(2);
    expect(report.passRateDelta).toBe(0);
    expect(report.m3.passRatePct).toBeGreaterThanOrEqual(90);
    expect(report.m3.passRatePct).toBeGreaterThanOrEqual(report.m2.passRatePct);
    expect(report.m3.hiddenPassCount).toBe(report.m3.hiddenTotalCount);
    expect(report.m3.paperworkPct).toBeLessThanOrEqual(0.2);
    expect(report.dbWriteP99Ms).toBeLessThan(50);
    expect(report.sqliteBusy).toBe(0);
    expect(report.dbWorkers).toBe(50);
    expect(report.dbSamples).toBeGreaterThanOrEqual(50);
    expect(report.scenarioWindowSec).toBe(60);
    expect(report.boardTasks).toBe(500);
    expect(report.boardRequirements).toBe(5000);
    expect(report.boardUpdateMs).toBeLessThan(10);
    expect(report.boardPaintP95Ms).toBeLessThan(50);
    expect(report.stopLatencyMs).toBeLessThan(100);
    expect(report.leakedPids).toBe(0);
    expect(report.secretsFound).toBe(0);
    expect(report.viewsTracked).toBe(0);
    expect(report.postStopMerges).toBe(0);
    expect(report.unauthorizedClaims).toBe(0);
    expect(report.unauthorizedTokens).toBe(0);
    expect(report.scenarios).toHaveLength(5);
    expect(report.scenarios.every((scenario) => scenario.pass)).toBe(true);
    expect(report.mergeCommits).toHaveLength(4);
    expect(report.mergeCommits.every((commit) => commit.parents === 2)).toBe(true);
    expect(report.claimedCertification).toBe(true);
    expect(report.hostElapsedMs).toBeLessThan(120_000);
    expect(report.signature).toBe(signReport(signingView(report)));
    const scorecard = fs.readFileSync(path.join(outDir, "scorecard.md"), "utf8");
    expect(scorecard).toContain("speedupRatio");
    expect(scorecard).toContain("passRateDelta");
    expect(scorecard).toContain("dbWriteP99Ms");
    expect(scorecard).toContain("boardUpdateMs");
    expect(scorecard).toContain("stopLatencyMs");
    expect(scorecard).toContain("leakedPids");
    expect(renderScorecard(report)).toBe(scorecard);
    const saved = JSON.parse(fs.readFileSync(path.join(outDir, "m3-exit-gate-report.json"), "utf8")) as { schema: string };
    expect(saved.schema).toBe("m3-exit-gate-report@1");
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}, 120_000);

it("does not claim live provider certification without an opted-in key", () => {
  const previousKey = process.env.EF_M3_LIVE_API_KEY;
  const previousRouter = process.env.OPENROUTER_API_KEY;
  const previousConfirm = process.env.EF_M3_LIVE_CONFIRM;
  delete process.env.EF_M3_LIVE_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.EF_M3_LIVE_CONFIRM;
  try {
    const live = runLiveCertification();
    expect(live.ran).toBe(false);
    expect(live.claimedCertification).toBe(false);
  } finally {
    if (previousKey !== undefined) process.env.EF_M3_LIVE_API_KEY = previousKey;
    if (previousRouter !== undefined) process.env.OPENROUTER_API_KEY = previousRouter;
    if (previousConfirm !== undefined) process.env.EF_M3_LIVE_CONFIRM = previousConfirm;
  }
});
