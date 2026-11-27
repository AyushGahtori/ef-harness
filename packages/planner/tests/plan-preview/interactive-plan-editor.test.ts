import { describe, expect, it } from "vitest";
import {
  InteractivePlanEditor,
  LocalCrewPresetProfileEngine,
  LocalHeftCriticalPathScheduler,
  LocalPaperworkEnvelopeAllocator,
  LocalRevisionImpactPreviewer,
  PRESET_RECOMPUTE_BUDGET_MS,
  type ImpactPreviewInput,
  type PlanPreviewSources,
  type RevisionImpactPreviewPort,
} from "../../src/plan-preview/index.js";
import { levelOf, plannedTask, samplePlan } from "./fixtures.js";

class CountingImpact implements RevisionImpactPreviewPort {
  readonly llmCalls = 0 as const;
  formats = 0;
  private readonly inner = new LocalRevisionImpactPreviewer();

  format(input: ImpactPreviewInput): string {
    this.formats += 1;
    return this.inner.format(input);
  }
}

function sources(impact: RevisionImpactPreviewPort = new LocalRevisionImpactPreviewer()): PlanPreviewSources {
  return {
    scheduler: new LocalHeftCriticalPathScheduler(),
    presets: new LocalCrewPresetProfileEngine(),
    paperwork: new LocalPaperworkEnvelopeAllocator(),
    impact,
  };
}

