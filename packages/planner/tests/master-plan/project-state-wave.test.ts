import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DeterministicGraphCompiler,
  FeaturePlanDatabase,
  FeaturePlanningSession,
  MasterPlanOrchestrator,
  MasterPlanStore,
  persistCompiledGraph,
} from "../../src/index.js";
import { createKitchenAppWavePlan } from "../../src/graph-compiler/kitchen-plan.js";
import { usdDecimalToMicroUnits } from "../../src/master-plan/integer-budget.js";
import type { MustBandOversizeRefusal } from "../../src/slicer/types.js";
import { sessionInput } from "../feature-plan/fixture.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDb(): string {
  const root = mkdtempSync(join(tmpdir(), "ef-c37-wave-"));
  roots.push(root);
  return join(root, "state.db");
}

function walkCycles(edges: readonly { src: string; dst: string }[]): boolean {
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const list = next.get(edge.src) ?? [];
    list.push(edge.dst);
    next.set(edge.src, list);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of next.get(id) ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of next.keys()) {
    if (visit(id)) return true;
  }
  return false;
}

describe("C37 project state wave", () => {
  const orchestrator = new MasterPlanOrchestrator({ clock: () => 1_700_000_000_000 });

  it("plans two features, seals checks, and compiles an acyclic wave into ProjectStateDb", async () => {
    const store = MasterPlanStore.open(tempDb());
    const features = [
      { id: "F-A", title: "Walking skeleton", dependsOn: [], verticalSlice: true, specItems: 2 },
      { id: "F-B", title: "Follows A", dependsOn: ["F-A"], specItems: 1 },
    ];
    const plan = orchestrator.commit(store, {
      projectId: "kitchen",
      architecture: {
        schema: "system-architect@1",
        projectId: "kitchen",
        projectKind: "web_saas",
        featureIds: ["F-A", "F-B"],
      },
      features,
      budget: { currency: "usd", totalUnits: usdDecimalToMicroUnits("$2.00") },
      parallelism: { hardwareSlots: 2, providerSlots: 2 },
      createdAt: 1_700_000_000_000,
    });
    expect(plan.brownfield).toBe(false);
    expect(plan.projectKind).toBe("web_saas");
    expect(plan.allocation.paperworkUnits * 5n).toBeLessThanOrEqual(plan.totalUnits);
    const featureRows = store.state.writer.all(
      "SELECT id, kind FROM nodes WHERE kind = 'feature' ORDER BY id",
    ) as { id: string; kind: string }[];
    expect(featureRows.map((row) => row.id)).toEqual(["F-A", "F-B"]);
    const deps = store.state.writer.all(
      "SELECT src, dst FROM edges WHERE type = 'depends_on' AND valid_to_rev IS NULL",
    ) as { src: string; dst: string }[];
    expect(deps).toEqual(expect.arrayContaining([{ src: "F-B", dst: "F-A" }]));
    expect(walkCycles(deps)).toBe(false);
    const projectBudget = store.state.writer.get(
      "SELECT scope_kind, parent_kind FROM budgets WHERE scope_kind = 'project' AND scope_id = 'kitchen'",
    ) as { scope_kind: string; parent_kind: string | null };
    expect(projectBudget.parent_kind).toBeNull();
    const childProject = store.state.writer.get(
      "SELECT COUNT(*) AS n FROM budgets WHERE scope_kind = 'project' AND parent_kind IS NOT NULL",
    ) as { n: number };
    expect(Number(childProject.n)).toBe(0);

    const featureDb = FeaturePlanDatabase.fromState(store.state);
    const input = sessionInput();
    const session = new FeaturePlanningSession(featureDb);
    await session.planAndSeal(input);
    const sealed = session.store.listSealedForFeatures([input.featureId]);
    expect(sealed.length).toBeGreaterThanOrEqual(3);
    for (const row of sealed) {
      const node = featureDb.getNode(row.id);
      expect(node?.kind).toBe("check");
      expect(node?.text).toBe("");
      expect(node?.fields.visibility).toBe("held_back");
      expect(node?.text.includes(row.contentJson)).toBe(false);
    }

    const compiled = persistCompiledGraph(store.state, createKitchenAppWavePlan());
    expect(compiled.ok).toBe(true);
    const taskDeps = store.state.writer.all(
      `SELECT e.src, e.dst FROM edges e
         JOIN nodes s ON s.id = e.src AND s.kind = 'task'
         JOIN nodes d ON d.id = e.dst AND d.kind = 'task'
        WHERE e.type = 'depends_on' AND e.valid_to_rev IS NULL`,
    ) as { src: string; dst: string }[];
    expect(walkCycles(taskDeps)).toBe(false);
    const held = store.state.writer.get(
      "SELECT text FROM nodes WHERE id = 'CHK-ORDERS-SEALED'",
    ) as { text: string };
    expect(held.text).toBe("");
    store.close();
  });

  it("refuses a wave that is missing sealed checks or whose must band does not fit", () => {
    const compiler = new DeterministicGraphCompiler();
    const plan = createKitchenAppWavePlan();
    const missing = compiler.compileFeatureWave({
      ...plan,
      checks: plan.checks.filter((check) => check.visibility !== "sealed"),
    });
    expect(missing.ok).toBe(false);
    expect(missing.diagnostics.map((item) => item.code)).toContain("missing_feature_sealed_check");
    const refusal: MustBandOversizeRefusal = {
      code: "MustBandOversizeRefusal",
      taskId: plan.tasks[0]?.id ?? "T",
      tier: "Junior",
      level: "junior",
      mustTokens: 9_000,
      ceiling: 3_000,
      attribution: [],
      recommendations: [{ action: "split", estimatedUsd: 0 }],
      summary: "must band does not fit",
    };
    const refused = new DeterministicGraphCompiler({
      slicer: { measureMust: () => refusal },
    }).compileFeatureWave(plan);
    expect(refused.ok).toBe(false);
    expect(refused.diagnostics.map((item) => item.code)).toContain("oversized_must");
    expect(compiler.validateDisjointWriteScopes(plan)).toEqual([]);
  });
});
