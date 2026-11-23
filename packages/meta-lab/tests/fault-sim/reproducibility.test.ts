import { describe, expect, it } from "vitest";
import { faultTraceIdentical, FullDaemonFaultSimulator } from "../../src/fault-sim/index.js";

describe("fault-sim reproducibility", () => {
  it(
    "replays an identical fault trace for the same seed",
    async () => {
    const simulator = new FullDaemonFaultSimulator();
    const seed = 9_842_173;
    const first = simulator.runSingle({ seed });
    const second = simulator.runSingle({ seed });
    expect(faultTraceIdentical(first, second)).toBe(true);
    expect(first.traceHash).toBe(second.traceHash);
    expect(first.passed).toBe(true);
    },
    30_000,
  );
});