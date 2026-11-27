import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bindKnowledgeGraph, openProjectStateDb } from "@ef-harness/db";
import { DiscoverySessionCoordinator, type DepthCatalogEntry, type ProjectStage } from "@ef-harness/discovery";
import { releaseSpecExpansionZ3, solveSchedule } from "../../src/contradictions/z3-wasm.js";
import { kitchenMealOrderingGraph } from "../../src/generators/fixtures.js";
import {
  FiveLayerContradictionChecker,
  SpecCellFiller,
  SpecMatrixGenerator,
} from "../../src/project-state.js";

const closers: Array<() => Promise<void> | void> = [];
const dirs: string[] = [];

afterEach(async () => {
  await releaseSpecExpansionZ3();
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

describe("spec expansion over ProjectStateDb", () => {
  it("keeps the deterministic schedule solver for stubs that disable WASM", async () => {
    const solved = await solveSchedule(
      [
        { id: "c0", nodeId: "print", key: "kitchen_print", minutes: 10 * 60 + 45 },
        { id: "c1", nodeId: "cutoff", key: "order_cutoff", minutes: 11 * 60 },
      ],
      { disableWasm: true },
    );
    expect(solved.backend).toBe("deterministic");
    expect(solved.status).toBe("unsat");
    expect(solved.unsatCore).toEqual(["cutoff", "print"]);
  });

  it("expands discovery decisions and catches a cutoff contradiction with Z3", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c31-spec-"));
    dirs.push(rootDir);
    const stateDb = openProjectStateDb({ projectId: "C31Spec", rootDir });
    const coordinator = new DiscoverySessionCoordinator({ stateDb, now: () => 1_700_000_000_000 });
    closers.unshift(async () => {
      await coordinator.close();
      if (!stateDb.isClosed()) stateDb.close();
    });

    const workItemId = "W-schedule";
    coordinator.startSession({
      workItemId,
      title: "Kitchen schedule",
      stage: "prototype",
      catalog: [
        entry("schedule.cutoff", "When do orders stop?", "11:00 AM"),
        entry("schedule.print", "When does the kitchen print?", "10:45 AM"),
      ],
    });
    const observed = coordinator.preSettleObservedCriteria({
      workItemId,
      settlements: [
        { criterionId: "schedule.cutoff", value: "11:00 AM" },
        { criterionId: "schedule.print", value: "10:45 AM" },
      ],
    });
    expect(observed.settledCriterionIds).toEqual(["schedule.cutoff", "schedule.print"]);
    await coordinator.close();

    const repo = bindKnowledgeGraph(stateDb);
    repo.commitChangeSet({
      origin: "kernel",
      author: "spec-expansion",
      summary: "proposed note stays proposed",
      nodes: [
        {
          op: "create",
          id: "decision:W-schedule:schedule.note",
          kind: "decision",
          title: "Note",
          text: "Note",
          status: "active",
          fields: {
            criterion: "schedule.note",
            criterionId: "schedule.note",
            status: "settled",
            value: "later",
            basis: "proposed",
            work_item: workItemId,
            groupId: "workflow",
            selectedOptionId: "later",
          },
        },
      ],
    });

    const generator = new SpecMatrixGenerator(stateDb);
    const generated = generator.generateMatrices(workItemId, kitchenMealOrderingGraph());
    expect(generated.ruleCount + generated.cellCount).toBeGreaterThan(0);
    expect(generated.expands).toBeGreaterThan(0);

    const filler = new SpecCellFiller(stateDb);
    const materialized = filler.materialize(workItemId);
    expect(materialized.expandedDecisionIds).toEqual([
      "decision:W-schedule:schedule.cutoff",
      "decision:W-schedule:schedule.print",
    ]);

    const cutoffId = "spec:W-schedule:schedule.cutoff";
    const printId = "spec:W-schedule:schedule.print";
    const noteId = "spec:W-schedule:schedule.note";
    const note = repo.getNode(noteId);
    expect(note?.status).toBe("draft");
    expect(record(note?.fields).basis).toBe("proposed");
    const requirements = stateDb.writer.prepare("SELECT id FROM requirements ORDER BY id").all() as { id: string }[];
    const requirementIds = new Set(requirements.map((row) => row.id));
    expect(requirementIds.has(cutoffId)).toBe(true);
    expect(requirementIds.has(printId)).toBe(true);
    expect(requirementIds.has(noteId)).toBe(false);
    expect(requirementIds.has("matrix-manifest")).toBe(false);

    const checker = new FiveLayerContradictionChecker(stateDb);
    const checked = await checker.check(workItemId);
    expect(checked.layer4.backend).toBe("z3-wasm");
    expect(checked.layer4.status).toBe("unsat");
    expect(checked.layer4.unsatCore).toEqual([cutoffId, printId]);
    expect(
      checked.contradicts.some(
        (edge) =>
          (edge.src === cutoffId && edge.dst === printId) || (edge.src === printId && edge.dst === cutoffId),
      ),
    ).toBe(true);

    const expands = stateDb.writer
      .prepare("SELECT src, dst FROM edges WHERE type = 'expands' AND valid_to_rev IS NULL AND src = :src")
      .all({ src: cutoffId }) as { src: string; dst: string }[];
    expect(expands.some((edge) => edge.dst === "decision:W-schedule:schedule.cutoff")).toBe(true);
    expect(generator.listCells(workItemId).length).toBe(generated.cellCount);
    expect(generator.listMaterializedRequirements(workItemId).some((item) => item.id === cutoffId)).toBe(true);
  }, 60_000);
});

function record(fields: unknown): Record<string, unknown> {
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) return {};
  return fields as Record<string, unknown>;
}

function entry(criterionId: string, label: string, optionId: string): DepthCatalogEntry {
  const stages: Record<ProjectStage, boolean> = { prototype: true, mvp: true, production: true };
  return {
    criterionId,
    label,
    riskTier: "low",
    reworkCost: "easy",
    downstreamTaskCount: 0,
    options: [
      { id: optionId, label: optionId },
      { id: "other", label: "Other" },
    ],
    recommendations: [
      { stage: "prototype", optionId, rationale: "Prototype recommendation.", safeForLowerStage: true },
      { stage: "mvp", optionId, rationale: "MVP recommendation.", safeForLowerStage: true },
      { stage: "production", optionId, rationale: "Production recommendation.", safeForLowerStage: false },
    ],
    stageApplicability: stages,
    strongConventionStages: ["prototype", "mvp"],
    evidenceSettled: false,
    mustAskClass: null,
    domain: "workflow",
    deploymentObvious: false,
    materialOptionDifference: false,
    conflict: false,
    highRiskSpecExpander: false,
    ambiguousBrownfield: false,
  };
}