describe("InteractivePlanEditor", () => {
  it("switches Balanced to Cheapest locally, under 30 ms, with zero LLM calls", () => {
    const impact = new CountingImpact();
    const editor = new InteractivePlanEditor(samplePlan(), sources(impact));
    const before = editor.preview();
    const started = performance.now();
    const result = editor.switchPreset("Cheapest");
    const elapsed = performance.now() - started;
    expect(result.ok).toBe(true);
    expect(result.llmCalls).toBe(0);
    expect(impact.formats).toBe(0);
    expect(impact.llmCalls).toBe(0);
    expect(result.elapsedMs).toBeLessThan(PRESET_RECOMPUTE_BUDGET_MS);
    expect(elapsed).toBeLessThan(PRESET_RECOMPUTE_BUDGET_MS);
    expect(levelOf(before.wave1.tasks, "W1-copy")).toBe("Mid");
    expect(levelOf(before.wave1.tasks, "W1-auth")).toBe("Senior");
    expect(levelOf(result.preview.wave1.tasks, "W1-copy")).toBe("Junior");
    expect(levelOf(result.preview.wave1.tasks, "W1-auth")).toBe("Mid");
    const beforeCopy = before.wave1.tasks.find((task) => task.id === "W1-copy");
    const afterCopy = result.preview.wave1.tasks.find((task) => task.id === "W1-copy");
    expect(beforeCopy?.durationMinutes).toBe(10);
    expect(afterCopy?.durationMinutes).toBe(15);
    expect(beforeCopy?.costLabel).toBe("~$0.18");
    expect(afterCopy?.costLabel).toBe("~$0.10");
  });

  it("raises a critical-path task when the preset becomes Fastest", () => {
    const editor = new InteractivePlanEditor(
      samplePlan({
        tasks: [
          plannedTask({
            id: "W1-path",
            title: "Path",
            balancedLevel: "Junior",
            safetyFloor: "Junior",
            criticalPath: true,
            durationMinutes: 20,
          }),
        ],
      }),
    );
    const balanced = editor.preview();
    expect(levelOf(balanced.wave1.tasks, "W1-path")).toBe("Junior");
    const fastest = editor.switchPreset("Fastest");
    expect(levelOf(fastest.preview.wave1.tasks, "W1-path")).toBe("Mid");
    expect(fastest.preview.llmCalls).toBe(0);
    expect(fastest.elapsedMs).toBeLessThan(PRESET_RECOMPUTE_BUDGET_MS);
  });

  it("recomputes a wide wave locally inside the 30 ms budget", () => {
    const tasks = Array.from({ length: 80 }, (_unused, index) =>
      plannedTask({
        id: `W1-${index.toString()}`,
        title: `Task ${index.toString()}`,
        balancedLevel: "Mid",
        safetyFloor: "Junior",
        criticalPath: index === 0,
      }),
    );
    const editor = new InteractivePlanEditor(samplePlan({ tasks, projected: [], chosenForYou: [], deferred: [] }));
    const result = editor.switchPreset("Cheapest");
    expect(result.ok).toBe(true);
    expect(result.llmCalls).toBe(0);
    expect(result.elapsedMs).toBeLessThan(PRESET_RECOMPUTE_BUDGET_MS);
    expect(result.preview.wave1.tasks.every((task) => task.crewLevel === "Junior")).toBe(true);
  });

  it("refuses a tier below the Task 106 safety floor and accepts the floor", () => {
    const editor = new InteractivePlanEditor(samplePlan());
    const rejected = editor.overrideTaskTier("W1-auth", "Junior");
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toBe("Rejected: Mid safety floor (Task 106) — cannot assign Junior to Auth");
    expect(levelOf(rejected.preview.wave1.tasks, "W1-auth")).toBe("Senior");
    const featureRejected = editor.overrideFeatureTier("F-Auth", "Junior");
    expect(featureRejected.ok).toBe(false);
    const accepted = editor.overrideTaskTier("W1-auth", "Mid");
    expect(accepted.ok).toBe(true);
    expect(levelOf(accepted.preview.wave1.tasks, "W1-auth")).toBe("Mid");
    expect(accepted.llmCalls).toBe(0);
  });

  it("refuses to defer Auth while Orders depends on it", () => {
    const editor = new InteractivePlanEditor(samplePlan());
    const blocked = editor.deferFeature("F-Auth");
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toBe("Required by Orders — defer both or keep Auth");
    expect(blocked.preview.projected.waves.map((wave) => wave.featureId)).toContain("F-Auth");
    expect(blocked.preview.deferredOutOfV1).toEqual([]);
    expect(blocked.llmCalls).toBe(0);

    const compiled = editor.deferFeature("F-Core");
    expect(compiled.ok).toBe(false);
    expect(compiled.message).toBe("Wave 1 compiled features stay in the plan");

    const orders = editor.deferFeature("F-Orders");
    expect(orders.ok).toBe(true);
    expect(orders.preview.deferredOutOfV1.map((feature) => feature.featureId)).toEqual(["F-Orders"]);
    expect(orders.preview.projected.waves.map((wave) => wave.featureId)).not.toContain("F-Orders");

    const both = new InteractivePlanEditor(samplePlan()).deferFeatures(["F-Auth", "F-Orders"]);
    expect(both.ok).toBe(true);
    expect(both.preview.deferredOutOfV1.map((feature) => feature.featureId).sort()).toEqual(["F-Auth", "F-Orders"]);
    expect(both.preview.projected.waves.map((wave) => wave.featureId)).not.toContain("F-Auth");
  });

  it("reorders optional waves and rejects a dependency inversion", () => {
    const editor = new InteractivePlanEditor(samplePlan());
    const moved = editor.reorderOptionalWave("F-AdminEmail", 5);
    expect(moved.ok).toBe(true);
    expect(moved.preview.projected.waves.map((wave) => wave.featureId)[0]).not.toBe("F-AdminEmail");
    const inverted = editor.reorderOptionalWave("F-Orders", 0);
    expect(inverted.ok).toBe(false);
    expect(inverted.message).toBe("Cannot schedule Orders before Auth");
  });

  it("updates the budget cap and spend guard without an LLM call", () => {
    const editor = new InteractivePlanEditor(samplePlan());
    const cap = editor.setBudgetCap({ connection: "api", microUsd: 1n });
    expect(cap.ok).toBe(true);
    expect(cap.preview.guard.plannedExceedsCap).toBe(true);
    expect(cap.preview.guard.message).toContain("Budget cap");
    const guard = editor.setSpendGuard({ connection: "api", haltMicroUsd: 1n });
    expect(guard.ok).toBe(true);
    expect(guard.preview.guard.spendGuardTripped).toBe(true);
    expect(guard.preview.guard.message).toContain("Spend guard");
    expect(guard.llmCalls).toBe(0);
    expect(guard.elapsedMs).toBeLessThan(PRESET_RECOMPUTE_BUDGET_MS);
  });

  it("routes a Chosen for you override into Task 087 and refreshes the preview", () => {
    const impact = new CountingImpact();
    const editor = new InteractivePlanEditor(samplePlan(), sources(impact));
    const result = editor.overrideDelegatedChoice({
      criterionId: "auth-method",
      optionId: "magic-link",
      chosenValue: "Magic Link",
      impactedTaskIds: ["W1-auth"],
    });
    expect(result.ok).toBe(true);
    expect(result.llmCalls).toBe(0);
    expect(impact.llmCalls).toBe(0);
    expect(impact.formats).toBe(1);
    expect(result.route).toMatchObject({
      label: "Override",
      route: "revision",
      task: "Task-087",
      criterionId: "auth-method",
      optionId: "magic-link",
      previousValue: "Email+Password",
      nextValue: "Magic Link",
    });
    expect(result.impactedTaskIds).toEqual(["W1-auth"]);
    expect(result.impactSummary).toContain("Est. delta:");
    expect(result.preview.chosenForYou.entries.map((entry) => entry.criterionId)).not.toContain("auth-method");
    expect(result.preview.chosenForYou.count).toBe(2);
    expect(result.preview.explicitOverrides).toEqual([
      expect.objectContaining({ criterionId: "auth-method", chosenValue: "Magic Link", basis: "explicit" }),
    ]);
    expect(result.preview.wave1.tasks.find((task) => task.id === "W1-auth")?.pendingRevision).toBe(true);
    expect(result.preview.deferred).toHaveLength(1);
  });
});
