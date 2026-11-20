import { describe, expect, it } from "vitest";

import {
  DynamicScheduleRebalancer,
  HeftCriticalPathScheduler,
  SEQUENTIAL_CHAIN_REASON,
  createScheduleState,
  writeScopesOverlap,
} from "../../src/scheduler/index.js";
import type { ScheduleTask, TaskPlacement } from "../../src/scheduler/index.js";
import { kitchenGraph, link, task } from "./fixtures.js";

function overlaps(left: TaskPlacement, right: TaskPlacement): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

function assertDisjoint(placements: readonly TaskPlacement[]): void {
  for (let left = 0; left < placements.length; left += 1) {
    for (let right = left + 1; right < placements.length; right += 1) {
      const a = placements[left];
      const b = placements[right];
      if (!a || !b || !overlaps(a, b)) continue;
      expect(a.featureId).not.toBe(b.featureId);
      expect(writeScopesOverlap(a.writeScope, b.writeScope)).toBe(false);
    }
  }
}

describe("HEFT simulation", () => {
  const scheduler = new HeftCriticalPathScheduler();

  it("beats FIFO on an asymmetric branch and finishes every task", () => {
    const tasks: ScheduleTask[] = [
      task({ id: "A-Short", featureId: "a", featureSlug: "a", avgExecTimeMs: 10_000, writeScope: ["src/a/**"] }),
      task({ id: "B-Short", featureId: "b", featureSlug: "b", avgExecTimeMs: 10_000, writeScope: ["src/b/**"] }),
      task({ id: "C-Short", featureId: "c", featureSlug: "c", avgExecTimeMs: 10_000, writeScope: ["src/c/**"] }),
      task({ id: "T-Long", featureId: "long", featureSlug: "long", avgExecTimeMs: 100_000, writeScope: ["src/long/**"] }),
      task({ id: "T-End", featureId: "end", featureSlug: "end", avgExecTimeMs: 1_000, writeScope: ["src/end/**"] }),
    ];
    link(tasks, "T-Long", "T-End");
    const state = createScheduleState({
      graph: { tasks },
      preset: "Fastest",
      hardwarePoolCap: 2,
      worktreeSlotCap: 8,
    });
    const heft = scheduler.project(state, { policy: "heft", workerCap: 2 });
    const fifo = scheduler.project(state, { policy: "fifo", workerCap: 2 });
    expect(heft.startOrder[0]).toBe("T-Long");
    expect(fifo.startOrder[0]).toBe("A-Short");
    expect(heft.parallelMinutes).toBeLessThan(fifo.parallelMinutes);
    expect(heft.startOrder).toHaveLength(5);
    assertDisjoint(heft.placements);
  });

  it("reports a sequential chain instead of fake parallelism", () => {
    const tasks = ["T1", "T2", "T3", "T4"].map((id, index) =>
      task({
        id,
        featureId: id,
        featureSlug: `step-${index + 1}`,
        avgExecTimeMs: 10 * 60_000,
        writeScope: [`src/${id}/**`],
        successors: [],
      }),
    );
    link(tasks, "T1", "T2");
    link(tasks, "T2", "T3");
    link(tasks, "T3", "T4");
    const scheduled = scheduler.schedule(
      createScheduleState({
        graph: { tasks },
        preset: "Fastest",
        hardwarePoolCap: 8,
        worktreeSlotCap: 8,
      }),
    );
    expect(scheduled.parallelism.wEff).toBe(1);
    expect(scheduled.parallelism.reason).toBe(SEQUENTIAL_CHAIN_REASON);
    expect(scheduled.projection.summary).toBe(SEQUENTIAL_CHAIN_REASON);
    expect(scheduled.projection.peakWorkers).toBe(1);
    expect(scheduled.projection.parallelSpeedupFactor).toBeLessThan(1.25);
  });

  it("reaches at least 2x over sequential M2 on 50-task and 500-task kitchen graphs", () => {
    for (const graph of [kitchenGraph(2, 4, 12), kitchenGraph(20, 4, 120)]) {
      const scheduled = scheduler.schedule(
        createScheduleState({
          graph,
          preset: "Fastest",
          hardwarePoolCap: 8,
          worktreeSlotCap: 8,
        }),
      );
      expect(scheduled.projection.parallelSpeedupFactor).toBeGreaterThanOrEqual(2);
      expect(scheduled.projection.startOrder).toHaveLength(graph.tasks.length);
      expect(scheduled.projection.summary).toMatch(/parallel workers vs ~/);
      expect(scheduled.projection.activeSlotsByTime.length).toBeGreaterThan(0);
      expect(scheduled.projection.criticalPathMinutes).toBeGreaterThan(0);
      assertDisjoint(scheduled.projection.placements);
    }
  });

  it("runs the critical path before explicit work and explicit work before polish", () => {
    const tasks = [
      task({
        id: "CP",
        featureId: "cp",
        featureSlug: "cp",
        avgExecTimeMs: 500_000,
        writeScope: ["src/cp/**"],
      }),
      task({
        id: "Explicit",
        featureId: "explicit",
        featureSlug: "explicit",
        avgExecTimeMs: 80_000,
        explicit: true,
        writeScope: ["src/explicit/**"],
      }),
      task({
        id: "Polish",
        featureId: "polish",
        featureSlug: "polish",
        avgExecTimeMs: 100_000,
        explicit: false,
        optionalPolish: true,
        writeScope: ["src/polish/**"],
      }),
    ];
    const projected = scheduler.project(
      createScheduleState({ graph: { tasks }, preset: "Balanced", hardwarePoolCap: 1, worktreeSlotCap: 4 }),
      { policy: "heft", workerCap: 1 },
    );
    expect(projected.startOrder).toEqual(["CP", "Explicit", "Polish"]);
  });

  it("ages a long-waiting equal-rank task ahead of a younger one and still finishes the short leaf", () => {
    const aged = scheduler.project(
      createScheduleState({
        graph: {
          tasks: [
            task({ id: "A-new", featureId: "a", featureSlug: "a", avgExecTimeMs: 10_000 }),
            task({ id: "Z-old", featureId: "z", featureSlug: "z", avgExecTimeMs: 10_000 }),
          ],
        },
        preset: "Balanced",
        hardwarePoolCap: 1,
        worktreeSlotCap: 4,
        skippedRounds: { "Z-old": 5 },
      }),
      { policy: "heft", workerCap: 1 },
    );
    expect(aged.startOrder[0]).toBe("Z-old");

    const starved = scheduler.project(
      createScheduleState({
        graph: {
          tasks: [40, 30, 20, 10].map((minutes) =>
            task({
              id: `T-${minutes}`,
              featureId: `f-${minutes}`,
              featureSlug: `f-${minutes}`,
              avgExecTimeMs: minutes * 60_000,
              writeScope: [`src/f-${minutes}/**`],
            }),
          ),
        },
        preset: "Fastest",
        hardwarePoolCap: 1,
        worktreeSlotCap: 4,
      }),
      { policy: "heft", workerCap: 1 },
    );
    expect(starved.startOrder).toEqual(["T-40", "T-30", "T-20", "T-10"]);
  });

  it("batches same-feature siblings under Cheapest", () => {
    const tasks = [
      task({ id: "b-f1", featureId: "f1", featureSlug: "f1", avgExecTimeMs: 10_000, writeScope: ["src/f1/b.ts"] }),
      task({ id: "c-f2", featureId: "f2", featureSlug: "f2", avgExecTimeMs: 10_000, writeScope: ["src/f2/c.ts"] }),
      task({ id: "d-f1", featureId: "f1", featureSlug: "f1", avgExecTimeMs: 10_000, writeScope: ["src/f1/d.ts"] }),
      task({ id: "e-f2", featureId: "f2", featureSlug: "f2", avgExecTimeMs: 10_000, writeScope: ["src/f2/e.ts"] }),
    ];
    const cheapest = scheduler.project(
      createScheduleState({ graph: { tasks }, preset: "Cheapest", hardwarePoolCap: 1, worktreeSlotCap: 4 }),
      { policy: "heft", workerCap: 1 },
    );
    expect(cheapest.startOrder).toEqual(["b-f1", "d-f1", "c-f2", "e-f2"]);
  });

  it("rebalances a 500-task graph in under 10 ms", () => {
    const graph = kitchenGraph(20, 4, 120);
    const rebalancer = new DynamicScheduleRebalancer();
    let state = createScheduleState({
      graph,
      preset: "Fastest",
      hardwarePoolCap: 8,
      worktreeSlotCap: 8,
    });
    for (let warm = 0; warm < 5; warm += 1) {
      rebalancer.rebalance(state, { type: "governor", pressure: "Green", nowMs: 0 });
    }
    const samples: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      const id = graph.tasks[index]?.id;
      if (!id) break;
      const started = performance.now();
      const result = rebalancer.rebalance(state, { type: "task_completed", taskId: id, nowMs: state.nowMs + 1 });
      samples.push(performance.now() - started);
      state = result.state;
    }
    const ordered = [...samples].sort((left, right) => left - right);
    const median = ordered[Math.floor(ordered.length / 2)] ?? Number.POSITIVE_INFINITY;
    const p90 = ordered[Math.floor(ordered.length * 0.9)] ?? Number.POSITIVE_INFINITY;
    expect(median).toBeLessThan(10);
    expect(p90).toBeLessThan(10);
  });
});
