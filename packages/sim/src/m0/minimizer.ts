import { replaySeed, runSimulation, type SimRunResult } from "./simulator.js";

export interface MinimizeResult {
  seed: number;
  failed: boolean;
  events: number;
  traceHash: string;
  violations: readonly string[];
  trace: readonly string[];
}

/**
 * Replays a seed and, when it fails, binary-searches the shortest event prefix
 * that still violates an invariant after recovery.
 */
export async function minimizeFailingSeed(seed: number): Promise<MinimizeResult> {
  const full = await replaySeed(seed);
  if (full.passed) {
    return {
      seed,
      failed: false,
      events: full.eventsRun,
      traceHash: full.traceHash,
      violations: [],
      trace: full.trace,
    };
  }
  let low = 1;
  let high = Math.max(1, full.eventsRun);
  let best: SimRunResult = full;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const prefix = await runSimulation({ seed, mode: "memory", maxEvents: mid, realPipe: false });
    if (!prefix.passed) {
      best = prefix;
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return {
    seed,
    failed: true,
    events: best.eventsRun,
    traceHash: best.traceHash,
    violations: best.violations,
    trace: best.trace,
  };
}
