import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BoundedDeferralPolicy,
  CatalogIndex,
  DepthSession,
  ReadinessCalculator,
  openReadinessDatabase,
  type DepthCatalogEntry,
} from "@ef-harness/discovery";
import { GlobalBrokerDb } from "@ef-harness/db";
import * as plannerRoot from "../../src/index.js";
import {
  AUTO_START_HISTORY_SETTING_KEY,
  CREW_PRESETS,
  CrewPresetProfileEngine,
  ExpectedCostLevelSelector,
  HeftCriticalPathScheduler,
  HistoricalPassRateCalibrator,
  InteractivePlanEditor,
  LEVEL_COST_PERCENT,
  MasterPlanOrchestrator,
  PaperworkBudgetEnvelopeAllocator,
  PlanPreviewBuilder,
  RevisionAutoStartPolicy,
  RevisionImpactPreviewer,
  WORKER_TIERS,
  bindGlobalBrokerAutoStartStore,
  costMicroForLevel,
  costPpmForLevel,
  createPlanPreviewSources,
  createPlanRequest,
  defaultModelRoster,
  durationForLevel,
  normalizeCrewPreset,
  normalizeWorkerTier,
  type MasterPlanRequest,
  type PlanPreview,
} from "../../src/index.js";
import { candidate, levelOf, plannedTask, samplePlan } from "./fixtures.js";

const closers: Array<() => void> = [];
const tempDirs: string[] = [];

