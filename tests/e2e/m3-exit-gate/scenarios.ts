import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ContractChangeRequestEngine,
  DeterministicSchemaDiffClassifier,
  FeatureUndoEngine,
  MigrationIntentAndConflictLinter,
  intersectRanges,
} from "@ef-harness/integrator";
import { PressureHysteresisStateMachine, ThreePoolCapacityScheduler, admission } from "@ef-harness/governor";
import { budgetStops, dispatcher, holds, reentry } from "@ef-harness/steering";
import { checkOwner } from "./kitchen.js";
import type { HiddenSuiteDoc, MachineProfile, ScenarioResult, StopProbe } from "./types.js";

const GIB = 1024 * 1024 * 1024;

function hardware(availPhysMb: number) {
  return {
    sampledAtMs: 0,
    totalPhysMb: 16 * 1024,
    availPhysMb,
    totalCommitMb: 32 * 1024,
    availCommitMb: 20 * 1024,
    lowMemoryNotification: false,
    cpuCoreCount: 8,
    cpuLoadRatio: 0.2,
    defenderCpuRatio: 0.02,
    avContentionActive: false,
    uiLatencyMs: 8,
    uiSampleValid: true,
    gpuAvailable: true,
    gpuClass: "discrete" as const,
    vramBudgetMb: 8192,
    vramUsedMb: 1024,
    projectDisk: { letter: "D:", freeBytes: 200 * GIB, totalBytes: 512 * GIB },
    appDataDisk: { letter: "C:", freeBytes: 80 * GIB, totalBytes: 256 * GIB },
    diskQueueDepth: 0.1,
    ioLatencyMs: 0.4,
    storageClass: "ssd" as const,
    devDrive: false,
  };
}

export function runSurgicalHold(): ScenarioResult {
  const db = holds.openHoldDatabase();
  try {
    const engine = new holds.MultiInterpretationHoldEngine({
      db,
      walker: new holds.LocalReverseImpactWalker(
        new Map([
          ["F-Menu", ["T-menu"]],
          ["F-Orders", ["T-orders"]],
          ["F-Print", ["T-print"]],
          ["F-CateringEmail", ["T-catering"]],
        ]),
      ),
      worker: new holds.LocalWorkerSession(),
      acceptance: new holds.LocalCandidateAcceptanceTx(),
      inbox: new holds.LocalInbox(),
      surfaces: new holds.LocalHoldSurfaces(),
    });
    const catalog = ["F-Menu", "F-Orders", "F-Print", "F-CateringEmail"].map((featureId) => ({
      taskId: featureId === "F-Menu" ? "T-menu" : featureId === "F-Orders" ? "T-orders" : featureId === "F-Print" ? "T-print" : "T-catering",
      featureId,
      label: featureId,
      progress: 0.9,
      state: "VERIFYING",
      sliceSha256: `sha-${featureId}`,
      briefText: `${featureId} brief`,
      requirements: [`req-${featureId}`],
      baseCommit: "kitchen",
      sessionRef: `session-${featureId}`,
      step: 4,
      wipFiles: [],
      criticalPath: false,
    }));
    const started = performance.now();
    const placed = engine.holdAmbiguousMessage(
      {
        messageId: "m3-hold",
        text: "Which menu cutoff should orders follow?",
        subject: "cutoff",
        alternateReadings: [
          {
            id: "menu",
            featureId: "F-Menu",
            label: "menu cutoff",
            targetNodeIds: ["F-Menu"],
            changeKind: "additive",
            deltaText: "Menu cutoff",
          },
          {
            id: "orders",
            featureId: "F-Orders",
            label: "orders cutoff",
            targetNodeIds: ["F-Orders"],
            changeKind: "additive",
            deltaText: "Orders cutoff",
          },
        ],
      },
      catalog,
    );
    const quarantineMs = performance.now() - started;
    const heldIds = placed.placements.map((hold) => hold.taskId).sort();
    const soft = placed.placements.every((hold) => hold.mode === holds.SOFT_HOLD);
    const continued = [...placed.untouchedTaskIds].sort().join(",");
    const pass =
      heldIds.join(",") === "T-menu,T-orders" &&
      soft &&
      continued === "T-catering,T-print" &&
      quarantineMs < 1000 &&
      placed.placements.length === 2;
    return {
      id: "surgical-ambiguous-hold",
      title: "Surgical ambiguous hold",
      pass,
      detail: `held ${heldIds.join(",")} continued ${continued} quarantine ${quarantineMs.toFixed(3)} ms`,
    };
  } finally {
    db.close();
  }
}

