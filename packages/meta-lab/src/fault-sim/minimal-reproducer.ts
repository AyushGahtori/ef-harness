import type { ScheduledFault } from "./types.js";

export interface MinimizeOptions {
  readonly seed: number;
  readonly faults: readonly ScheduledFault[];
  readonly fails: (subset: readonly ScheduledFault[]) => boolean;
  readonly targetMax?: number;
}

export interface MinimizeResult {
  readonly seed: number;
  readonly originalCount: number;
  readonly minimalCount: number;
  readonly minimalFaults: readonly ScheduledFault[];
  readonly reproducerTs: string;
}

/**
 * Delta-debugging shrink for fault schedules. Emits a standalone Vitest regression snippet.
 */
export class MinimalFaultReproducerExporter {
  minimize(options: MinimizeOptions): MinimizeResult {
    const { seed, faults, fails, targetMax = 3 } = options;
    if (!fails(faults)) {
      throw new Error("cannot minimize a schedule that already passes");
    }

    let current = [...faults];
    outer: while (current.length > targetMax) {
      let shrunk = false;
      for (let i = 0; i < current.length; i += 1) {
        const trial = current.filter((_, idx) => idx !== i);
        if (trial.length === 0) continue;
        if (fails(trial)) {
          current = trial;
          shrunk = true;
          break;
        }
      }
      if (!shrunk) break outer;
    }

    outer2: while (current.length > targetMax) {
      for (let i = 0; i < current.length; i += 1) {
        const trial = current.filter((_, idx) => idx !== i);
        if (trial.length >= targetMax && fails(trial)) {
          current = trial;
          continue outer2;
        }
      }
      break;
    }

    while (current.length > 1) {
      const half = Math.ceil(current.length / 2);
      const left = current.slice(0, half);
      if (left.length > 0 && fails(left)) {
        current = left;
        continue;
      }
      const right = current.slice(half);
      if (right.length > 0 && fails(right)) {
        current = right;
        continue;
      }
      break;
    }

    return {
      seed,
      originalCount: faults.length,
      minimalCount: current.length,
      minimalFaults: current,
      reproducerTs: MinimalFaultReproducerExporter.emitVitest(seed, current),
    };
  }

  static emitVitest(seed: number, faults: readonly ScheduledFault[]): string {
    const serialized = JSON.stringify(faults, null, 2);
    return `import { describe, expect, it } from "vitest";
import { SeededChaosScenarioMatrix } from "../src/fault-sim/scenario-matrix.js";

describe("chaos-repro-${seed}", () => {
  it("replays minimal fault schedule for seed ${seed}", () => {
    const full = SeededChaosScenarioMatrix.schedule(${seed});
    expect(full.length).toBeGreaterThan(0);
    const minimal = ${serialized} as const;
    expect(minimal.length).toBeLessThanOrEqual(3);
  });
});
`;
  }
}