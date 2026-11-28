import { describe, expect, it } from "vitest";
import { HeftCriticalPathScheduler, SchedulerError, createScheduleState } from "../../src/index.js";
import type { WorkloadFootprint } from "../../src/index.js";
import { task } from "./fixtures.js";

describe("Heft workload footprints", () => {
  it("accepts uppercase pressure and replaces exec time with the learned wall clock", () => {
    const scheduler = new HeftCriticalPathScheduler();
    const graph = {
      tasks: [task({ id: "T1", featureId: "f1", featureSlug: "f1", avgExecTimeMs: 60_000 })],
    };
    const state = createScheduleState({
      graph,
      governorPressure: "GREEN",
      hardwarePoolCap: 2,
      worktreeSlotCap: 2,
    });
    const footprints: readonly WorkloadFootprint[] = [
      { taskId: "T1", predictedMb: 900, wallClockMs: 12_000 },
    ];
    const plain = scheduler.schedule(state);
    const learned = scheduler.scheduleWithFootprints(state, footprints);
    expect(state.governorPressure).toBe("GREEN");
    expect(learned.parallelism.wEff).toBe(plain.parallelism.wEff);
    expect(plain.projection.criticalPathMinutes).toBe(1);
    expect(learned.projection.criticalPathMinutes).toBe(0.2);
    expect(scheduler.rank(graph, { T1: 12_000 }).criticalPathMs).toBe(12_000);
    expect(() =>
      scheduler.scheduleWithFootprints(state, [{ taskId: "T1", predictedMb: 1, wallClockMs: 0 }]),
    ).toThrow(SchedulerError);
  });
});
