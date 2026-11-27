import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodeIndexDb,
  GlobalBrokerDb,
  TelemetryDb,
  bindBudgetLedger,
  bindTaskHolds,
  bindTaskLeases,
  openProjectStateDb,
} from "@ef-harness/db";
import {
  CREW_PRESETS,
  CrewPresetProfileEngine,
  DeterministicGraphCompiler,
  DynamicScheduleRebalancer,
  ExpectedCostLevelSelector,
  GOVERNOR_PRESSURES,
  HeftCriticalPathScheduler,
  HistoricalPassRateCalibrator,
  TASK_HOLD_REASONS,
  VersionedModelRoster,
  WORKER_TIERS,
  bindBudgetLedgerRepo,
  bindCodeIndexRepo,
  bindGlobalDbRepo,
  bindTaskClaimManager,
  bindTaskHoldsManager,
  bindTelemetryDbRepo,
  createScheduleState,
  defaultPassPriors,
  dispatchReady,
  effectiveHardwareCap,
  featuresFromGraphTask,
  normalizeCrewPreset,
  normalizeGovernorPressure,
  normalizeWorkerTier,
  passObservationsFromTelemetry,
  selectionInput,
  validateDisjointScheduleWriteScopes,
  writeScopesOverlap,
} from "../../src/index.js";
import type { ScheduleTask } from "../../src/index.js";
import { task } from "./fixtures.js";

