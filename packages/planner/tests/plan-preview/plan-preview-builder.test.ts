import { describe, expect, it } from "vitest";
import {
  PAPERWORK_LINE,
  PlanPreviewBuilder,
  PlanPreviewError,
  createPlanRequest,
  type PlanPreview,
} from "../../src/plan-preview/index.js";
import { collectStrings, plannedTask, samplePlan } from "./fixtures.js";

function taskById(preview: PlanPreview, id: string) {
  return [...preview.phase0.tasks, ...preview.wave1.tasks].find((task) => task.id === id);
}

describe("PlanPreviewBuilder", () => {
  const builder = new PlanPreviewBuilder();

  it("separates exact Phase 0 + Wave 1 from projected ranges", () => {
    const preview = builder.build(samplePlan());
    expect(preview.phase0.steps.map((step) => step.step)).toEqual([
      "P0.1",
      "P0.2",
      "P0.3",
      "P0.4",
      "P0.5",
      "P0.6",
      "P0.7",
      "P0.8",
    ]);
    expect(preview.phase0.precision).toBe("exact");
    expect(preview.wave1.precision).toBe("exact");
    const schema = taskById(preview, "P0-schema");
    const copy = taskById(preview, "W1-copy");
    expect(schema).toMatchObject({
      phase: "phase0",
      phase0Step: "P0.1",
      crewLevel: "Senior",
      writeScope: ["schema/**"],
      precision: "exact",
      wave: 0,
    });
    expect(copy).toMatchObject({
      phase: "wave1",
      phase0Step: null,
      crewLevel: "Mid",
      writeScope: ["packages/app/src/copy/**"],
      precision: "exact",
      wave: 1,
    });
    expect(preview.phase0.steps[1]?.tasks).toEqual([]);
    expect(preview.projected.label).toBe("Projected");
    expect(preview.projected.precision).toBe("range");
    expect(preview.projected.waves.map((wave) => wave.featureId)).toEqual(["F-AdminEmail", "F-Auth", "F-Orders"]);
    expect(preview.projected.waves.every((wave) => wave.label === "Projected" && wave.precision === "range")).toBe(true);
    expect(preview.projected.waves[0]?.summary).toBe(
      "Wave 2: Admin & Catering Email — ~6–9 tasks, ~$0.60–$1.10 (planned in detail after Wave 1 finishes)",
    );
    expect(preview.projected.completion?.summary).toBe(
      "Completion Wave: Final audit — ~2–4 tasks, ~$0.20–$0.40 (planned in detail after Wave 1 finishes)",
    );
    expect(preview.projected.completion?.label).toBe("Projected");
    expect(preview.startBuild).toEqual({ label: "Start build", requiresExplicitClick: true, autoStart: false });
    expect(preview.llmCalls).toBe(0);
    expect(preview.heft.criticalPathMinutes).toBeGreaterThan(0);
    expect(preview.heft.parallelSpeedupFactor).toBeGreaterThan(0);
    expect(preview.heft.activeSlotsByTime.length).toBeGreaterThan(0);
    expect(preview.wallClockLabel).toMatch(/^~\d+ min with \d+ parallel workers? vs ~\d+ min sequential$/);
    expect(preview.costLabel).toBe(`Estimated ~${preview.plannedCostLabel.slice(1)} (from published token rates)`);
    expect(preview.costLabel.startsWith("Estimated ~$")).toBe(true);
  });

  it("shows the 20% paperwork envelope and every delegated, defaulted, and deferred item", () => {
    const preview = builder.build(samplePlan());
    expect(preview.paperwork.line).toBe(PAPERWORK_LINE);
    expect(preview.paperwork.line).toBe(
      "Research 3% · Arch 5% · Plan/Oracles 6% · Integration/Review 4% · Audit 2%",
    );
    expect(preview.paperwork.capPpm).toBe(200_000);
    expect(preview.paperwork.allocatedPpm).toBe(200_000);
    expect(preview.paperwork.withinCap).toBe(true);
    expect(preview.paperwork.envelopes.map((envelope) => [envelope.label, envelope.percentLabel, envelope.ppm])).toEqual([
      ["Research", "3%", 30_000],
      ["Arch", "5%", 50_000],
      ["Plan/Oracles", "6%", 60_000],
      ["Integration/Review", "4%", 40_000],
      ["Audit", "2%", 20_000],
    ]);
    const reserved = preview.paperwork.envelopes.reduce((sum, envelope) => sum + envelope.reservedUnits, 0n);
    expect(reserved).toBe(2_000_000n);
    expect(preview.paperwork.envelopes[0]?.reservedUnits).toBe(300_000n);
    expect(preview.chosenForYou.count).toBe(3);
    expect(preview.chosenForYou.clickable).toBe(true);
    expect(preview.chosenForYou.visibleBeforeStartBuild).toBe(true);
    expect(preview.chosenForYou.watchLabel).toBe("⚑ 3 choices made for you");
    expect(preview.chosenForYou.entries.map((entry) => entry.basis).sort()).toEqual([
      "defaulted",
      "delegated",
      "delegated",
    ]);
    for (const entry of preview.chosenForYou.entries) {
      expect(entry.visibleBeforeStartBuild).toBe(true);
      expect(entry.change).toMatchObject({ label: "Change", route: "revision", task: "Task-087" });
      expect(entry.override).toMatchObject({ label: "Override", route: "revision", task: "Task-087" });
      expect(entry.criterionLabel.length).toBeGreaterThan(0);
      expect(entry.chosenValue.length).toBeGreaterThan(0);
      expect(entry.rationale.length).toBeGreaterThan(0);
    }
    expect(preview.deferred).toEqual([
      {
        decisionId: "dec-polish",
        criterionId: "polish-motion",
        label: "Reduced-motion polish",
        deferredReason: "Optional visual polish",
        revisitWave: "wave-3",
      },
    ]);
  });

  it("labels subscription plans as a share of the 5-hour allowance", () => {
    const preview = builder.build(samplePlan({ connection: "subscription" }));
    expect(preview.costLabel).toMatch(/^Estimated ~\d+(\.\d+)?% of 5-hour allowance$/);
    const strings = collectStrings(preview);
    expect(strings.some((value) => value.includes("$"))).toBe(false);
    expect(strings.some((value) => value.includes("published token rates"))).toBe(false);
    expect(preview.wave1.tasks.every((task) => task.microUsd === null && task.windowPpm !== null)).toBe(true);
  });

  it("rejects a projected wave that pretends to have a single precise size", () => {
    const request = samplePlan();
    const projected = request.projected.map((feature) =>
      feature.featureId === "F-AdminEmail"
        ? { ...feature, taskCount: { min: 9, max: 6 } }
        : feature,
    );
    expect(() => builder.build({ ...request, projected })).toThrow(PlanPreviewError);
  });

  it("rejects a Phase 0 task with no P0 step", () => {
    const request = createPlanRequest({
      projectId: "cli",
      connection: "api",
      totalBudgetMicroUsd: 1_000_000n,
      totalBudgetPpm: 1_000_000,
      tasks: [plannedTask({ id: "P-missing", title: "Missing", phase: "phase0" })],
    });
    expect(() => builder.build(request)).toThrow(/P0\.1–P0\.8/);
  });
});
