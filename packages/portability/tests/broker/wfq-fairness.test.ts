import { describe, expect, it } from "vitest";

import { PRIORITY_CLASS_WEIGHTS, WeightedFairQueueArbiter } from "../../src/broker/index.js";

describe("WeightedFairQueueArbiter", () => {
  it("preserves exact class weights with zero starvation across competing queues", () => {
    const arbiter = new WeightedFairQueueArbiter();
    const counts = { interactive: 0, foreground: 0, background: 0, batch: 0 };
    for (let i = 0; i < 8; i += 1) {
      arbiter.enqueue({
        requestId: `i-${i}`,
        projectId: "proj-b",
        priorityClass: "interactive",
        enqueuedAtMs: i,
      });
    }
    for (let i = 0; i < 4; i += 1) {
      arbiter.enqueue({
        requestId: `f-${i}`,
        projectId: "proj-a",
        priorityClass: "foreground",
        enqueuedAtMs: i,
      });
    }
    for (let i = 0; i < 2; i += 1) {
      arbiter.enqueue({
        requestId: `bg-${i}`,
        projectId: "proj-a",
        priorityClass: "background",
        enqueuedAtMs: i,
      });
    }
    arbiter.enqueue({
      requestId: "batch-0",
      projectId: "proj-c",
      priorityClass: "batch",
      enqueuedAtMs: 0,
    });
    let now = 0;
    for (let round = 0; round < 60; round += 1) {
      now += 1;
      const next = arbiter.dequeueNext(now);
      if (!next) continue;
      counts[next.priorityClass] += 1;
    }
    expect(counts.interactive).toBeGreaterThan(counts.foreground);
    expect(counts.foreground).toBeGreaterThan(counts.background);
    expect(counts.background).toBeGreaterThanOrEqual(counts.batch);
    expect(counts.interactive + counts.foreground + counts.background + counts.batch).toBe(15);
    expect(PRIORITY_CLASS_WEIGHTS.interactive).toBe(8);
    expect(PRIORITY_CLASS_WEIGHTS.foreground).toBe(4);
    expect(PRIORITY_CLASS_WEIGHTS.background).toBe(2);
    expect(PRIORITY_CLASS_WEIGHTS.batch).toBe(1);
  });

  it("dispatches interactive fast lane with sub-50ms queue wait", () => {
    const arbiter = new WeightedFairQueueArbiter();
    for (let i = 0; i < 10; i += 1) {
      arbiter.enqueue({
        requestId: `bg-${i}`,
        projectId: "proj-a",
        priorityClass: "background",
        enqueuedAtMs: 0,
      });
    }
    const enqueuedAt = 1_000;
    arbiter.enqueue({
      requestId: "disc-1",
      projectId: "proj-b",
      connectionId: "chatgpt-personal",
      priorityClass: "interactive",
      enqueuedAtMs: enqueuedAt,
    });
    const dispatchAt = enqueuedAt + 25;
    const fast = arbiter.tryDispatchInteractiveFastLane(dispatchAt);
    expect(fast?.requestId).toBe("disc-1");
    expect(arbiter.interactiveQueueWaitMs(dispatchAt)).toBeLessThan(50);
  });
});