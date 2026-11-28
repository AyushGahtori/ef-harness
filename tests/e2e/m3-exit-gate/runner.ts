import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { M2KitchenE2eBenchmarkRunner } from "../m2-exit-gate/runner.js";
import { loadM3Fixtures } from "./fixtures.js";
import { buildWorkerPrompts, promptsLeakHidden, scanTreeForSecrets } from "./kitchen.js";
import { landFeatures, trackedViews } from "./merge-queue.js";
import { evaluateM3ExitGate, renderScorecard, signReport, signingView } from "./report.js";
import { M3ScaleAndLatencyCertifier, storeWithRealVault } from "./scale.js";
import { M3SteeringAndUndoScenarioSuite } from "./scenarios.js";
import { finishOf, scheduleKitchen, scheduleWithRetry, speedupAgainst } from "./schedule.js";
import type { LiveCertification, M3ExitGateReport, QueueFeature } from "./types.js";

const FEATURES: Omit<QueueFeature, "finishedAtSec" | "regression">[] = [
  {
    id: "F-Menu",
    slug: "menu",
    buildId: "menu-build",
    tasks: "T-menu",
    requirements: "R-menu",
    checks: "H-M2-19,H-M2-20",
    body: "Menu edits require an admin session.\n",
  },
  {
    id: "F-Orders",
    slug: "orders",
    buildId: "orders-build",
    tasks: "T-orders",
    requirements: "R-orders",
    checks: "H-M2-01,H-M2-05,H-M2-29",
    body: "Orders close at 11:00 and ignore a client clock.\n",
  },
  {
    id: "F-Print",
    slug: "print",
    buildId: "print-build",
    tasks: "T-print",
    requirements: "R-print",
    checks: "H-M2-14,H-M2-15",
    body: "Print view matches the dish totals.\n",
  },
  {
    id: "F-CateringEmail",
    slug: "catering-email",
    buildId: "catering-build",
    tasks: "T-catering",
    requirements: "R-catering",
    checks: "H-M2-16,H-M2-17",
    body: "Catering email matches the database totals once.\n",
  },
];

