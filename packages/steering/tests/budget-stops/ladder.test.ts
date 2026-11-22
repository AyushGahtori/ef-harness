import { describe, expect, it } from "vitest";

import {
  MANDATORY_VERIFIER_ROLE_ID,
  METER_COLOR_50,
  METER_TONE_50,
  OPTIONAL_ADVISORY_ROLE_ID,
  RECOVERY_ACTIONS,
} from "../../src/budget-stops/index.js";
import { createHarness, plusConnection, queuedTask } from "./helpers.js";

describe("budget wind-down ladder", () => {
  it("marks 50% micro-USD as a quiet digest with a soft-blue meter and zero interruptions", () => {
    const { ledger, controller } = createHarness();
    ledger.postHistoricalSpend("micro-usd", 5_000_000);
    const snap = controller.observe();
    expect(snap.step).toBe("info_50");
    expect(snap.meter.tone).toBe(METER_TONE_50);
    expect(snap.meter.color).toBe(METER_COLOR_50);
    expect(snap.interruptionCount).toBe(0);
    expect(snap.inbox).toEqual([]);
    expect(snap.digest.map((item) => item.text)).toEqual(["50% of budget used — $5.00 / $10.00"]);
    expect(snap.digest[0]?.subtle).toBe(true);
    expect(snap.claimingEnabled).toBe(true);
    expect(snap.optionalAdvisoriesSkipped).toBe(false);
    expect(snap.stopCard).toBeNull();
  });

  it("marks 50% ppm as a quiet allowance digest with zero interruptions", () => {
    const { ledger, controller } = createHarness({ microUsdLimit: null, ppmLimit: 1_000_000 });
    ledger.postHistoricalSpend("ppm", 500_000);
    const snap = controller.observe();
    expect(snap.step).toBe("info_50");
    expect(snap.meter.tone).toBe(METER_TONE_50);
    expect(snap.interruptionCount).toBe(0);
    expect(snap.inbox).toEqual([]);
    expect(snap.digest.map((item) => item.text)).toEqual(["50% of allowance used — 500,000 / 1,000,000 ppm"]);
    expect(snap.claimingEnabled).toBe(true);
  });

  it("at 80% micro-USD posts the inbox heads-up and skips taste-reviewer while keeping verification", async () => {
    const { ledger, controller } = createHarness();
    ledger.postHistoricalSpend("micro-usd", 8_000_000);
    controller.enqueue(queuedTask("T-taste", { role: OPTIONAL_ADVISORY_ROLE_ID, ceilingUnits: 50_000 }));
    controller.enqueue(
      queuedTask("T-verify", {
        role: MANDATORY_VERIFIER_ROLE_ID,
        mandatoryVerification: true,
        ceilingUnits: 50_000,
      }),
    );
    const snap = controller.observe();
    expect(snap.step).toBe("warning_80");
    expect(snap.inbox.map((item) => item.text)).toEqual(["80% of budget used — $8.00 / $10.00"]);
    expect(snap.optionalAdvisoriesSkipped).toBe(true);
    expect(snap.mandatoryVerificationIntact).toBe(true);
    expect(snap.interruptionCount).toBe(0);
    const taste = await controller.tryClaim("T-taste");
    const verify = await controller.tryClaim("T-verify");
    expect(taste).toMatchObject({ claimed: false, reason: "optional_advisory_skipped" });
    expect(verify.claimed).toBe(true);
    expect(controller.snapshot().queuedTaskIds).toEqual(["T-taste"]);
    expect(controller.snapshot().activeWorkerIds).toEqual(["T-verify"]);
    expect(ledger.heldCount()).toBe(1);
  });

  it("at 80% ppm skips optional advisory extras and still claims mandatory verification", async () => {
    const { ledger, controller } = createHarness({ microUsdLimit: null, ppmLimit: 1_000_000 });
    ledger.postHistoricalSpend("ppm", 800_000);
    controller.enqueue(
      queuedTask("T-taste", { role: OPTIONAL_ADVISORY_ROLE_ID, currency: "ppm", ceilingUnits: 1_000 }),
    );
    controller.enqueue(
      queuedTask("T-verify", {
        role: MANDATORY_VERIFIER_ROLE_ID,
        mandatoryVerification: true,
        currency: "ppm",
        ceilingUnits: 1_000,
      }),
    );
    const snap = controller.observe();
    expect(snap.step).toBe("warning_80");
    expect(snap.inbox.map((item) => item.text)).toEqual(["80% of allowance used — 800,000 / 1,000,000 ppm"]);
    expect((await controller.tryClaim("T-taste")).reason).toBe("optional_advisory_skipped");
    expect((await controller.tryClaim("T-verify")).claimed).toBe(true);
  });

  it("at 90% finishes the two active workers, blocks five queued tasks, and keeps merged work", async () => {
    const { ledger, controller, integration, checkpoints, kernel } = createHarness();
    checkpoints.write({
      taskId: "T-kept",
      files: [{ path: "src/kept.ts", contents: "export const kept = true;\n" }],
      failingTestOutput: null,
    });
    const kept = checkpoints.list().map((item) => item.ref);
    ledger.postHistoricalSpend("micro-usd", 9_000_000);
    controller.registerActive({
      workerId: "w-a",
      taskId: "T-A",
      title: "Orders",
      featureId: "F-Orders",
      role: "implementer@1",
      currency: "micro-usd",
      ceilingUnits: 400_000,
      step: 6,
      steps: 8,
      files: [],
      failingTestOutput: null,
      acceptanceCriteria: [],
      safetyClass: null,
    });
    controller.registerActive({
      workerId: "w-b",
      taskId: "T-B",
      title: "Menu",
      featureId: "F-Menu",
      role: "implementer@1",
      currency: "micro-usd",
      ceilingUnits: 350_000,
      step: 6,
      steps: 8,
      files: [],
      failingTestOutput: null,
      acceptanceCriteria: [],
      safetyClass: null,
    });
    for (const id of ["T-1", "T-2", "T-3", "T-4", "T-5"]) controller.enqueue(queuedTask(id));
    const before = integration.history().map((commit) => commit.sha);
    const snap = controller.observe();
    expect(snap.step).toBe("wind_down_90");
    expect(snap.claimingEnabled).toBe(false);
    expect(snap.digest.map((item) => item.text)).toContain("Budget nearly used · finishing current steps");
    for (const id of ["T-1", "T-2", "T-3", "T-4", "T-5"]) {
      expect(await controller.tryClaim(id)).toMatchObject({ claimed: false, reason: "wind_down", windDown: true });
    }
    expect(ledger.heldCount()).toBe(0);
    const first = await controller.finishActive("w-a", 400_000, {
      verified: true,
      featureId: "F-Orders",
      mergeSha: "merge-orders",
      subject: "Orders",
    });
    const second = await controller.finishActive("w-b", 350_000, {
      verified: true,
      featureId: "F-Menu",
      mergeSha: "merge-menu",
      subject: "Menu",
    });
    expect(first.merged).toBe(true);
    expect(second.merged).toBe(true);
    expect(ledger.snapshot("micro-usd")?.spent).toBe(9_750_000);
    expect(ledger.snapshot("micro-usd")?.spent ?? 0).toBeLessThanOrEqual(10_000_000);
    expect(controller.snapshot().finishedFeatures).toEqual(["F-Orders", "F-Menu"]);
    expect(controller.snapshot().finishedTasksCount).toBe(2);
    expect(controller.snapshot().queuedTaskIds).toEqual(["T-1", "T-2", "T-3", "T-4", "T-5"]);
    expect(controller.snapshot().activeWorkerIds).toEqual([]);
    const after = integration.history().map((commit) => commit.sha);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toEqual([...before, "merge-orders", "merge-menu"]);
    expect(checkpoints.list().map((item) => item.ref)).toEqual(kept);
    expect(kernel.calls).toEqual([]);
  });

  it("at 900_000 ppm finishes the active task instead of hard-stopping", async () => {
    const { ledger, controller, kernel } = createHarness({
      microUsdLimit: null,
      ppmLimit: 1_000_000,
      connections: [plusConnection(1_700_000_000_000 + 82 * 60_000)],
      activeConnectionId: "plus",
    });
    ledger.postHistoricalSpend("ppm", 899_999);
    expect(controller.observe().step).toBe("warning_80");
    ledger.postHistoricalSpend("ppm", 1);
    controller.registerActive({
      workerId: "w-live",
      taskId: "T-live",
      title: "Live",
      featureId: "F-Live",
      role: "implementer@1",
      currency: "ppm",
      ceilingUnits: 10_000,
      step: 7,
      steps: 8,
      files: [],
      failingTestOutput: null,
      acceptanceCriteria: [],
      safetyClass: null,
    });
    const snap = controller.observe();
    expect(snap.step).toBe("wind_down_90");
    expect(snap.claimingEnabled).toBe(false);
    expect(kernel.calls).toEqual([]);
    const finished = await controller.finishActive("w-live", 10_000, {
      verified: true,
      featureId: "F-Live",
      mergeSha: "merge-live",
      subject: "Live",
    });
    expect(finished.merged).toBe(true);
    expect(ledger.snapshot("ppm")?.spent).toBe(910_000);
    expect(kernel.calls).toEqual([]);
  });

  it("at 100% micro-USD checkpoints T-7, preserves integration, and opens all 6 recovery actions", () => {
    const now = 1_700_000_000_000;
    const { ledger, controller, integration, checkpoints, kernel, stopEvents } = createHarness({
      connections: [apiPaid(), plusConnection(now + 82 * 60_000)],
      finishedFeatures: ["F-Orders", "F-Menu"],
      finishedTasksCount: 9,
      commits: [
        { sha: "base", featureId: null, subject: "base" },
        { sha: "orders", featureId: "F-Orders", subject: "orders" },
        { sha: "menu", featureId: "F-Menu", subject: "menu" },
      ],
    });
    const kept = checkpoints.write({
      taskId: "T-kept",
      files: [{ path: "src/kept.ts", contents: "kept\n" }],
      failingTestOutput: null,
    });
    ledger.postHistoricalSpend("micro-usd", 10_000_000);
    controller.registerActive({
      workerId: "w7",
      taskId: "T-7",
      title: "Cutoff",
      featureId: "F-Print",
      role: "implementer@1",
      currency: "micro-usd",
      ceilingUnits: 100_000,
      step: 4,
      steps: 8,
      files: [{ path: "src/cutoff.ts", contents: "export const cutoff = \"11:00\";\n" }],
      failingTestOutput: "AssertionError: cutoff expected 11:15 received 11:00",
      acceptanceCriteria: ["cutoff stays 11:15"],
      safetyClass: null,
    });
    for (const id of ["T-8", "T-9", "T-10"]) controller.enqueue(queuedTask(id));
    const before = integration.history().map((commit) => commit.sha);
    const snap = controller.observe();
    expect(snap.step).toBe("hard_stop_100");
    expect(snap.officeLights).toBe("evening");
    expect(snap.interruptionCount).toBe(1);
    expect(kernel.calls).toEqual(["budget_100"]);
    expect(snap.stopCard?.trigger).toBe("budget_100");
    expect(snap.stopCard?.spentSummary).toBe("$10.00 of $10.00");
    expect(snap.stopCard?.finishedFeatures).toEqual(["F-Orders", "F-Menu"]);
    expect(snap.stopCard?.finishedTasksCount).toBe(9);
    expect(snap.stopCard?.inFlightCheckpointedTasks).toEqual(["T-7"]);
    expect(snap.stopCard?.remainingTasksCount).toBe(3);
    expect(snap.stopCard?.actions.filter((action) => !action.hidden).map((action) => action.id)).toEqual([
      ...RECOVERY_ACTIONS,
    ]);
    const saved = checkpoints.list().find((item) => item.taskId === "T-7");
    expect(saved?.files[0]?.contents).toContain("11:00");
    expect(saved?.failingTestOutput).toContain("11:15");
    expect(checkpoints.list().some((item) => item.ref === kept.ref)).toBe(true);
    expect(integration.history().map((commit) => commit.sha)).toEqual(before);
    const event = stopEvents.list()[0];
    expect(event).toMatchObject({
      trigger: "budget_100",
      timestampMs: now,
      recoveryOption: null,
    });
    expect(event?.checkpointShas).toEqual([saved?.sha]);
    expect(stopEvents.tableName()).toBe("stop_events");
    controller.observe();
    expect(stopEvents.list()).toHaveLength(1);
    expect(() => checkpoints.discard(kept.ref, { explicit: false as true })).toThrow(/explicit discard/);
    expect(checkpoints.list().some((item) => item.ref === kept.ref)).toBe(true);
  });

  it("at 100% ppm halts on window_exhausted and keeps the checkpoint", () => {
    const { ledger, controller, kernel, stopEvents, checkpoints } = createHarness({
      microUsdLimit: null,
      ppmLimit: 1_000_000,
      connections: [plusConnection(1_700_000_000_000 + 60_000)],
      activeConnectionId: "plus",
    });
    ledger.postHistoricalSpend("ppm", 1_000_000);
    controller.registerActive({
      workerId: "w7",
      taskId: "T-7",
      title: "Cutoff",
      featureId: "F-Print",
      role: "implementer@1",
      currency: "ppm",
      ceilingUnits: 1_000,
      step: 3,
      steps: 8,
      files: [{ path: "src/cutoff.ts", contents: "partial\n" }],
      failingTestOutput: "fail",
      acceptanceCriteria: [],
      safetyClass: null,
    });
    const snap = controller.observe();
    expect(snap.step).toBe("hard_stop_100");
    expect(kernel.calls).toEqual(["window_exhausted"]);
    expect(stopEvents.list()[0]?.trigger).toBe("window_exhausted");
    expect(checkpoints.list().map((item) => item.taskId)).toEqual(["T-7"]);
    expect(snap.stopCard?.actions.find((action) => action.id === "add_budget")?.hidden).toBe(true);
    expect(snap.stopCard?.actions.find((action) => action.id === "wait_for_reset")?.highlighted).toBe(true);
  });
});

function apiPaid() {
  return {
    id: "api",
    label: "Anthropic Console API",
    billing: "pay-per-use" as const,
    healthy: true,
    estimateMicroUsd: 650_000,
    remainingTasks: 4,
    window: null,
    microUsdRemaining: 5_000_000,
  };
}
