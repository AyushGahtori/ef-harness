import { describe, expect, it } from "vitest";

import {
  ADD_BUDGET_PLUS_10_MICRO_USD,
  ADD_BUDGET_PLUS_5_MICRO_USD,
  CheckpointStopCardView,
  RECOVERY_ACTION_IDS,
  defaultInteraction,
  type StopCardFacts,
} from "../../src/cockpit/stop-card/index.js";

const NOW = 1_700_000_000_000;

describe("checkpoint stop card", () => {
  it("renders all 6 recovery actions for a dollar-cap hard stop", () => {
    const view = new CheckpointStopCardView(() => NOW);
    const rendered = view.render(dollarFacts(), defaultInteraction());
    expect(rendered.actions.map((action) => action.id)).toEqual([...RECOVERY_ACTION_IDS]);
    expect(rendered.visibleActions.map((action) => action.id)).toEqual([...RECOVERY_ACTION_IDS]);
    expect(rendered.title).toBe("Budget reached: $10.00 of $10.00");
    expect(rendered.spentSummary).toBe("$10.00 of $10.00");
    expect(rendered.finishedFeatures).toEqual(["Orders", "Menu"]);
    expect(rendered.finishedTasksCount).toBe(9);
    expect(rendered.inFlightCheckpointedTasks).toEqual(["T-7"]);
    expect(rendered.remainingTasksCount).toBe(3);
    expect(rendered.html).toContain("Add Budget");
    expect(rendered.html).toContain("Switch to Cheaper Models");
    expect(rendered.html).toContain("Switch Connection");
    expect(rendered.html).toContain("Wait for Reset (1h 22m)");
    expect(rendered.html).toContain("Finish by Hand");
    expect(rendered.html).toContain("Keep Parked");
    expect(rendered.html).toContain("+$5");
    expect(rendered.html).toContain("+$10");
    expect(rendered.html).toContain("Custom");
    expect(rendered.html).toContain("data-auto-resume=\"false\"");
    expect(rendered.html).toContain("Auto-resume at reset");
    expect(rendered.html).toContain("T-9 stays at senior");
    expect(rendered.html).toContain("Open in VS Code");
    expect(rendered.html).toContain("Your work is saved. Nothing has been lost.");
    expect(rendered.autoResumeAtReset).toBe(false);
    const opted = view.render(dollarFacts(), view.withAutoResume(defaultInteraction(), true));
    expect(opted.html).toContain("data-auto-resume=\"true\"");
    expect(opted.html).toContain("checked");
    expect(view.addBudgetIntent("plus_5").deltaMicroUsd).toBe(ADD_BUDGET_PLUS_5_MICRO_USD);
    expect(view.addBudgetIntent("plus_10").deltaMicroUsd).toBe(ADD_BUDGET_PLUS_10_MICRO_USD);
    expect(view.addBudgetIntent("custom", 2_500_000).deltaMicroUsd).toBe(2_500_000);
    expect(() => view.addBudgetIntent("custom", 0)).toThrow(/positive integer/);
  });

  it("highlights wait, switch, and park for a ChatGPT Plus window and hides Add Budget", () => {
    const view = new CheckpointStopCardView(() => NOW);
    const rendered = view.render(plusFacts(), defaultInteraction());
    expect(rendered.html).not.toContain("Add Budget");
    expect(rendered.html).not.toContain("+$5");
    expect(rendered.html).not.toContain("Add $5 Budget");
    expect(rendered.visibleActions.map((action) => action.id)).not.toContain("add_budget");
    expect(rendered.html).toContain("Wait for Reset (1h 22m)");
    expect(rendered.html).toContain('data-action="wait_for_reset" data-highlighted="true"');
    expect(rendered.html).toContain('data-action="switch_connection" data-highlighted="true"');
    expect(rendered.html).toContain('data-action="keep_parked" data-highlighted="true"');
    expect(rendered.confirmationText).toBe(
      "Anthropic Console API is pay-per-use (~$0.65 est. for remaining 4 tasks) — Confirm?",
    );
    expect(rendered.html).toContain(rendered.confirmationText ?? "");
    const confirmed = view.render(plusFacts(), view.withSwitch(defaultInteraction(), "anthropic", true));
    expect(confirmed.confirmationText).toBeNull();
    const pending = view.render(plusFacts(), view.withSwitch(defaultInteraction(), "anthropic", false));
    expect(pending.confirmationText).toBe(rendered.confirmationText);
    expect(rendered.html).toContain("0 CPU / 0 spend");
  });
});

function dollarFacts(): StopCardFacts {
  return {
    trigger: "budget_100",
    finishedFeatures: ["Orders", "Menu"],
    finishedTasksCount: 9,
    inFlightCheckpointedTasks: ["T-7"],
    remainingTasks: [
      { taskId: "T-8", title: "Receipts", floor: "junior", level: "junior" },
      { taskId: "T-9", title: "Payments", floor: "senior", level: "senior" },
      { taskId: "T-10", title: "Preview", floor: "junior", level: "junior" },
    ],
    spentSummary: "$10.00 of $10.00",
    dollarCap: true,
    subscription: {
      label: "Copilot",
      windowKind: "weekly",
      resetAtMs: NOW + 82 * 60_000,
      usedPpm: 100_000,
      limitPpm: 1_000_000,
    },
    connections: [
      {
        id: "api",
        label: "Anthropic Console API",
        billing: "pay-per-use",
        estimateMicroUsd: 650_000,
        remainingTasks: 4,
      },
      { id: "local", label: "Ollama", billing: "local", estimateMicroUsd: null, remainingTasks: null },
    ],
    activeConnectionId: "api",
    cheaperProjectedMicroUsd: 240_000,
    vscodeCommand: "code C:\\repo\\kitchen",
    officeLights: "evening",
    savedLine: "Your work is saved. Nothing has been lost.",
  };
}

function plusFacts(): StopCardFacts {
  return {
    trigger: "subscription_wind_down",
    finishedFeatures: ["Orders", "Menu"],
    finishedTasksCount: 8,
    inFlightCheckpointedTasks: ["T-7"],
    remainingTasks: [
      { taskId: "T-8", title: "Receipts", floor: "junior", level: "junior" },
      { taskId: "T-9", title: "Styles", floor: "junior", level: "junior" },
      { taskId: "T-10", title: "Preview", floor: "junior", level: "junior" },
      { taskId: "T-11", title: "Notes", floor: "junior", level: "junior" },
    ],
    spentSummary: "950,000 / 1,000,000 ppm",
    dollarCap: false,
    subscription: {
      label: "ChatGPT Plus",
      windowKind: "5h",
      resetAtMs: NOW + 82 * 60_000,
      usedPpm: 950_000,
      limitPpm: 1_000_000,
    },
    connections: [
      {
        id: "plus",
        label: "ChatGPT Plus",
        billing: "subscription",
        estimateMicroUsd: null,
        remainingTasks: null,
      },
      {
        id: "anthropic",
        label: "Anthropic Console API",
        billing: "pay-per-use",
        estimateMicroUsd: 650_000,
        remainingTasks: 4,
      },
    ],
    activeConnectionId: "plus",
    cheaperProjectedMicroUsd: 80_000,
    vscodeCommand: null,
    officeLights: "evening",
    savedLine: "Your work is saved. Nothing has been lost.",
  };
}
