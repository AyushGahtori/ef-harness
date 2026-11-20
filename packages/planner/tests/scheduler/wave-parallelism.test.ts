import { describe, expect, it } from "vitest";

import {
  SEQUENTIAL_CHAIN_REASON,
  WaveParallelismCalculator,
  writeScopesOverlap,
} from "../../src/scheduler/index.js";
import type { ScheduleTask } from "../../src/scheduler/index.js";
import { independent, link, task } from "./fixtures.js";

function chain(): ScheduleTask[] {
  const tasks = ["T1", "T2", "T3", "T4"].map((id, index) =>
    task({
      id,
      featureId: id,
      featureSlug: `step-${index + 1}`,
      writeScope: [`src/${id}/**`],
      avgExecTimeMs: 60_000,
      successors: [],
    }),
  );
  link(tasks, "T1", "T2");
  link(tasks, "T2", "T3");
  link(tasks, "T3", "T4");
  return tasks;
}

describe("WaveParallelismCalculator", () => {
  const calculator = new WaveParallelismCalculator();

  it("caps a pure chain at one worker even under Fastest", () => {
    const decision = calculator.calculate({
      graph: { tasks: chain() },
      hardwarePoolCap: 8,
      governorPressure: "Green",
      providerPacingCap: 8,
      worktreeSlotCap: 8,
      preset: "Fastest",
      developerMax: null,
    });
    expect(decision.dagDisjointWidth).toBe(1);
    expect(decision.wEff).toBe(1);
    expect(decision.sequentialChain).toBe(true);
    expect(decision.reason).toBe(SEQUENTIAL_CHAIN_REASON);
    expect(decision.bindingConstraint).toBe("dag_disjoint_width");
  });

  it("uses the tightest cap across width, hardware, pacing, slots, and preset", () => {
    const graph = independent(["a", "b", "c", "d", "e", "f"], 60_000);
    const base = {
      graph,
      hardwarePoolCap: 10,
      governorPressure: "Green" as const,
      providerPacingCap: 10,
      worktreeSlotCap: 10,
      developerMax: null,
    };
    expect(calculator.calculate({ ...base, preset: "Fastest" }).wEff).toBe(6);
    expect(calculator.calculate({ ...base, preset: "Fastest", hardwarePoolCap: 2 }).bindingConstraint).toBe(
      "hardware_pool_cap",
    );
    expect(calculator.calculate({ ...base, preset: "Fastest", hardwarePoolCap: 2 }).wEff).toBe(2);
    expect(calculator.calculate({ ...base, preset: "Fastest", providerPacingCap: 1 }).wEff).toBe(1);
    expect(calculator.calculate({ ...base, preset: "Fastest", worktreeSlotCap: 3 }).wEff).toBe(3);
    expect(calculator.calculate({ ...base, preset: "Balanced" }).wEff).toBe(5);
    expect(calculator.calculate({ ...base, preset: "Cheapest" }).wEff).toBe(3);
    expect(calculator.calculate({ ...base, preset: "Fastest", developerMax: 2 }).wEff).toBe(2);
    const orange = calculator.calculate({
      ...base,
      preset: "Fastest",
      governorPressure: "Orange",
    });
    expect(orange.wEff).toBe(1);
    expect(orange.hardwarePoolCap).toBe(1);
    const yellow = calculator.calculate({
      ...base,
      preset: "Fastest",
      hardwarePoolCap: 8,
      governorPressure: "Yellow",
    });
    expect(yellow.hardwarePoolCap).toBe(4);
    expect(yellow.wEff).toBe(4);
  });

  it("shrinks width when write scopes overlap and keeps Windows case folding", () => {
    const tasks = [
      task({
        id: "Left",
        featureId: "left",
        featureSlug: "left",
        writeScope: ["src/shared/**"],
        successors: [],
      }),
      task({
        id: "Right",
        featureId: "right",
        featureSlug: "right",
        writeScope: ["src/shared/orders.ts"],
        successors: [],
      }),
    ];
    const decision = calculator.calculate({
      graph: { tasks },
      hardwarePoolCap: 4,
      governorPressure: "Green",
      providerPacingCap: 4,
      worktreeSlotCap: 4,
      preset: "Fastest",
      developerMax: null,
    });
    expect(decision.dagDisjointWidth).toBe(1);
    expect(decision.sequentialChain).toBe(false);
    expect(decision.reason).not.toBe(SEQUENTIAL_CHAIN_REASON);
    expect(writeScopesOverlap(["src/api/**"], ["src/api/orders.ts"])).toBe(true);
    expect(writeScopesOverlap(["src/Order.ts"], ["src/order.ts"])).toBe(true);
    expect(writeScopesOverlap(["src/menu/**"], ["src/orders/**"])).toBe(false);
  });
});