const closers: Array<() => void> = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("C40 integration: canonical vocabularies, concrete modelId dispatch, and real DB/compiler ports", () => {
  it("normalizes legacy lowercase/alias inputs at boundaries while emitting canonical vocabularies", () => {
    expect(WORKER_TIERS).toEqual(["Junior", "Mid", "Senior", "Principal"]);
    expect(CREW_PRESETS).toEqual(["Fastest", "Balanced", "Cheapest"]);
    expect(GOVERNOR_PRESSURES).toEqual(["GREEN", "YELLOW", "ORANGE", "RED"]);
    expect(TASK_HOLD_REASONS).toContain("requirement_change");
    expect(TASK_HOLD_REASONS).toContain("editor_overlap");

    expect(normalizeWorkerTier("junior")).toBe("Junior");
    expect(normalizeWorkerTier("manager")).toBe("Principal");
    expect(normalizeCrewPreset("budget")).toBe("Cheapest");
    expect(normalizeCrewPreset("thorough")).toBe("Fastest");
    expect(normalizeGovernorPressure("Green")).toBe("GREEN");
    expect(normalizeGovernorPressure("orange")).toBe("ORANGE");
    expect(normalizeGovernorPressure("red")).toBe("RED");

    const state = createScheduleState({
      graph: {
        tasks: [task({ id: "T1", featureId: "f1", featureSlug: "f1", avgExecTimeMs: 60_000 })],
      },
      preset: "budget",
      governorPressure: "Green",
      hardwarePoolCap: 4,
      worktreeSlotCap: 4,
      inFlight: [
        {
          taskId: "T-run",
          featureId: "f-run",
          featureSlug: "f-run",
          attemptId: "att-0",
          connectionId: "conn-1",
          level: "manager",
          presetAtClaim: "thorough",
          startedAtMs: 0,
          execTimeMs: 10_000,
          writeScope: ["src/run/**"],
          waveIndex: 1,
        },
      ],
    });
    expect(state.preset).toBe("Cheapest");
    expect(state.governorPressure).toBe("GREEN");
    expect(state.inFlight[0]?.level).toBe("Principal");
    expect(state.inFlight[0]?.presetAtClaim).toBe("Fastest");

    expect(effectiveHardwareCap(6, "Yellow")).toBe(3);
    expect(effectiveHardwareCap(6, "Orange")).toBe(1);
    expect(effectiveHardwareCap(6, "Red")).toBe(0);

    const rebalancer = new DynamicScheduleRebalancer();
    const red = rebalancer.rebalance(state, {
      type: "governor",
      pressure: "Red",
      nowMs: 10,
    });
    expect(red.state.governorPressure).toBe("RED");
    expect(red.parallelism.wEff).toBe(0);
    expect(red.admissions).toEqual([]);
    expect(red.abortedTaskIds).toEqual([]);

    const switched = rebalancer.rebalance(red.state, {
      type: "preset_switch",
      preset: "thorough",
      nowMs: 20,
    });
    expect(switched.state.preset).toBe("Fastest");
  });

  it("propagates concrete LevelAssignment.modelId from VersionedModelRoster into claimTask and DispatchAssignment", () => {
    const roster = VersionedModelRoster.seed([
      {
        modelId: "claude-haiku-4-5",
        family: "anthropic",
        provider: "anthropic",
        connectionId: "conn-anthropic",
        tier: "junior",
        contextWindow: 200_000,
        supportsTools: true,
        supportsStructuredJson: true,
        supportsVision: false,
        spendKind: "paid-api",
        inputMicroUsdPer1M: 40_000n,
        outputMicroUsdPer1M: 0n,
        cachedInputMicroUsdPer1M: 0n,
        allowancePpmPer1M: 0n,
        defaultPassPriors: defaultPassPriors("junior"),
        deprecatedAfter: null,
        pinned: false,
      },
      {
        modelId: "claude-sonnet-4-6",
        family: "anthropic",
        provider: "anthropic",
        connectionId: "conn-anthropic",
        tier: "Senior",
        contextWindow: 200_000,
        supportsTools: true,
        supportsStructuredJson: true,
        supportsVision: true,
        spendKind: "paid-api",
        inputMicroUsdPer1M: 140_000n,
        outputMicroUsdPer1M: 0n,
        cachedInputMicroUsdPer1M: 0n,
        allowancePpmPer1M: 0n,
        defaultPassPriors: defaultPassPriors("Senior"),
        deprecatedAfter: null,
        pinned: false,
      },
    ]);

    const resolved = roster.resolveModelForTier("senior");
    expect(resolved.modelId).toBe("claude-sonnet-4-6");
    expect(resolved.tier).toBe("Senior");

    const costEstimate = roster.estimateTaskExpectedCostMicroUsd(
      { id: "T-auth", touches: ["authn"], primaryFiles: ["src/auth.ts"], mustBandTokens: 2000 },
      "budget",
    );
    expect(Number.isInteger(costEstimate)).toBe(true);
    expect(costEstimate).toBeGreaterThan(0);

    const scheduler = new HeftCriticalPathScheduler({ roster });
    const graph = {
      tasks: [
        task({
          id: "T-leaf",
          featureId: "f-leaf",
          featureSlug: "leaf",
          difficulty: "standard",
          writeScope: ["src/leaf/**"],
          avgExecTimeMs: 30_000,
        }),
        task({
          id: "T-auth",
          featureId: "f-auth",
          featureSlug: "auth",
          difficulty: "critical",
          riskTags: ["auth"],
          writeScope: ["src/auth/**"],
          avgExecTimeMs: 90_000,
        }),
      ],
    };
    const dispatches = scheduler.scheduleReadyWave(graph, "budget", 2);
    expect(dispatches[0]?.taskId).toBe("T-auth");
    expect(dispatches[0]?.level).toBe("Senior");
    expect(dispatches[0]?.modelId).toBe("claude-sonnet-4-6");
    expect(dispatches[1]?.taskId).toBe("T-leaf");
    expect(dispatches[1]?.level).toBe("Junior");
    expect(dispatches[1]?.modelId).toBe("claude-haiku-4-5");
    expect(dispatches.every((row) => !WORKER_TIERS.includes(row.modelId as never))).toBe(true);

    const profileEngine = new CrewPresetProfileEngine({ roster });
    const assigned = profileEngine.assignLevel(graph.tasks[1] as ScheduleTask, true, "Cheapest");
    expect(assigned.modelId).toBe("claude-sonnet-4-6");
    expect(assigned.level).toBe("Senior");
  });

  it("binds Task 106 ports onto real GlobalBrokerDb, TelemetryDb, CodeIndexDb, and BudgetLedgerRepo", () => {
    const rootDir = makeTempDir("ef-c40-106-");
    const stateDb = openProjectStateDb({ projectId: "C40Db106", rootDir });
    const broker = GlobalBrokerDb.open({ root: path.join(rootDir, "global") });
    const now = 1_700_000_000_000;
    const telemetry = TelemetryDb.open({
      filePath: path.join(rootDir, "telemetry.db"),
      now: () => now,
    });
    const codeIndex = CodeIndexDb.open({ filePath: path.join(rootDir, "code-index.db") });
    closers.push(() => {
      if (!stateDb.isClosed()) stateDb.close();
      broker.close();
      telemetry.close();
      codeIndex.close();
    });

    broker.upsertConnection({
      id: "anthropic-api",
      provider: "anthropic",
      route: "api_key",
      vaultRef: "wincred:ef-harness/anthropic",
      currency: "usd",
      scale: 1_000_000,
      enabled: true,
      createdAt: 100,
    });
    broker.upsertConnection({
      id: "openai-api",
      provider: "openai",
      route: "api_key",
      vaultRef: "wincred:ef-harness/openai",
      currency: "usd",
      scale: 1_000_000,
      enabled: false,
      createdAt: 101,
    });

    const globalPort = bindGlobalDbRepo(broker);
    const connections = globalPort.listConnections();
    expect(connections.map((c) => [c.id, c.enabled])).toEqual([
      ["anthropic-api", true],
      ["openai-api", false],
    ]);

    for (let i = 0; i < 20; i += 1) {
      telemetry.enqueue({
        ts: now + i,
        kind: "metric",
        data: {
          modelId: "claude-haiku-4-5",
          difficulty: "standard",
          language: "ts",
          passed: false,
          phase: "first_pass",
        },
      });
    }
    telemetry.flush();
    const telemetryPort = bindTelemetryDbRepo(telemetry);
    const observations = passObservationsFromTelemetry(telemetryPort.readPage({ limit: 50 }));
    expect(observations).toHaveLength(20);

    codeIndex.upsertCommit({ commitSha: "abc123", builtAt: 200, files: 1 });
    codeIndex.putFileRank({ commitSha: "abc123", path: "src/orders.ts", score: 0.42 });
    const codeIndexPort = bindCodeIndexRepo(codeIndex);
    const ranks = codeIndexPort.fileRanksForCommit("abc123");
    expect(ranks).toEqual([{ path: "src/orders.ts", score: 0.42 }]);

    const ledger = bindBudgetLedger(stateDb);
    ledger.registerCurrency("usd");
    ledger.createBudgetScope({
      scopeKind: "project",
      scopeId: "P-C40",
      currency: "usd",
      limitUnits: 1_000_000,
    });
    ledger.createBudgetScope({
      scopeKind: "task",
      scopeId: "T-orders",
      currency: "usd",
      limitUnits: 100,
      parentKind: "project",
      parentId: "P-C40",
    });
    const budgetPort = bindBudgetLedgerRepo(ledger);

    const roster = VersionedModelRoster.defaultSeed();
    const calibrator = HistoricalPassRateCalibrator.fromRoster(roster, observations);
    const selector = new ExpectedCostLevelSelector(roster, calibrator);
    const features = featuresFromGraphTask(
      {
        id: "T-orders",
        primaryFiles: ["src/orders.ts", "src/routes.ts"],
        mustBandTokens: 4_000,
        touches: ["concurrent_edit"],
      },
      ranks,
      "ts",
    );
    const assignment = selector.select(
      selectionInput(features, "budget", "micro-usd", {
        paidFallbackApproved: true,
        connections,
        budget: budgetPort,
        budgetScope: { scopeKind: "task", scopeId: "T-orders" },
      }),
    );
    expect(assignment.status).toBe("assigned");
    expect(assignment.connectionId).toBe("anthropic-api");
    expect(assignment.modelId).not.toBe("gpt-4.1-mini");
    expect(assignment.budgetShortfall).toBe(true);
  });

  it("binds Task 107 claim, hold, and write-scope ports onto TaskLeaseManager, TaskHoldAndSubmissionRepo, and DeterministicGraphCompiler", () => {
    const rootDir = makeTempDir("ef-c40-107-");
    const stateDb = openProjectStateDb({ projectId: "C40Db107", rootDir });
    closers.push(() => {
      if (!stateDb.isClosed()) stateDb.close();
    });

    stateDb.writer.run(
      "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES ('CS-1', 1, 'kernel', 'tester', 0)",
    );
    for (const [id, kind, fields] of [
      ["F1", "feature", '{"feature":"F1"}'],
      ["F2", "feature", '{"feature":"F2"}'],
      ["T-1", "task", '{"feature":"F1"}'],
      ["T-2", "task", '{"feature":"F2"}'],
    ] as const) {
      stateDb.writer.run(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
         VALUES (?, ?, 1, ?, ?, '', ?, 'CS-1', 1, 1)`,
        [id, kind, `sha256:${id}`, id, fields],
      );
    }
    stateDb.writer.run(
      "INSERT INTO task_runtime(task, feature, state, level, epoch, updated_rev) VALUES ('T-1', 'F1', 'READY', 'Mid', 0, 1)",
    );
    stateDb.writer.run(
      "INSERT INTO task_runtime(task, feature, state, level, epoch, updated_rev) VALUES ('T-2', 'F2', 'READY', 'Senior', 0, 1)",
    );

    const leases = bindTaskLeases(stateDb);
    const holdsRepo = bindTaskHolds(stateDb);
    const claimsPort = bindTaskClaimManager(leases);
    const holdsPort = bindTaskHoldsManager(holdsRepo);

    holdsPort.placeHold({
      task: "T-2",
      reason: "requirement_change",
      source: "CS-2",
      now: 10,
    });
    expect(holdsPort.isTaskHeld("T-2")).toBe(true);
    expect(holdsPort.listActiveHolds("T-2")).toEqual([
      {
        taskId: "T-2",
        reason: "requirement_change",
        source: "CS-2",
        createdAtMs: 10,
      },
    ]);

    const graph = {
      tasks: [
        task({
          id: "T-1",
          featureId: "F1",
          featureSlug: "f-one",
          difficulty: "standard",
          writeScope: ["src/f1/**"],
          avgExecTimeMs: 90_000,
        }),
        task({
          id: "T-2",
          featureId: "F2",
          featureSlug: "f-two",
          difficulty: "critical",
          riskTags: ["auth"],
          writeScope: ["src/f2/**"],
          avgExecTimeMs: 60_000,
        }),
      ],
    };

    const batch = dispatchReady(
      createScheduleState({
        graph,
        preset: "Balanced",
        hardwarePoolCap: 4,
        worktreeSlotCap: 4,
      }),
      { claims: claimsPort, holds: holdsPort },
    );
    expect(batch.admissions.map((a) => a.taskId)).toEqual(["T-1"]);
    const admitted = batch.admissions[0];
    expect(admitted?.level).toBe("Senior");
    expect(admitted?.modelId).toBe("claude-sonnet-4-6");

    const attemptRow = stateDb.writer.get(
      "SELECT model, task FROM attempts WHERE id = ?",
      [admitted?.attemptId ?? ""],
    ) as { model: string; task: string } | undefined;
    expect(attemptRow).toEqual({
      task: "T-1",
      model: "claude-sonnet-4-6",
    });

    holdsPort.releaseHold({
      task: "T-2",
      reason: "requirement_change",
      source: "CS-2",
      now: 20,
    });
    expect(holdsPort.isTaskHeld("T-2")).toBe(false);

    const compiler = new DeterministicGraphCompiler();
    expect(writeScopesOverlap(["src/api/**"], ["src/api/orders.ts"], compiler)).toBe(true);
    expect(writeScopesOverlap(["src/Order.ts"], ["src/order.ts"], compiler)).toBe(true);
    expect(writeScopesOverlap(["src/f1/**"], ["src/f2/**"], compiler)).toBe(false);

    const overlapGraph = {
      tasks: [
        task({ id: "A", featureId: "f1", featureSlug: "f1", writeScope: ["src/shared/**"] }),
        task({ id: "B", featureId: "f2", featureSlug: "f2", writeScope: ["src/shared/orders.ts"] }),
      ],
    };
    const diags = validateDisjointScheduleWriteScopes(overlapGraph, compiler);
    expect(diags.some((d) => d.code === "parallel_write_overlap")).toBe(true);
  });
});
