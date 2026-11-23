import { describe, expect, it } from "vitest";
import {
  CI_CHAOS_SEED_COUNT,
  FullDaemonFaultSimulator,
  SeededChaosScenarioMatrix,
  TX_BOUNDARY_HOOKS,
  FAULT_CLASSES,
  writeChaosTrendReceipt,
  makeEphemeralRoot,
  removeEphemeralRoot,
} from "../../src/fault-sim/index.js";

describe("fault-sim chaos sweep", () => {
  it(
    `runs ${CI_CHAOS_SEED_COUNT} deterministic seeds with zero invariant violations`,
    async () => {
    const simulator = new FullDaemonFaultSimulator();
    const sweep = await simulator.runSweep(CI_CHAOS_SEED_COUNT);
    expect(sweep.failed).toBe(0);
    expect(sweep.passed).toBe(CI_CHAOS_SEED_COUNT);
    expect(sweep.elapsedMs).toBeLessThan(45_000);
    for (const hook of TX_BOUNDARY_HOOKS) {
      expect(sweep.coverage.hooks[hook]).toBeGreaterThan(0);
    }
    for (const cls of FAULT_CLASSES) {
      expect(sweep.coverage.classes[cls]).toBeGreaterThan(0);
    }
    const missing = SeededChaosScenarioMatrix.assertHookCoverage(sweep.coverage.hooks);
    expect(missing).toEqual([]);
    },
    120_000,
  );

  it(
    "records chaos trend receipts under the ephemeral artifact root",
    async () => {
    const simulator = new FullDaemonFaultSimulator();
    const sweep = await simulator.runSweep(5);
    const root = makeEphemeralRoot("ef-chaos-receipt-");
    try {
      const receipt = writeChaosTrendReceipt(root, sweep);
      expect(receipt.task).toBe("Task-192");
      expect(receipt.passed).toBe(5);
    } finally {
      removeEphemeralRoot(root);
    }
    },
    60_000,
  );
});