import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadM3Fixtures } from "./fixtures.ts";
import {
  buildWorkerPrompts,
  KitchenHiddenAcceptanceSuite,
  kitchenFromLanded,
  M2KitchenE2eBenchmarkRunner,
  promptsLeakHidden,
  scanTreeForSecrets,
  WindowsDpapiSecretsVault,
} from "./kitchen.ts";
import { ProjectMergeQueue, trackedViews, writeIgnoredView } from "./merge-queue.ts";
import { evaluateM3ExitGate, renderScorecard, signReport, signingView } from "./report.ts";
import { M3ScaleAndLatencyCertifier } from "./scale.ts";
import { DynamicScheduleRebalancer, HeftCriticalPathScheduler, speedupAgainst } from "./schedule.ts";
import { M3SteeringAndUndoScenarioSuite } from "./scenarios.ts";
import type { LiveCertification, M3ExitGateReport, QueueFeature, ScheduleResult } from "./types.ts";

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

function finishOf(schedule: ScheduleResult, id: string): number {
  const row = schedule.assignments.find((item) => item.id === id);
  if (!row) throw new Error(`schedule is missing ${id}`);
  return row.finishSec;
}

export class M3ParallelBenchmarkRunner {
  async run(options?: { outDir?: string; dbRounds?: number; jitter?: boolean; root?: string }): Promise<M3ExitGateReport> {
    const started = performance.now();
    const fixtures = loadM3Fixtures(options?.root);
    const scheduler = new HeftCriticalPathScheduler();
    const schedule = options?.jitter
      ? new DynamicScheduleRebalancer().withRetry(
          fixtures.graph,
          fixtures.profile,
          fixtures.curve.jitterTaskId,
          fixtures.curve.jitterRetrySec,
        )
      : scheduler.schedule(fixtures.graph, fixtures.profile);
    const baseline = new M2KitchenE2eBenchmarkRunner(fixtures.baseline).readBaseline();
    const speedupRatio = speedupAgainst(baseline.totalWallClockSec, schedule.makespanSec);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-gate-"));
    try {
      const features: QueueFeature[] = FEATURES.map((feature) => ({
        ...feature,
        finishedAtSec: finishOf(schedule, feature.buildId),
        regression: false,
      }));
      const merges = new ProjectMergeQueue().land(dir, features);
      writeIgnoredView(dir);
      const viewsTracked = trackedViews(dir);
      const vault = new WindowsDpapiSecretsVault();
      const plaintext = ["sk", "_live_", "m3"].join("");
      const stored = vault.put("provider-token", plaintext);
      const vaultFile = path.join(dir, ".harness", "vault", "provider-token.dpapi");
      fs.mkdirSync(path.dirname(vaultFile), { recursive: true });
      fs.writeFileSync(vaultFile, `${stored}\n`, "utf8");
      const secretsFound = scanTreeForSecrets(dir);
      const suite = new KitchenHiddenAcceptanceSuite(fixtures.suite);
      const prompts = buildWorkerPrompts(
        fixtures.opening,
        fixtures.graph.tasks.filter((task) => task.kind === "model").map((task) => task.id),
        suite.total,
      );
      if (promptsLeakHidden(prompts, fixtures.suite)) {
        throw new Error("worker prompts include the hidden suite");
      }
      const landed = merges.commits.map((commit) => commit.featureId);
      const checks = suite.run(kitchenFromLanded(landed));
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
      const m2PassRate = baseline.passRatePct / 100;
      const scenariosPassed = scenarios.scenarios.filter((scenario) => scenario.pass).length;
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
        paperworkPct: baseline.paperworkPct,
        viewsTracked,
        postStopMerges: scenarios.stop.postStopMerges,
        unauthorizedClaims: scenarios.stop.unauthorizedClaims,
        unauthorizedTokens: scenarios.stop.unauthorizedTokens,
        sqliteBusy: db.busy,
        scenariosPassed,
        scenariosTotal: scenarios.scenarios.length,
      });
      for (const line of [...db.detail, ...board.detail]) {
        if (!gate.detail.includes(line)) gate.detail.push(line);
      }
      const hostElapsedMs = performance.now() - started;
      const report: M3ExitGateReport = {
        schema: "m3-exit-gate-report@1",
        mode: "ci-replay",
        signature: "",
        m2: baseline,
        m3: {
          totalWallClockSec: schedule.makespanSec,
          phase0Sec: schedule.phase0Sec,
          waveBuildSec: schedule.waveBuildSec,
          mergeQueueSec: schedule.mergeQueueSec,
          completionAuditSec: schedule.completionAuditSec,
          totalTokens: baseline.totalTokens,
          paperworkPct: baseline.paperworkPct,
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
        claimedCertification: gate.exitCode === 0,
        hostElapsedMs,
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
    reason: "Live provider certification is not claimed on this base. Sibling M3 runtimes stay local ports until integration.",
  };
}
