import { describe, expect, it } from "vitest";

import { MasterPlanError, WaveDagBuilder } from "../../src/master-plan/index.js";
import type { PlannedFeature } from "../../src/master-plan/index.js";

function feature(overrides: Pick<PlannedFeature, "id"> & Partial<PlannedFeature>): PlannedFeature {
  return {
    title: overrides.id,
    dependsOn: [],
    active: true,
    verticalSlice: null,
    specItems: 0,
    screens: 0,
    endpoints: 0,
    estimatedLeafTasks: null,
    estimatedCostUnits: null,
    ...overrides,
  };
}

describe("WaveDagBuilder", () => {
  const builder = new WaveDagBuilder();

  it("assigns a dependency chain to strictly increasing waves and never colocates F-C with F-A", () => {
    const dag = builder.build(
      [
        feature({ id: "F-A", verticalSlice: true }),
        feature({ id: "F-B", dependsOn: ["F-A"] }),
        feature({ id: "F-C", dependsOn: ["F-B"] }),
      ],
      { breadthCap: 4, costPerLeafUnits: 100_000n },
    );
    expect(dag.waves.map((wave) => wave.featureIds)).toEqual([["F-A"], ["F-B"], ["F-C"]]);
    expect(dag.waves[0]?.status).toBe("planned");
    expect(dag.waves[0]?.projected).toBeNull();
    expect(dag.waves[0]?.leafTasks).toEqual([]);
    expect(dag.waves[2]?.status).toBe("projected");
    expect(dag.waves[2]?.leafTasks).toEqual([]);
    expect(dag.waves[2]?.projected?.taskCount).toEqual({ min: 1, max: 3 });
    expect(dag.completionWave).toMatchObject({
      id: "completion",
      ownerTask: "101",
      index: 4,
      status: "projected",
      leafTasks: [],
    });
    const waveOf = new Map<string, number>();
    for (const wave of dag.waves) {
      for (const id of wave.featureIds) waveOf.set(id, wave.index);
    }
    expect(waveOf.get("F-A")).toBeLessThan(waveOf.get("F-B") ?? 0);
    expect(waveOf.get("F-B")).toBeLessThan(waveOf.get("F-C") ?? 0);
    expect(dag.waves.some((wave) => wave.featureIds.includes("F-A") && wave.featureIds.includes("F-C"))).toBe(false);
  });

  it("caps breadth and keeps critical-path depth at the width lower bound", () => {
    const dag = builder.build(
      ["F-A", "F-B", "F-C", "F-D", "F-E"].map((id) => feature({ id, verticalSlice: id === "F-A" ? true : null })),
      { breadthCap: 2, costPerLeafUnits: 1_000n },
    );
    expect(dag.waves.map((wave) => wave.featureIds.length)).toEqual([2, 2, 1]);
    expect(dag.waves[0]?.featureIds[0]).toBe("F-A");
    expect(dag.waves.every((wave) => wave.featureIds.length <= 2)).toBe(true);
  });

  it("schedules the longer downstream chain before an independent short feature when breadth is 1", () => {
    const dag = builder.build(
      [
        feature({ id: "F-B", verticalSlice: true }),
        feature({ id: "F-B1", dependsOn: ["F-B"] }),
        feature({ id: "F-B2", dependsOn: ["F-B1"] }),
        feature({ id: "F-A" }),
      ],
      { breadthCap: 1, costPerLeafUnits: 1n },
    );
    expect(dag.waves.map((wave) => wave.featureIds)).toEqual([["F-B"], ["F-B1"], ["F-B2"], ["F-A"]]);
  });

  it("keeps the vertical slice in wave 1 even when another root has a longer chain", () => {
    const dag = builder.build(
      [
        feature({ id: "F-A", verticalSlice: true }),
        feature({ id: "F-B" }),
        feature({ id: "F-B1", dependsOn: ["F-B"] }),
        feature({ id: "F-B2", dependsOn: ["F-B1"] }),
      ],
      { breadthCap: 1, costPerLeafUnits: 1n },
    );
    expect(dag.waves.map((wave) => wave.featureIds)).toEqual([["F-A"], ["F-B"], ["F-B1"], ["F-B2"]]);
  });

  it("rejects a cycle with the cycle trace", () => {
    expect(() =>
      builder.build(
        [
          feature({ id: "F-A", dependsOn: ["F-B"], verticalSlice: true }),
          feature({ id: "F-B", dependsOn: ["F-A"] }),
        ],
        { breadthCap: 2, costPerLeafUnits: 1n },
      ),
    ).toThrow(MasterPlanError);
    try {
      builder.build(
        [
          feature({ id: "F-A", dependsOn: ["F-B"] }),
          feature({ id: "F-B", dependsOn: ["F-A"] }),
        ],
        { breadthCap: 2, costPerLeafUnits: 1n },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(MasterPlanError);
      expect((error as MasterPlanError).code).toBe("cycle");
      expect((error as MasterPlanError).message).toContain("F-A");
      expect((error as MasterPlanError).message).toContain("F-B");
    }
  });

  it("rejects a dangling dependency and a wave 1 with no vertical slice", () => {
    expect(() =>
      builder.build([feature({ id: "F-A", dependsOn: ["F-Z"], verticalSlice: true })], {
        breadthCap: 1,
        costPerLeafUnits: 1n,
      }),
    ).toThrow(expect.objectContaining({ code: "dangling_dependency" }));
    expect(() =>
      builder.build([feature({ id: "F-A", verticalSlice: false })], { breadthCap: 1, costPerLeafUnits: 1n }),
    ).toThrow(expect.objectContaining({ code: "wave1_missing_vertical_slice" }));
  });
});