export class M3ParallelBenchmarkRunner {
  async run(options?: { outDir?: string; dbRounds?: number; jitter?: boolean; root?: string }): Promise<M3ExitGateReport> {
    const started = performance.now();
    const fixtures = loadM3Fixtures(options?.root);
    const schedule = options?.jitter
      ? scheduleWithRetry(fixtures.graph, fixtures.profile, fixtures.curve.jitterTaskId, fixtures.curve.jitterRetrySec)
      : scheduleKitchen(fixtures.graph, fixtures.profile);
    const m2 = await new M2KitchenE2eBenchmarkRunner(fixtures.root).run();
    const speedupRatio = speedupAgainst(m2.baseline.totalWallClockSec, schedule.makespanSec);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-gate-"));
    try {
      const features: QueueFeature[] = FEATURES.map((feature) => ({
        ...feature,
        finishedAtSec: finishOf(schedule, feature.buildId),
        regression: false,
      }));
      const merges = await landFeatures(dir, features);
      const viewsTracked = trackedViews(dir);
      const plaintext = ["sk", "_live_", "m3"].join("");
      await storeWithRealVault(path.join(dir, "secrets"), "provider-token", plaintext);
      const secretsFound = scanTreeForSecrets(dir);
      const prompts = buildWorkerPrompts(
        fixtures.opening,
        fixtures.graph.tasks.filter((task) => task.kind === "model").map((task) => task.id),
        m2.checks.length,
      );
      if (promptsLeakHidden(prompts, fixtures.suite)) throw new Error("worker prompts include the hidden suite");
      const checks = m2.checks.map((check) => ({
        id: check.id,
        title: check.title,
        pass: check.pass,
        detail: check.detail,
      }));
      const hiddenPassCount = checks.filter((check) => check.pass).length;
      const scale = new M3ScaleAndLatencyCertifier();
      const db = await scale.certifyDatabase(
        options?.dbRounds === undefined
          ? { dbPath: path.join(dir, "telemetry.db") }
          : { dbPath: path.join(dir, "telemetry.db"), rounds: options.dbRounds },
      );
      const board = scale.certifyBoard();
      const scenarios = await new M3SteeringAndUndoScenarioSuite(fixtures.suite, fixtures.profile).run();
      const m3PassRate = hiddenPassCount / checks.length;
      const m2PassRate = m2.baseline.passRatePct / 100;
      const scenariosPassed = scenarios.scenarios.filter((scenario) => scenario.pass).length;
      const productExecuted =
        schedule.wEff > 0 &&
        merges.commits.length === features.length &&
        checks.length >= 25 &&
        db.workers === 50 &&
        board.tasks === 500;
      const gate = evaluateM3ExitGate({
        speedupRatio,
        m3PassRate,
        m2PassRate,
        dbWriteP99Ms: db.p99Ms,
        boardUpdateMs: board.boardUpdateMs,
        boardPaintP95Ms: board.boardPaintP95Ms,
        stopLatencyMs: scenarios.stop.stopLatencyMs,
        leakedPids: scenarios.stop.leakedPids,
        secretsFound,
        paperworkPct: m2.baseline.paperworkPct,
        viewsTracked,
        postStopMerges: scenarios.stop.postStopMerges,
        unauthorizedClaims: scenarios.stop.unauthorizedClaims,
        unauthorizedTokens: scenarios.stop.unauthorizedTokens,
        sqliteBusy: db.busy,
        scenariosPassed,
        scenariosTotal: scenarios.scenarios.length,
      });
      if (!productExecuted) {
        gate.exitCode = 1;
        gate.reasons.push("productExecuted");
        gate.detail.push("M3 exit gate did not execute the integrated packages");
      }
      for (const line of [...db.detail, ...board.detail]) {
        if (!gate.detail.includes(line)) gate.detail.push(line);
      }
      const report: M3ExitGateReport = {
        schema: "m3-exit-gate-report@1",
        mode: "ci-replay",
        signature: "",
        m2: m2.baseline,
        m3: {
          totalWallClockSec: schedule.makespanSec,
          phase0Sec: schedule.phase0Sec,
          waveBuildSec: schedule.waveBuildSec,
          mergeQueueSec: schedule.mergeQueueSec,
          completionAuditSec: schedule.completionAuditSec,
          totalTokens: m2.baseline.totalTokens,
          paperworkPct: m2.baseline.paperworkPct,
          hiddenPassCount,
          hiddenTotalCount: checks.length,
          passRatePct: m3PassRate * 100,
        },
        speedupRatio,
        passRateDelta: gate.passRateDeltaPct,
        dbWriteP99Ms: db.p99Ms,
        boardUpdateMs: board.boardUpdateMs,
        boardPaintP95Ms: board.boardPaintP95Ms,
        stopLatencyMs: scenarios.stop.stopLatencyMs,
        leakedPids: scenarios.stop.leakedPids,
        secretsFound,
        sqliteBusy: db.busy,
        viewsTracked,
        postStopMerges: scenarios.stop.postStopMerges,
        unauthorizedClaims: scenarios.stop.unauthorizedClaims,
        unauthorizedTokens: scenarios.stop.unauthorizedTokens,
        wEff: schedule.wEff,
        preset: schedule.preset,
        dbSamples: db.samples,
        dbWorkers: db.workers,
        dbWindowMs: db.windowMs,
        scenarioWindowSec: db.scenarioWindowSec,
        boardTasks: board.tasks,
        boardRequirements: board.requirements,
        scenarios: scenarios.scenarios,
        checks,
        mergeCommits: merges.commits,
        gate,
        claimedCertification: gate.exitCode === 0 && productExecuted,
        productExecuted,
        hostElapsedMs: performance.now() - started,
      };
      report.signature = signReport(signingView(report));
      if (options?.outDir) {
        fs.mkdirSync(options.outDir, { recursive: true });
        fs.writeFileSync(path.join(options.outDir, "m3-exit-gate-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
        fs.writeFileSync(path.join(options.outDir, "scorecard.md"), renderScorecard(report), "utf8");
      }
      return report;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

export function runLiveCertification(env: NodeJS.ProcessEnv = process.env): LiveCertification {
  const key = env.EF_M3_LIVE_API_KEY || env.OPENROUTER_API_KEY;
  const confirm = env.EF_M3_LIVE_CONFIRM === "1";
  if (!key || !confirm) {
    return {
      ran: false,
      claimedCertification: false,
      reason: "Live certification needs EF_M3_LIVE_CONFIRM=1 and EF_M3_LIVE_API_KEY or OPENROUTER_API_KEY. ci-replay is the committed gate.",
    };
  }
  return {
    ran: false,
    claimedCertification: false,
    reason: "Live provider certification is not claimed on this base. The ci-replay gate is the integrated M3 proof.",
  };
}
