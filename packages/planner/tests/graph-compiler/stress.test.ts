import { describe, expect, it } from "vitest";
import {
  compilationInputFromKnowledgeGraph,
  DeterministicGraphCompiler,
} from "../../src/graph-compiler/index.js";
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from "../../src/graph-compiler/index.js";

describe("graph compiler stress and knowledge-graph port", () => {
  it("compiles 500 tasks across 20 features in under 100 ms", () => {
    const features = Array.from({ length: 20 }, (_, featureIndex) => ({
      id: `F${String(featureIndex).padStart(2, "0")}`,
      title: `Feature ${featureIndex}`,
      dependsOn: featureIndex === 0 ? [] : [`F${String(featureIndex - 1).padStart(2, "0")}`],
      active: true,
    }));
    const tasks = [];
    const requirements = [];
    const checks = [];
    for (const feature of features) {
      checks.push({
        id: `CHK-${feature.id}-SEALED`,
        featureId: feature.id,
        requirementIds: [`REQ-${feature.id}-00`],
        visibility: "sealed" as const,
      });
      for (let taskIndex = 0; taskIndex < 25; taskIndex += 1) {
        const suffix = String(taskIndex).padStart(2, "0");
        const taskId = `T-${feature.id}-${suffix}`;
        const requirementId = `REQ-${feature.id}-${suffix}`;
        const file = `src/${feature.id}/t${suffix}.ts`;
        tasks.push({
          id: taskId,
          featureId: feature.id,
          title: `Implement ${taskId}`,
          taskKind: "leaf" as const,
          level: "junior" as const,
          writeScope: [file],
          primaryFiles: [file],
          responsibilities: [`Implement ${taskId}`],
          touches: [],
          mustBandTokens: 100,
          mustTokenAttribution: [{ nodeId: requirementId, tokens: 100 }],
          mustBandRuleIds: [],
          implements: [requirementId],
          obeys: [],
          handlesEdgeCases: [],
          dependsOn: [],
          names: [],
          mutatesSharedContract: false,
          createsMigration: false,
          migrationIntentSlot: null,
          estimatedMinCostMicroUsd: 10,
          generatedScaffold: false,
        });
        requirements.push({
          id: requirementId,
          featureId: feature.id,
          title: requirementId,
          kind: "spec_item" as const,
          active: true,
          risk: "low" as const,
          sensitivities: [],
          waived: false,
          waiverApprovedBy: null,
          waiverReason: null,
        });
        checks.push({
          id: `CHK-${taskId}`,
          featureId: feature.id,
          requirementIds: [requirementId],
          visibility: "visible" as const,
        });
      }
    }
    const input = {
      tasks,
      features,
      requirements,
      checks,
      contradictions: [],
      brownfieldNames: [],
      mustAsk: [],
      budget: { remainingProjectMicroUsd: 50_000_000, remainingWaveMicroUsd: 20_000_000 },
      waivers: [],
      sharedContractOwnerTaskIds: [],
      platform: "windows" as const,
      planEpoch: 1,
      compiledAt: "2026-11-20T12:00:00.000Z",
    };
    const graphCompiler = new DeterministicGraphCompiler();
    // The first call pays runtime warmup. The budget is the steady-state 9-pass compile.
    graphCompiler.compile(input);
    const result = graphCompiler.compile(input);
    expect(result.ok).toBe(true);
    expect(result.elapsedMs).toBeLessThan(100);
    if (result.ok) expect(result.snapshot.tasks).toHaveLength(500);
  });

  it("projects a Task 017 knowledge-graph snapshot into a passing plan", () => {
    const nodes: KnowledgeGraphNode[] = [
      {
        id: "F1",
        kind: "feature",
        title: "Notes",
        status: "active",
        feature: null,
        fields: {},
      },
      {
        id: "REQ-1",
        kind: "spec_item",
        title: "Save a note",
        status: "active",
        feature: "F1",
        fields: { risk: "low", sensitivities: [], waived: false },
      },
      {
        id: "T1",
        kind: "task",
        title: "Save a note",
        status: "active",
        feature: "F1",
        fields: {
          task_kind: "leaf",
          level: "junior",
          write_scope: ["src/notes/save.ts"],
          primary_files: ["src/notes/save.ts"],
          responsibilities: ["Save a note"],
          touches: ["route", "authz"],
          must_band_tokens: 300,
          must_token_attribution: [{ nodeId: "REQ-1", tokens: 300 }],
          must_band_rule_ids: ["X-01", "X-11"],
          names: [{ kind: "http_route", value: "POST /api/notes", method: null }],
          mutates_shared_contract: false,
          creates_migration: false,
          estimated_min_cost_micro_usd: 100,
          generated_scaffold: false,
        },
      },
      {
        id: "CHK-1",
        kind: "check",
        title: "Visible save",
        status: "active",
        feature: "F1",
        fields: { visibility: "visible" },
      },
      {
        id: "CHK-1-SEALED",
        kind: "check",
        title: "Sealed save",
        status: "active",
        feature: "F1",
        fields: { visibility: "sealed" },
      },
    ];
    const edges: KnowledgeGraphEdge[] = [
      { src: "T1", type: "implements", dst: "REQ-1", resolved: false },
      { src: "CHK-1", type: "verifies", dst: "REQ-1", resolved: false },
      { src: "CHK-1-SEALED", type: "verifies", dst: "REQ-1", resolved: false },
    ];
    const input = compilationInputFromKnowledgeGraph(
      { listNodes: () => nodes, listEdges: () => edges },
      {
        budget: { remainingProjectMicroUsd: 1_000_000, remainingWaveMicroUsd: 1_000_000 },
        waivers: [],
        mustAsk: [],
        brownfieldNames: [],
        sharedContractOwnerTaskIds: [],
        platform: "windows",
        planEpoch: 2,
        compiledAt: "2026-11-20T12:00:00.000Z",
      },
    );
    const result = new DeterministicGraphCompiler().compile(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.tasks.map((task) => task.taskId)).toEqual(["T1"]);
    }
  });
});
