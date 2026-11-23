import { describe, expect, it } from "vitest";

import {
  MachineWideSlotCoordinator,
  PortLeaseCollisionError,
  PortOutOfRangeError,
} from "../../src/broker/index.js";

describe("MachineWideSlotCoordinator", () => {
  it("caps machine-wide Pool-2 and heavy lane across three projects", async () => {
    const coord = new MachineWideSlotCoordinator({
      pool2WarmSlots: 2,
      heavyLanePermits: 1,
      sessionProcessCap: 4,
    });
    const a = await coord.acquireExecutionSlot({
      requestId: "a",
      projectId: "proj-a",
      priorityClass: "background",
      executionRole: "worker",
      needsHeavyLane: true,
      enqueuedAtMs: 0,
    });
    const b = await coord.acquireExecutionSlot({
      requestId: "b",
      projectId: "proj-b",
      priorityClass: "foreground",
      executionRole: "verifier",
      needsHeavyLane: false,
      enqueuedAtMs: 1,
    });
    const snap = coord.snapshot();
    expect(snap.pool2InUse).toBe(2);
    expect(snap.heavyInUse).toBe(1);
    let thirdResolved = false;
    const pending = coord
      .acquireExecutionSlot({
        requestId: "c",
        projectId: "proj-c",
        priorityClass: "batch",
        executionRole: "background",
        needsHeavyLane: true,
        enqueuedAtMs: 2,
      })
      .then(() => {
        thirdResolved = true;
      });
    await Promise.resolve();
    expect(thirdResolved).toBe(false);
    a.release();
    await pending;
    expect(thirdResolved).toBe(true);
    b.release();
  });

  it("leases ports globally without cross-project collision", () => {
    const coord = new MachineWideSlotCoordinator({
      pool2WarmSlots: 2,
      heavyLanePermits: 1,
      sessionProcessCap: 4,
    });
    coord.leasePort(41_005, "proj-a", "preview", 0, null);
    expect(() => coord.leasePort(41_005, "proj-b", "postgres", 1, null)).toThrow(PortLeaseCollisionError);
    expect(() => coord.leasePort(40_000, "proj-a", "bad", 0, null)).toThrow(PortOutOfRangeError);
    coord.releasePort(41_005, "proj-a");
    coord.leasePort(41_005, "proj-b", "postgres", 2, null);
  });

  it("honors Orange governor single-slot ceiling", async () => {
    const coord = new MachineWideSlotCoordinator({
      pool2WarmSlots: 2,
      heavyLanePermits: 1,
      sessionProcessCap: 4,
    });
    await coord.acquireExecutionSlot({
      requestId: "a",
      projectId: "proj-a",
      priorityClass: "foreground",
      executionRole: "worker",
      needsHeavyLane: false,
      enqueuedAtMs: 0,
    });
    coord.setGovernorOrange(true);
    let second = false;
    void coord
      .acquireExecutionSlot({
        requestId: "b",
        projectId: "proj-b",
        priorityClass: "foreground",
        executionRole: "verifier",
        needsHeavyLane: false,
        enqueuedAtMs: 1,
      })
      .then(() => {
        second = true;
      });
    await Promise.resolve();
    expect(second).toBe(false);
    expect(coord.snapshot().pool2InUse).toBe(1);
  });
});