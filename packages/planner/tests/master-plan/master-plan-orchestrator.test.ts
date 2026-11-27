import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ENVELOPE_IDS,
  MasterPlanError,
  MasterPlanOrchestrator,
  MasterPlanStore,
  usdDecimalToMicroUnits,
  validateMasterPlan,
} from "../../src/master-plan/index.js";
import type { FeatureInput, MasterPlanRequest } from "../../src/master-plan/index.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDb(): string {
  const root = mkdtempSync(join(tmpdir(), "ef-master-plan-"));
  roots.push(root);
  return join(root, "state.db");
}

function chain(): FeatureInput[] {
  return [
    { id: "F-A", title: "Walking skeleton", dependsOn: [], verticalSlice: true, specItems: 2, screens: 1, endpoints: 1 },
    { id: "F-B", title: "Depends on A", dependsOn: ["F-A"], specItems: 1 },
    { id: "F-C", title: "Depends on B", dependsOn: ["F-B"], specItems: 4, screens: 2, endpoints: 1 },
  ];
}

function request(kind: MasterPlanRequest["architecture"]["projectKind"], extra: Partial<MasterPlanRequest> = {}): MasterPlanRequest {
  const features = extra.features ?? chain();
  return {
    projectId: "kitchen",
    architecture: {
      schema: "system-architect@1",
      projectId: "kitchen",
      projectKind: kind,
      featureIds: features.map((feature) => feature.id),
    },
    features,
    budget: { currency: "usd", totalUnits: usdDecimalToMicroUnits("$2.00") },
    parallelism: { hardwareSlots: 4, providerSlots: 3 },
    createdAt: 1_700_000_000_000,
    ...extra,
    architecture: extra.architecture ?? {
      schema: "system-architect@1",
      projectId: "kitchen",
      projectKind: kind,
      featureIds: features.map((feature) => feature.id),
    },
    features: extra.features ?? features,
  };
}

