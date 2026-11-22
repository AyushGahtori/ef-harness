import { describe, expect, it } from "vitest";

import { createHarness, plusConnection, queuedTask } from "./helpers.js";

describe("stop receipts, resume validation, and parked preservation", () => {
  it("records user_stop and disk_red receipts without dropping checkpoints or integration", () => {
    const { controller, integration, checkpoints, stopEvents, kernel } = createHarness();
    const before = integration.history().map((commit) => commit.sha);
    const kept = checkpoints.write({
      taskId: "T-kept",
      files: [{ path: "notes.md", contents: "keep\n" }],
      failingTestOutput: null,
    });
    controller.registerActive({
      workerId: "w",
      taskId: "T-2",
      title: "Two",
      featureId: "F-2",
      role: "implementer@1",
      currency: "micro-usd",
      ceilingUnits: 10_000,
      step: 1,
      steps: 4,
      files: [{ path: "src/two.ts", contents: "two\n" }],
      failingTestOutput: null,
      acceptanceCriteria: [],
      safetyClass: null,
    });
    const user = controller.stopForUser();
    expect(user.trigger).toBe("user_stop");
    expect(user.checkpointShas).toHaveLength(1);
    expect(kernel.calls).toEqual(["user_stop"]);
    const parked = controller.keepParked();
    expect(parked.cpu).toBe(0);
    expect(parked.spendPerHourMicroUsd).toBe(0);
    expect(parked.welcomeBackReady).toBe(true);
    expect(parked.checkpointRefs).toContain(kept.ref);
    expect(stopEvents.list()[0]).toMatchObject({ trigger: "user_stop", recoveryOption: "keep_parked" });
    expect(integration.history().map((commit) => commit.sha)).toEqual(before);

    const disk = createHarness();
    disk.controller.registerActive({
      workerId: "w",
      taskId: "T-disk",
      title: "Disk",
      featureId: "F-D",
      role: "implementer@1",
      currency: "micro-usd",
      ceilingUnits: 10_000,
      step: 1,
      steps: 2,
      files: [],
      failingTestOutput: null,
      acceptanceCriteria: [],
      safetyClass: null,
    });
    const red = disk.controller.stopForDiskRed();
    expect(red.trigger).toBe("disk_red");
    expect(disk.stopEvents.list()[0]?.trigger).toBe("disk_red");
    expect(disk.kernel.calls).toEqual(["disk_red"]);
    expect(disk.checkpoints.list().map((item) => item.taskId)).toEqual(["T-disk"]);
    disk.checkpoints.discard(disk.checkpoints.list()[0]?.ref ?? "", { explicit: true });
    expect(disk.checkpoints.list()).toEqual([]);
    disk.stopEvents.close();
    stopEvents.close();
  });

  it("refuses to resume until added budget is positive and the connection is healthy", () => {
    const { ledger, controller, stopEvents } = createHarness();
    controller.registerActive({
      workerId: "w",
      taskId: "T-7",
      title: "Cutoff",
      featureId: "F-Print",
      role: "implementer@1",
      currency: "micro-usd",
      ceilingUnits: 10_000,
      step: 2,
      steps: 8,
      files: [{ path: "src/cutoff.ts", contents: "partial\n" }],
      failingTestOutput: null,
      acceptanceCriteria: [],
      safetyClass: null,
    });
    ledger.postHistoricalSpend("micro-usd", 10_000_000);
    controller.observe();
    controller.setConnectionHealth("api", false);
    expect(controller.addBudget({ kind: "plus_5" })).toMatchObject({
      resumed: false,
      reason: "connection_unhealthy",
    });
    expect(ledger.limit("micro-usd")).toBe(10_000_000);
    controller.setConnectionHealth("api", true);
    const added = controller.addBudget({ kind: "plus_5" });
    expect(added.resumed).toBe(true);
    expect(added.remainingMicroUsd).toBe(5_000_000);
    expect(ledger.limit("micro-usd")).toBe(15_000_000);
    expect(added.resumeFrom.length).toBeGreaterThan(0);
    expect(stopEvents.list()[0]?.recoveryOption).toBe("add_budget");
    stopEvents.close();
  });

  it("rejects a zero custom budget before changing the cap", () => {
    const { ledger, controller } = createHarness();
    ledger.postHistoricalSpend("micro-usd", 10_000_000);
    controller.observe();
    expect(() => controller.addBudget({ kind: "custom", customMicroUsd: 0 })).toThrow(/positive integer/);
    expect(ledger.limit("micro-usd")).toBe(10_000_000);
    const custom = controller.addBudget({ kind: "custom", customMicroUsd: 2_500_000 });
    expect(custom.resumed).toBe(true);
    expect(ledger.limit("micro-usd")).toBe(12_500_000);
  });

  it("requires an explicit paid-switch confirmation and a healthy connection with headroom", () => {
    const now = 1_700_000_000_000;
    const { controller } = createHarness({
      microUsdLimit: null,
      ppmLimit: 1_000_000,
      connections: [
        plusConnection(now + 82 * 60_000),
        {
          id: "anthropic",
          label: "Anthropic Console API",
          billing: "pay-per-use",
          healthy: true,
          estimateMicroUsd: 650_000,
          remainingTasks: 4,
          window: null,
          microUsdRemaining: 5_000_000,
        },
      ],
      activeConnectionId: "plus",
    });
    const preview = controller.switchConnection("anthropic", false);
    expect(preview.resumed).toBe(false);
    expect(preview.confirmationText).toBe(
      "Anthropic Console API is pay-per-use (~$0.65 est. for remaining 4 tasks) — Confirm?",
    );
    expect(controller.activeConnection()).toBe("plus");
    controller.setConnectionHealth("anthropic", false);
    expect(controller.switchConnection("anthropic", true)).toMatchObject({
      resumed: false,
      reason: "connection_unhealthy",
    });
    expect(controller.activeConnection()).toBe("plus");
    controller.setConnectionHealth("anthropic", true);
    const switched = controller.switchConnection("anthropic", true);
    expect(switched.resumed).toBe(true);
    expect(controller.activeConnection()).toBe("anthropic");
    expect(switched.resumeFrom).toEqual([]);
  });

  it("waits for the reset timestamp, keeps auto-resume off, and then resumes with a positive allowance", () => {
    const start = 1_700_000_000_000;
    const resetAt = start + 82 * 60_000;
    const harness = createHarness({
      microUsdLimit: null,
      ppmLimit: 1_000_000,
      connections: [plusConnection(resetAt)],
      activeConnectionId: "plus",
    });
    harness.now = start;
    harness.ledger.postHistoricalSpend("ppm", 1_000_000);
    const card = harness.controller.observe().stopCard;
    expect(card?.actions.find((action) => action.id === "wait_for_reset")?.label).toBe("Wait for Reset (1h 22m)");
    expect(card?.autoResumeAtReset).toBe(false);
    expect(harness.controller.resumeFromReset("auto")).toMatchObject({ resumed: false, reason: "auto_resume_off" });
    expect(harness.controller.resumeFromReset("user")).toMatchObject({ resumed: false, reason: "window_still_closed" });
    harness.controller.setConnectionHealth("plus", false);
    harness.now = resetAt;
    expect(harness.controller.resumeFromReset("user")).toMatchObject({ resumed: false, reason: "connection_unhealthy" });
    expect(harness.ledger.snapshot("ppm")?.spent).toBe(1_000_000);
    harness.controller.setConnectionHealth("plus", true);
    harness.controller.armAutoResume(true);
    const auto = harness.controller.resumeFromReset("auto");
    expect(auto.resumed).toBe(true);
    expect(auto.remainingPpm).toBe(1_000_000);
    expect(harness.ledger.snapshot("ppm")?.spent).toBe(0);
    harness.stopEvents.close();
  });

  it("shows the cheaper preset and keeps safety floors before resume", () => {
    const { controller, ledger } = createHarness();
    ledger.postHistoricalSpend("micro-usd", 10_000_000);
    controller.enqueue(queuedTask("T-pay", { safetyClass: "payments", title: "Payments" }));
    controller.enqueue(queuedTask("T-copy", { safetyClass: null, title: "Copy" }));
    controller.observe();
    const preview = controller.applyCheaper(false);
    expect(preview.resumed).toBe(false);
    expect(preview.reason).toBe("confirmation_required");
    expect(controller.snapshot().preset).toBe("balanced");
    const payments = preview.projection?.lines.find((line) => line.taskId === "T-pay");
    const copy = preview.projection?.lines.find((line) => line.taskId === "T-copy");
    expect(payments).toMatchObject({ floor: "senior", level: "senior" });
    expect(copy).toMatchObject({ floor: "junior", level: "junior" });
    expect(preview.projection?.lines.every((line) => line.level === line.floor)).toBe(true);
    const applied = controller.applyCheaper(true);
    expect(controller.snapshot().preset).toBe("cheapest");
    expect(applied.resumed).toBe(false);
    expect(applied.reason).toBe("allowance_not_positive");
    expect(applied.projection?.projectedRemainingMicroUsd).toBe(200_000 + 20_000);
  });

  it("highlights wait, switch, and park at 95% of a ChatGPT Plus window and hides Add Budget", () => {
    const start = 1_700_000_000_000;
    const { ledger, controller, kernel } = createHarness({
      microUsdLimit: null,
      ppmLimit: 1_000_000,
      connections: [
        plusConnection(start + 82 * 60_000),
        {
          id: "anthropic",
          label: "Anthropic Console API",
          billing: "pay-per-use",
          healthy: true,
          estimateMicroUsd: 650_000,
          remainingTasks: 4,
          window: null,
          microUsdRemaining: 5_000_000,
        },
      ],
      activeConnectionId: "plus",
    });
    ledger.postHistoricalSpend("ppm", 950_000);
    const card = controller.observe().stopCard;
    expect(kernel.calls).toEqual([]);
    expect(card?.trigger).toBe("subscription_wind_down");
    expect(card?.actions.find((action) => action.id === "add_budget")?.hidden).toBe(true);
    expect(card?.actions.find((action) => action.id === "wait_for_reset")).toMatchObject({
      hidden: false,
      highlighted: true,
      label: "Wait for Reset (1h 22m)",
    });
    expect(card?.actions.find((action) => action.id === "switch_connection")?.highlighted).toBe(true);
    expect(card?.actions.find((action) => action.id === "keep_parked")?.highlighted).toBe(true);
    expect(card?.confirmationTexts).toEqual([
      "Anthropic Console API is pay-per-use (~$0.65 est. for remaining 4 tasks) — Confirm?",
    ]);
    const parked = controller.keepParked();
    expect(parked.cpu).toBe(0);
    expect(parked.spendPerHourMicroUsd).toBe(0);
  });
});