afterEach(() => {
  while (closers.length > 0) closers.pop()?.();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function allTasks(preview: PlanPreview) {
  return [...preview.phase0.tasks, ...preview.wave1.tasks];
}

function catalogEntry(id: string, label: string): DepthCatalogEntry {
  return {
    criterionId: id,
    label,
    riskTier: "high",
    reworkCost: "moderate",
    downstreamTaskCount: 3,
    options: [
      { id: "sqlite", label: "SQLite local store" },
      { id: "postgres", label: "PostgreSQL" },
    ],
    recommendations: [
      {
        stage: "mvp",
        optionId: "sqlite",
        rationale: "Single-file local storage fits offline kitchen mode",
        safeForLowerStage: true,
      },
    ],
    stageApplicability: { prototype: true, mvp: true, production: true },
    strongConventionStages: ["prototype", "mvp"],
    evidenceSettled: false,
    mustAskClass: null,
    domain: "storage",
    deploymentObvious: false,
    materialOptionDifference: false,
    conflict: false,
    highRiskSpecExpander: false,
    ambiguousBrownfield: false,
  };
}

describe("C41 integration: full WorkerTier/CrewPreset, real 073-107 sources, and GlobalBrokerDb persistence", () => {
  it("exports all 17 @ef-harness/planner submodules cleanly from packages/planner/src/index.ts", () => {
    expect(plannerRoot.SystemArchitectureSynthesizer).toBeTypeOf("function");
    expect(plannerRoot.FeatureArchitectureSynthesizer).toBeTypeOf("function");
    expect(plannerRoot.KnowledgeViewExporter).toBeTypeOf("function");
    expect(plannerRoot.MarkdownDirectEditImporter).toBeTypeOf("function");
    expect(plannerRoot.HybridRevisionEngine).toBeTypeOf("function");
    expect(plannerRoot.KnowledgePacketSlicer).toBeTypeOf("function");
    expect(plannerRoot.CrossCuttingRuleMatcher).toBeTypeOf("function");
    expect(plannerRoot.MasterPlanOrchestrator).toBeTypeOf("function");
    expect(plannerRoot.JitFeaturePlanner).toBeTypeOf("function");
    expect(plannerRoot.DeterministicGraphCompiler).toBeTypeOf("function");
    expect(plannerRoot.Phase0ExecutionController).toBeTypeOf("function");
    expect(plannerRoot.DesignSystemScaffoldBuilder).toBeTypeOf("function");
    expect(plannerRoot.SequentialBuildRunner).toBeTypeOf("function");
    expect(plannerRoot.HighRiskDiffReviewer).toBeTypeOf("function");
    expect(plannerRoot.ExpectedCostLevelSelector).toBeTypeOf("function");
    expect(plannerRoot.HeftCriticalPathScheduler).toBeTypeOf("function");
    expect(plannerRoot.PlanPreviewBuilder).toBeTypeOf("function");
    expect(plannerRoot.InteractivePlanEditor).toBeTypeOf("function");
    expect(plannerRoot.FirstBuildApprovalGate).toBeTypeOf("function");
    expect(plannerRoot.RevisionAutoStartPolicy).toBeTypeOf("function");
  });

  it("supports full WorkerTier including Principal and canonical CrewPreset normalization across PlanPreview", () => {
    expect(WORKER_TIERS).toEqual(["Junior", "Mid", "Senior", "Principal"]);
    expect(CREW_PRESETS).toEqual(["Fastest", "Balanced", "Cheapest"]);
    expect(LEVEL_COST_PERCENT.Principal).toBe(640);
    expect(normalizeWorkerTier("principal")).toBe("Principal");
    expect(normalizeWorkerTier("manager")).toBe("Principal");
    expect(normalizeCrewPreset("thorough")).toBe("Fastest");
    expect(normalizeCrewPreset("budget")).toBe("Cheapest");

    expect(costMicroForLevel(100_000n, "Principal")).toBe(640_000n);
    expect(costPpmForLevel(10_000, "Principal")).toBe(64_000);
    expect(durationForLevel(10, "Principal")).toBe(5);

    const request = createPlanRequest({
      projectId: "kitchen-principal",
      connection: "api",
      preset: "Fastest",
      totalBudgetMicroUsd: 20_000_000n,
      tasks: [
        plannedTask({
          id: "P0-oracle",
          title: "Oracle contract",
          phase: "phase0",
          phase0Step: "P0.1",
          balancedLevel: "Principal",
          safetyFloor: "Principal",
          criticalPath: true,
        }),
        plannedTask({
          id: "W1-auth",
          title: "Session auth",
          balancedLevel: "Senior",
          safetyFloor: "Mid",
          criticalPath: true,
        }),
      ],
    });

    const sources = createPlanPreviewSources({ useExpectedCostSelector: false });
    const preview = new PlanPreviewBuilder(sources).build(request);
    expect(levelOf(allTasks(preview), "P0-oracle")).toBe("Principal");
    expect(levelOf(allTasks(preview), "W1-auth")).toBe("Principal");
    expect(preview.crewCounts.Principal).toBe(2);

    const editor = new InteractivePlanEditor(request, sources);
    const updated = editor.switchPreset("Cheapest").preview;
    expect(levelOf(allTasks(updated), "P0-oracle")).toBe("Principal");
    expect(updated.crewCounts.Principal).toBe(1);
    const overridden = editor.overrideTaskTier("W1-auth", "Principal").preview;
    expect(levelOf(allTasks(overridden), "W1-auth")).toBe("Principal");
  });

  it("wires PlanPreviewSources onto real discovery, master-plan, revision, crew-levels, and scheduler engines", () => {
    const depth = new DepthSession({
      catalog: [catalogEntry("storage.db", "Primary storage")],
      clock: { now: () => 1_700_000_000_000 },
      stage: "mvp",
      title: "Kitchen app",
    });
    closers.push(() => depth.close());
    depth.acceptAllRecommended({ criterionIds: ["storage.db"] });

    const readinessDb = openReadinessDatabase();
    closers.push(() => readinessDb.close());
    readinessDb
      .prepare("INSERT INTO work_items(id, kind, title, status, created_at) VALUES ('W-k', 'project', 'Kitchen', 'discovering', 0)")
      .run();
    readinessDb
      .prepare("INSERT INTO change_sets(id, rev, origin, author, created_at, summary) VALUES ('CS-1', 1, 'planner', 'test', 0, 'seed')")
      .run();
    readinessDb
      .prepare("INSERT INTO discovery_scopes(work_item, scope_rev, created_rev, reason) VALUES ('W-k', 1, 1, 'opening')")
      .run();
    const seedDecision = (id: string, criterion: string, status: string): void => {
      readinessDb
        .prepare(
          "INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev) VALUES (?, 'decision', 1, ?, ?, '', ?, 'CS-1', 1, 1)",
        )
        .run(
          id,
          `hash-${id}`,
          criterion,
          JSON.stringify({ criterion, status, basis: status === "settled" ? "delegated" : undefined }),
        );
      readinessDb
        .prepare("INSERT INTO scope_criteria(work_item, scope_rev, decision, needed_for_planning, critical) VALUES ('W-k', 1, ?, 1, 0)")
        .run(id);
    };
    seedDecision("D-db", "storage.db", "settled");
    seedDecision("D-email", "delivery.provider", "open");
    for (let i = 1; i <= 4; i += 1) seedDecision(`D-p${i}`, `polish.${i}`, "open");

    const deferral = new BoundedDeferralPolicy(readinessDb);
    const deferred = deferral.defer({
      workItemId: "W-k",
      decisionId: "D-email",
      deferredReason: "Stable email gateway adapter",
      revisitWave: "wave-2",
      stage: "mvp",
    });
    expect(deferred.ok).toBe(true);
    const readiness = new ReadinessCalculator(readinessDb);

    const roster = defaultModelRoster();
    const calibrator = HistoricalPassRateCalibrator.fromRoster(roster, []);
    const selector = new ExpectedCostLevelSelector(roster, calibrator);
    const masterPlan = new MasterPlanOrchestrator();

    const sources = createPlanPreviewSources({
      chosenForYou: depth.ledger,
      deferrals: deferral,
      readiness,
      impact: new RevisionImpactPreviewer(),
      paperwork: new PaperworkBudgetEnvelopeAllocator(),
      selector,
      roster,
      calibrator,
      presets: new CrewPresetProfileEngine({ selector, roster, calibrator }),
      scheduler: new HeftCriticalPathScheduler(),
      masterPlan,
    });

    const masterRequest: MasterPlanRequest = {
      projectId: "kitchen-c41",
      architecture: {
        schema: "system-architect@1",
        projectId: "kitchen-c41",
        projectKind: "web",
        featureIds: ["F-Orders", "F-Kitchen", "F-AdminEmail"],
        database: true,
        auth: true,
      },
      features: [
        {
          id: "F-Orders",
          title: "Daily Meal Ordering",
          dependsOn: [],
          verticalSlice: true,
          specItems: 4,
          screens: 2,
          endpoints: 3,
          estimatedLeafTasks: { min: 4, max: 6 },
          estimatedCostUnits: { min: 400_000n, max: 700_000n },
        },
        {
          id: "F-Kitchen",
          title: "Kitchen Totals & Print",
          dependsOn: ["F-Orders"],
          verticalSlice: false,
          specItems: 3,
          screens: 2,
          endpoints: 1,
          estimatedLeafTasks: { min: 3, max: 5 },
          estimatedCostUnits: { min: 300_000n, max: 500_000n },
        },
        {
          id: "F-AdminEmail",
          title: "Admin Menu & Catering Email",
          dependsOn: ["F-Orders"],
          verticalSlice: false,
          specItems: 2,
          screens: 1,
          endpoints: 2,
          estimatedLeafTasks: { min: 2, max: 4 },
          estimatedCostUnits: { min: 200_000n, max: 400_000n },
        },
      ],
      budget: {
        currency: "usd",
        totalUnits: 12_000_000n,
        costPerLeafUnits: 150_000n,
      },
      parallelism: { hardwareSlots: 4, providerSlots: 4, developerMax: 2 },
    };

    const planReq = sources.masterPlan?.planToPreviewRequest(masterRequest, {
      workItemId: "W-k",
      preset: "Balanced",
      revision: 1,
    });
    expect(planReq).toBeDefined();
    if (!planReq) return;

    const preview = new PlanPreviewBuilder(sources).build(planReq);
    expect(preview.chosenForYou.entries.some((entry) => entry.criterionId === "storage.db")).toBe(true);
    expect(preview.deferred.some((item) => item.criterionId === "delivery.provider")).toBe(true);
    expect(preview.readiness.counts.chosenForYou).toBe(1);
    expect(preview.readiness.counts.deferred).toBe(1);
    expect(allTasks(preview).every((t) => typeof t.modelId === "string" && t.modelId.length > 0)).toBe(true);
    expect(preview.paperwork.envelopes).toHaveLength(5);
    expect(preview.heft.criticalPathMinutes).toBeGreaterThan(0);

    const previewDirect = new PlanPreviewBuilder(sources).buildFromMasterPlan(masterPlan.plan(masterRequest), {
      workItemId: "W-k",
    });
    expect(previewDirect.projected.waves.length).toBeGreaterThanOrEqual(2);
    expect(sources.impact.llmCalls).toBe(0);

    const checkCatalog = new CatalogIndex([catalogEntry("storage.db", "Primary storage")]);
    expect(checkCatalog.has("storage.db")).toBe(true);
  });

  it("persists rolling 24h auto-start spend counters cleanly in GlobalBrokerDb across DB close and reopen", () => {
    const dir = makeTempDir("ef-c41-globaldb-");
    const t0 = 1_700_000_000_000;

    const db1 = GlobalBrokerDb.open({ root: dir });
    try {
      const policy1 = RevisionAutoStartPolicy.open(db1);
      policy1.configure({
        dailyCapMicroUsd: 1_500_000n,
        deltaCostCeilingMicroUsd: 2_000_000n,
      });
      policy1.record({ atMs: t0 - 1_000, costMicroUsd: 1_200_000n, windowPpm: 50_000 });
      const rawSetting = db1.getSetting(AUTO_START_HISTORY_SETTING_KEY);
      expect(Array.isArray(rawSetting)).toBe(true);
    } finally {
      db1.close();
    }

    const db2 = GlobalBrokerDb.open({ root: dir });
    closers.push(() => db2.close());
    const policy2 = new RevisionAutoStartPolicy({ globalDb: db2 });
    expect(policy2.currentSettings().dailyCapMicroUsd).toBe(1_500_000n);
    expect(policy2.historySnapshot()).toEqual([
      { atMs: t0 - 1_000, costMicroUsd: 1_200_000n, windowPpm: 50_000 },
    ]);

    const decision = policy2.evaluate(
      candidate({
        nowMs: t0,
        deltaCostMicroUsd: 400_000n,
      }),
    );
    expect(decision.autoStart).toBe(false);
    expect(decision.reasons.join(" ")).toContain("rolling 24h auto-start spend exceeds");

    const allowedAfterExpiry = policy2.evaluate(
      candidate({
        nowMs: t0 + 25 * 60 * 60 * 1_000,
        deltaCostMicroUsd: 400_000n,
      }),
    );
    expect(allowedAfterExpiry.autoStart).toBe(true);

    const scopedStore = bindGlobalBrokerAutoStartStore(db2, { scopeKey: "kitchen" });
    scopedStore.writeHistory([{ atMs: t0, costMicroUsd: 55_000n, windowPpm: 1_000 }]);
    expect(scopedStore.readHistory()).toEqual([{ atMs: t0, costMicroUsd: 55_000n, windowPpm: 1_000 }]);

    const editor = new InteractivePlanEditor(samplePlan(), createPlanPreviewSources());
    expect(editor.preview().guard.spendGuard).toBeNull();
  });
});