function git(cwd: string, args: string[]): void {
  const run = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "EF Harness",
      GIT_AUTHOR_EMAIL: "foundation@ef-harness.local",
      GIT_COMMITTER_NAME: "EF Harness",
      GIT_COMMITTER_EMAIL: "foundation@ef-harness.local",
    },
  });
  if (run.status !== 0) throw new Error((run.stderr || run.stdout || `git ${args.join(" ")} failed`).trim());
}

export async function runStopAndResume(options?: { leak?: boolean; bypassResume?: boolean }): Promise<StopProbe> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-stop-"));
  const assembly = dispatcher.createFourRouteSteeringDispatcher();
  const job = assembly.jobs.createJob("kitchen");
  let zombieParent: ReturnType<typeof spawn> | null = null;
  try {
    if (options?.leak) {
      const zombie = await unreapedChild();
      zombieParent = zombie.parent;
      assembly.jobs.assignProcess(job.id, zombie.pid);
    } else {
      assembly.jobs.spawnInJob(job.id);
    }
    let leakedPids = 0;
    let stopLatencyMs = 0;
    try {
      const stopped = await assembly.stopController.stop(0);
      stopLatencyMs = stopped.stateFlipMs;
      leakedPids = stopped.jobTerminations.reduce((sum, item) => sum + item.survivingPids.length, 0);
    } catch (error) {
      if (error instanceof dispatcher.JobLeakError) {
        leakedPids = error.survivingPids.length;
        stopLatencyMs = 0;
      } else {
        throw error;
      }
    }
    const runtime = assembly.stopController.projectRuntime();
    const postStopMerges = runtime.claimNewTasks ? 1 : 0;
    git(dir, ["init", "-b", "harness/integration"]);
    fs.writeFileSync(path.join(dir, "README.md"), "parked\n", "utf8");
    git(dir, ["add", "--", "README.md"]);
    git(dir, ["commit", "-m", "park"]);
    git(dir, ["branch", "main"]);
    const worktrees = path.join(dir, "worktrees");
    const exported = new budgetStops.WipBranchHandoffExporter().exportBundle({
      repoPath: dir,
      projectSlug: "menu",
      date: "2026-03-02",
      handoffPlacement: "untracked",
      worktreeDirectory: worktrees,
      verifiedUnmergedShas: [],
      partialTasks: [
        {
          taskId: "T-menu",
          title: "menu",
          files: [{ path: "src/menu.txt", contents: "Menu edits require an admin session.\n" }],
          failingTestOutput: "",
          acceptanceCriteria: ["menu edits require an admin"],
        },
      ],
      done: [],
      remaining: [],
      testCommand: "pnpm test",
      previewCommand: "pnpm dev",
    });
    const gate = new reentry.NoRunUntilResumeGate();
    gate.open({
      reopen: "crash",
      buildWasInProgress: true,
      sleepMinutes: null,
      repoChanged: false,
      networkChanged: false,
      offline: false,
      forceHold: true,
      untouchedNewIdleProject: false,
    });
    const denied = gate.tryActivity("start_worker");
    let unauthorizedClaims = 0;
    let unauthorizedTokens = 0;
    if (options?.bypassResume) {
      unauthorizedClaims = denied.allowed ? 0 : 1;
      unauthorizedTokens = denied.allowed ? 0 : 12;
    } else if (denied.allowed) {
      unauthorizedClaims = 1;
      unauthorizedTokens = 12;
    }
    const pass =
      stopLatencyMs < 100 &&
      leakedPids === 0 &&
      postStopMerges === 0 &&
      unauthorizedClaims === 0 &&
      unauthorizedTokens === 0 &&
      exported.branch.startsWith("wip/menu-") &&
      fs.existsSync(exported.handoffPath);
    return {
      result: {
        id: "kernel-stop-wip-resume",
        title: "Immediate kernel stop, wip export, and cold open",
        pass,
        detail: `branch ${exported.branch} in ${stopLatencyMs.toFixed(3)} ms, leaked ${leakedPids}, claims ${unauthorizedClaims}`,
      },
      stopLatencyMs,
      leakedPids,
      postStopMerges,
      unauthorizedClaims,
      unauthorizedTokens,
      wipBranch: exported.branch,
      handoffPath: exported.handoffPath,
    };
  } finally {
    try {
      if (!options?.leak) await assembly.jobs.terminateAll(0);
    } catch {
      /* a leaked child is reaped with its parent below */
    }
    if (zombieParent && zombieParent.exitCode === null) zombieParent.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function unreapedChild(): Promise<{ parent: ReturnType<typeof spawn>; pid: number }> {
  return new Promise((resolve, reject) => {
    const parent = spawn(
      "python3",
      [
        "-c",
        "import os,sys,time\npid=os.fork()\nif pid==0:\n    os._exit(0)\nsys.stdout.write(str(pid)+'\\n')\nsys.stdout.flush()\ntime.sleep(30)\n",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let buffer = "";
    const timer = setTimeout(() => {
      parent.kill("SIGKILL");
      reject(new Error("zombie parent did not report a pid"));
    }, 2_000);
    parent.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const line = buffer.split(/\r?\n/).find((item) => item.length > 0);
      if (!line) return;
      clearTimeout(timer);
      const pid = Number(line);
      if (!Number.isInteger(pid) || pid <= 0) {
        parent.kill("SIGKILL");
        reject(new Error(`zombie parent reported ${line}`));
        return;
      }
      resolve({ parent, pid });
    });
    parent.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export function runFeatureUndo(suite: HiddenSuiteDoc): ScenarioResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-undo-"));
  try {
    const engine = new FeatureUndoEngine({ repo: dir, stateFile: path.join(dir, "undo.db") });
    const transfers = engine.ownership.plan({
      featureId: "F-Print",
      title: "Print",
      landed: true,
      inFlight: false,
      mergeSha: "print",
      nonFastForward: true,
      exclusive: [],
      shared: [
        {
          path: "date-formatter.ts",
          kind: "helper",
          symbol: "formatDate",
          status: "A",
          bucket: "shared",
          referencedBy: ["F-Print", "F-CateringEmail"],
          reasons: ["import"],
        },
      ],
      persistentData: [],
      exclusiveRatio: 0,
      fastPathCandidate: false,
      revertConflicts: [],
      laterOverlapPaths: [],
      hardDependents: [],
      externalEffects: [],
      llmTokens: 0,
    });
    const helper = transfers[0];
    const remaining = suite.checks.filter((check) => checkOwner(check.id) !== "F-Print");
    const pass =
      helper?.toFeatureId === "F-CateringEmail" &&
      helper.fromFeatureId === "F-Print" &&
      remaining.length > 0 &&
      remaining.every((check) => check.id.startsWith("H-M2-"));
    return {
      id: "planned-feature-undo",
      title: "Planned feature undo keeps the shared helper",
      pass,
      detail: `owner ${helper?.toFeatureId ?? "missing"}, remaining checks ${remaining.length}`,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function runAdditiveCcr(): Promise<ScenarioResult> {
  const before = "CREATE TABLE meal_orders (id TEXT PRIMARY KEY, dish TEXT NOT NULL);\n";
  const after = "CREATE TABLE meal_orders (id TEXT PRIMARY KEY, dish TEXT NOT NULL, dietary_note TEXT);\n";
  const classified = new DeterministicSchemaDiffClassifier().classify({
    before: { sql: before },
    after: { sql: after },
    claimedClass: "additive",
  });
  const linter = new MigrationIntentAndConflictLinter();
  const stamp = new Date("2026-11-22T01:45:00Z");
  const menu = linter.nameMigration({ featureId: "F-Menu", slug: "menu", sql: "CREATE TABLE menu_items (id TEXT PRIMARY KEY);\n", at: stamp });
  const orders = linter.nameMigration({
    featureId: "F-Orders",
    slug: "orders",
    sql: "CREATE TABLE meal_orders (id TEXT PRIMARY KEY);\n",
    at: stamp,
  });
  const lint = linter.lint([menu, orders], 2);
  const engine = new ContractChangeRequestEngine({
    owners: {
      get(contractNodeId) {
        if (contractNodeId !== "meal_orders") return null;
        return {
          contractNodeId,
          ownerTaskId: "F-Orders",
          ownerFeatureId: "F-Orders",
          ownerRole: "F-Orders",
          phase0: false,
        };
      },
    },
    features: {
      stateOf: () => "RUNNING",
      runningFeatures: () => ["F-Menu", "F-Orders"],
    },
  });
  const intake = await engine.submit({
    requestingTaskId: "T-menu",
    requestingFeatureId: "F-Menu",
    targetContractNodeId: "meal_orders",
    proposedDelta: { before: { sql: before }, after: { sql: after } },
    rationale: "Orders store a dietary note.",
    urgency: "normal",
    claimedClass: "additive",
  });
  const lock = intersectRanges("^3.0.0", "^3.2.0");
  const pass =
    classified.classification === "ADDITIVE" &&
    lint.findings.length === 0 &&
    menu.path !== orders.path &&
    intake.classification === "ADDITIVE" &&
    intake.ownerTask?.mutatedBy === "F-Orders" &&
    intake.ownerTask.consumerMayEdit === false &&
    intake.consumerEditedContract === false &&
    lock === "^3.2.0";
  return {
    id: "additive-ccr-parallel-migrations",
    title: "Additive CCR and parallel migration hygiene",
    pass,
    detail: `${menu.path} and ${orders.path}; owner ${intake.ownerTask?.mutatedBy ?? "missing"}; lock ${lock ?? "none"}`,
  };
}

export async function runGovernorStress(profile: MachineProfile): Promise<ScenarioResult> {
  const orange = hardware(800);
  const green = hardware(10 * 1024);
  const spikeProvider = new admission.SyntheticTelemetryProvider();
  spikeProvider.setFrom(0, orange);
  spikeProvider.setFrom(profile.spikeIgnoredMs, green);
  const spike = new PressureHysteresisStateMachine(spikeProvider);
  const spikeAtStart = spike.sample(0);
  const spikeAtEnd = spike.sample(profile.spikeIgnoredMs);
  const sustainedProvider = new admission.SyntheticTelemetryProvider();
  sustainedProvider.setFrom(0, orange);
  sustainedProvider.setFrom(profile.orangeEnterMs + 1, green);
  const sustained = new PressureHysteresisStateMachine(sustainedProvider);
  sustained.sample(0);
  const entered = sustained.sample(profile.orangeEnterMs);
  sustained.sample(profile.orangeEnterMs + 1);
  const recovered = sustained.sample(profile.orangeEnterMs + 1 + profile.greenRecoverMs);
  const pools = await ThreePoolCapacityScheduler.create({ totalRamGb: profile.ramGb, pressure: "GREEN" });
  const ids = ["T-menu", "T-orders", "T-print"];
  await Promise.all(ids.map((taskId) => pools.thinking.admit(taskId)));
  pools.setPressure(entered);
  const during = pools.snapshot().executionTarget;
  const kept = pools.snapshot().thinkingCount;
  pools.setPressure(recovered);
  const after = pools.snapshot();
  for (const taskId of ids) pools.releaseThinking(taskId);
  const released = pools.snapshot().thinkingCount;
  const pass =
    spikeAtStart === "GREEN" &&
    spikeAtEnd === "GREEN" &&
    entered === "ORANGE" &&
    during === 1 &&
    kept === ids.length &&
    recovered === "GREEN" &&
    after.executionTarget === profile.warmSlots &&
    after.thinkingCount === ids.length &&
    released === 0;
  return {
    id: "governor-orange-drain",
    title: "Hardware governor Green to Orange to Green",
    pass,
    detail: `spike ${spikeAtEnd}, enter ${entered} target ${during}, recover ${recovered} target ${after.executionTarget}, kept ${kept}`,
  };
}

export class M3SteeringAndUndoScenarioSuite {
  constructor(
    private readonly suite: HiddenSuiteDoc,
    private readonly profile: MachineProfile,
  ) {}

  async run(): Promise<{ scenarios: ScenarioResult[]; stop: StopProbe }> {
    const stop = await runStopAndResume();
    const scenarios = [
      runSurgicalHold(),
      stop.result,
      runFeatureUndo(this.suite),
      await runAdditiveCcr(),
      await runGovernorStress(this.profile),
    ];
    return { scenarios, stop };
  }
}
