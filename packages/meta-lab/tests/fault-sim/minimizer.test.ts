import { describe, expect, it } from "vitest";
import {
  MinimalFaultReproducerExporter,
  SeededChaosScenarioMatrix,
  type ScheduledFault,
} from "../../src/fault-sim/index.js";

describe("MinimalFaultReproducerExporter", () => {
  it("shrinks a 12-fault synthetic schedule to at most 2 minimal triggers", () => {
    const seed = 44_109;
    const faults = SeededChaosScenarioMatrix.schedule(seed, 12);
    const exporter = new MinimalFaultReproducerExporter();
    const failPredicate = (subset: readonly ScheduledFault[]): boolean => {
      if (subset.length < 2) return false;
      const classes = new Set(subset.map((f) => f.class));
      return classes.has("disk_ram") && classes.has("foreign_cli");
    };
    const result = exporter.minimize({ seed, faults, fails: failPredicate, targetMax: 2 });
    expect(result.originalCount).toBe(12);
    expect(result.minimalCount).toBeLessThanOrEqual(2);
    expect(failPredicate(result.minimalFaults)).toBe(true);
    expect(result.reproducerTs).toContain(`chaos-repro-${seed}`);
  });
});