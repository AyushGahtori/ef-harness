import { describe, expect, it } from "vitest";

import { HeftCriticalPathScheduler, SchedulerError } from "../../src/scheduler/index.js";
import type { ScheduleTask } from "../../src/scheduler/index.js";
import { kitchenGraph, task } from "./fixtures.js";

function node(partial: Partial<ScheduleTask> & Pick<ScheduleTask, "id" | "avgExecTimeMs">): ScheduleTask {
  return task({ featureId: partial.id, featureSlug: "leaf", successors: [], ...partial });
}

describe("HeftCriticalPathScheduler rank", () => {
  const scheduler = new HeftCriticalPathScheduler();

  it("computes HEFT upward rank with communication delay", () => {
    const tasks = [
      node({ id: "A", avgExecTimeMs: 10, successors: [] }),
      node({ id: "B", avgExecTimeMs: 4, successors: [] }),
      node({ id: "C", avgExecTimeMs: 3, successors: [] }),
      node({ id: "D", avgExecTimeMs: 6, successors: [] }),
    ];
    tasks[0]?.successors.push({ to: "B", commDelayMs: 2 }, { to: "C", commDelayMs: 5 });
    tasks[1]?.successors.push({ to: "D", commDelayMs: 1 });
    tasks[2]?.successors.push({ to: "D", commDelayMs: 1 });
    const ranks = scheduler.rank({ tasks });
    expect(ranks.rankUMs.get("D")).toBe(6);
    expect(ranks.rankUMs.get("B")).toBe(11);
    expect(ranks.rankUMs.get("C")).toBe(10);
    expect(ranks.rankUMs.get("A")).toBe(25);
    expect(ranks.criticalPathMs).toBe(25);
    expect(ranks.criticalTaskIds).toEqual(["A", "C", "D"]);
  });

  it("rejects a dependency cycle", () => {
    const tasks = [
      node({ id: "A", avgExecTimeMs: 5, successors: [{ to: "B", commDelayMs: 0 }] }),
      node({ id: "B", avgExecTimeMs: 5, successors: [{ to: "A", commDelayMs: 0 }] }),
    ];
    expect(() => scheduler.rank({ tasks })).toThrow(SchedulerError);
    try {
      scheduler.rank({ tasks });
    } catch (error) {
      expect(error).toBeInstanceOf(SchedulerError);
      expect((error as SchedulerError).code).toBe("cycle");
    }
  });

  it("ranks a 500-task kitchen graph in under 10 ms after warmup", () => {
    const graph = kitchenGraph(20, 4, 120);
    scheduler.rank(graph);
    const started = performance.now();
    scheduler.rank(graph);
    expect(performance.now() - started).toBeLessThan(10);
  });
});