describe("MasterPlanOrchestrator", () => {
  const orchestrator = new MasterPlanOrchestrator({ clock: () => 1_700_000_000_000 });

  it("plans a web SaaS with serial phase 0, topological waves, and an exact $2 envelope", () => {
    const plan = orchestrator.plan(request("web_saas"));
    expect(plan.phase0.map((recipe) => recipe.id)).toEqual([
      "P0.1",
      "P0.2",
      "P0.3",
      "P0.4",
      "P0.5",
      "P0.6",
      "P0.7",
      "P0.8",
    ]);
    expect(plan.phase0[0]?.stage).toBe("serial");
    expect(plan.phase0.slice(1).every((recipe) => recipe.stage === "parallel" && recipe.dependsOn[0] === "P0.1")).toBe(
      true,
    );
    expect(plan.waves.map((wave) => wave.featureIds)).toEqual([["F-A"], ["F-B"], ["F-C"]]);
    expect(plan.waves[1]?.status).toBe("projected");
    expect(plan.waves[1]?.leafTasks).toEqual([]);
    expect(plan.waves[2]?.leafTasks).toEqual([]);
    expect(plan.completionWave.ownerTask).toBe("101");
    expect(plan.breadthCap).toBe(3);
    expect(plan.allocation.totalUnits).toBe(2_000_000n);
    expect(plan.allocation.envelopes.research).toBe(60_000n);
    expect(plan.allocation.envelopes.architecture).toBe(100_000n);
    expect(plan.allocation.envelopes.planning).toBe(120_000n);
    expect(plan.allocation.envelopes.integration_review).toBe(80_000n);
    expect(plan.allocation.envelopes.final_audit).toBe(40_000n);
    expect(plan.allocation.buildUnits).toBe(1_600_000n);
    expect(plan.allocation.paperworkUnits + plan.allocation.buildUnits).toBe(plan.totalUnits);
    expect(plan.walkingSkeletonFeatureId).toBe("F-A");
  });

  it("skips P0.4 and P0.8 for a headless CLI and P0.1 for brownfield", () => {
    const cli = orchestrator.plan(request("headless_cli"));
    expect(cli.phase0.map((recipe) => recipe.id)).toEqual(["P0.1", "P0.2", "P0.5", "P0.6", "P0.7"]);
    const brownfield = orchestrator.plan(request("brownfield"));
    expect(brownfield.phase0.map((recipe) => recipe.id)).toEqual(["P0.B1", "P0.B2"]);
    expect(brownfield.phase0.some((recipe) => recipe.id === "P0.1")).toBe(false);
    expect(brownfield.phase0.every((recipe) => !recipe.writeScope.includes("package.json"))).toBe(true);
  });

  it("rejects an unscheduled feature map entry and premature wave 2+ leaf tasks before commit", () => {
    const dbPath = tempDb();
    const store = MasterPlanStore.open(dbPath);
    const missing = request("web_saas", {
      architecture: {
        schema: "system-architect@1",
        projectId: "kitchen",
        projectKind: "web_saas",
        featureIds: ["F-A", "F-B", "F-C", "F-Missing"],
      },
    });
    expect(() => orchestrator.commit(store, missing)).toThrow(expect.objectContaining({ code: "unscheduled_feature" }));
    const leaves = Array.from({ length: 40 }, (_, index) => ({ id: `T-${index}` }));
    expect(() => orchestrator.plan(request("web_saas", { proposedLeafTasks: { 3: leaves } }))).toThrow(
      expect.objectContaining({ code: "premature_wave_leaf_tasks" }),
    );
    expect(() =>
      orchestrator.plan(
        request("web_saas", {
          modelOutput: { waves: [{ index: 3, status: "projected", leaf_tasks: leaves }] },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "premature_wave_leaf_tasks" }));
    expect(store.loadLatest("kitchen")).toBeNull();
    store.close();
  });

  it("rejects a hand-built plan that drops a feature or adds wave 3 leaves", () => {
    const plan = orchestrator.plan(request("web_saas"));
    const dropped = {
      ...plan,
      features: plan.features.filter((feature) => feature.id !== "F-C"),
      waves: plan.waves.map((wave) =>
        wave.index === 3 ? { ...wave, featureIds: [], weightTasks: 1, projected: wave.projected } : wave,
      ),
    };
    expect(() => validateMasterPlan(dropped)).toThrow(MasterPlanError);
    const premature = {
      ...plan,
      waves: plan.waves.map((wave) => (wave.index === 3 ? { ...wave, leafTasks: Array.from({ length: 40 }, (_, index) => ({ id: `L${index}` })) } : wave)),
    };
    expect(() => validateMasterPlan(premature)).toThrow(expect.objectContaining({ code: "premature_wave_leaf_tasks" }));
  });

  it("commits the checkpoint atomically and reloads it after the store is reopened", () => {
    const dbPath = tempDb();
    const store = MasterPlanStore.open(dbPath);
    const plan = orchestrator.commit(store, request("web_saas"));
    const summary = store.summary(plan.planId);
    expect(summary.phase0Tasks).toBe(8);
    expect(summary.assignments).toBe(3);
    expect(summary.waves).toBe(5);
    expect(summary.storedLeafTasks).toBe(0);
    expect(summary.envelopes).toBe(plan.allocation.buckets.length * ENVELOPE_IDS.length);
    expect(summary.budgetScopes).toBeGreaterThan(0);
    const totals = store.envelopeTotals(plan.planId);
    for (const id of ENVELOPE_IDS) {
      expect(totals[id]).toBe(plan.allocation.envelopes[id]);
    }
    store.close();
    const reopened = MasterPlanStore.open(dbPath);
    expect(reopened.loadLatest("kitchen")).toEqual(plan);
    expect(orchestrator.resume(reopened, "kitchen")).toEqual(plan);
    reopened.close();
  });

  it("rolls back a partial checkpoint when a commit phase fails", () => {
    const dbPath = tempDb();
    const store = MasterPlanStore.open(dbPath);
    const plan = orchestrator.plan(request("web_saas"));
    expect(() =>
      store.commit(plan, {
        onPhase: (phase) => {
          if (phase === "feature_wave_assignments") throw new Error("boom");
        },
      }),
    ).toThrow(/boom/);
    expect(store.loadLatest("kitchen")).toBeNull();
    expect(store.summary(plan.planId).waves).toBe(0);
    expect(store.summary(plan.planId).assignments).toBe(0);
    expect(store.summary(plan.planId).phase0Tasks).toBe(0);
    expect(store.summary(plan.planId).envelopes).toBe(0);
    store.close();
    const reopened = MasterPlanStore.open(dbPath);
    expect(reopened.loadLatest("kitchen")).toBeNull();
    reopened.close();
  });

  it("treats state.db active features from the knowledge-graph port as required", () => {
    expect(() =>
      orchestrator.plan(
        request("api", {
          graph: { listActiveFeatureIds: () => ["F-A", "F-B", "F-C", "F-DB"] },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "unscheduled_feature" }));
  });
});
