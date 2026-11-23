import { describe, expect, it } from "vitest";

import { buildThreeProjectBroker } from "./fixtures.js";

describe("GlobalMultiProjectBroker · three-project contention", () => {
  it("simulates shared subscription, API balance, slots, and heavy lane without over-allocation", async () => {
    const { broker } = buildThreeProjectBroker();
    broker.setForegroundProject("proj-b");
    for (let i = 0; i < 8; i += 1) {
      broker.enqueueProviderRequest({
        requestId: `a-bg-${i}`,
        projectId: "proj-a",
        connectionId: "chatgpt-personal",
        priorityClass: "background",
        enqueuedAtMs: i,
      });
    }
    const interactiveAt = 500;
    broker.enqueueProviderRequest({
      requestId: "b-disc",
      projectId: "proj-b",
      connectionId: "chatgpt-personal",
      priorityClass: "interactive",
      enqueuedAtMs: interactiveAt,
    });
    const dispatched = broker.dispatchProviderTurn(interactiveAt + 40);
    expect(dispatched?.priorityClass).toBe("interactive");
    expect(dispatched?.projectId).toBe("proj-b");

    const gA = broker.requestBudgetGrant({
      grantId: "usd-a",
      projectId: "proj-a",
      connectionId: "openrouter-key-1",
      currency: "micro_usd",
      requestedAmount: 2_000_000,
      nowMs: 0,
    });
    const gB = broker.requestBudgetGrant({
      grantId: "usd-b",
      projectId: "proj-b",
      connectionId: "openrouter-key-1",
      currency: "micro_usd",
      requestedAmount: 2_000_000,
      nowMs: 1,
    });
    expect(gA.grantedAmount + gB.grantedAmount).toBe(2_500_000);

    const slotA = await broker.acquireExecutionSlot({
      requestId: "run-a",
      projectId: "proj-a",
      priorityClass: "background",
      executionRole: "worker",
      needsHeavyLane: true,
      enqueuedAtMs: 0,
    });
    const slotB = await broker.acquireExecutionSlot({
      requestId: "run-b",
      projectId: "proj-b",
      priorityClass: "foreground",
      executionRole: "verifier",
      needsHeavyLane: false,
      enqueuedAtMs: 1,
    });
    expect(broker.slotCoordinator().snapshot().pool2InUse).toBe(2);
    slotA.release();
    slotB.release();
  });

  it("re-weights foreground focus without aborting in-flight work", async () => {
    const { broker } = buildThreeProjectBroker();
    broker.setForegroundProject("proj-a");
    const inFlight = broker.acquireExecutionSlot({
      requestId: "keep",
      projectId: "proj-a",
      priorityClass: "foreground",
      executionRole: "worker",
      needsHeavyLane: false,
      enqueuedAtMs: 0,
    });
    broker.setForegroundProject("proj-b");
    const snap = broker.slotCoordinator().snapshot();
    expect(snap.pool2InUse).toBe(1);
    const pop = broker.popoverSnapshot();
    expect(pop.foregroundProjectId).toBe("proj-b");
    const token = await inFlight;
    token.release();
  });
});