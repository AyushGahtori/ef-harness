import { describe, expect, it } from "vitest";
import { PerformanceAndScaleCertifier } from "./certifier.ts";
import { SCALE_BENCHMARK_SCORECARD_SCHEMA } from "./types.ts";
import { certifyInjectedBoard, certifyInjectedDb } from "./ports/db-board.ts";

describe("PerformanceAndScaleCertifier", () => {
  it("emits ScaleBenchmarkScorecard JSON with every SLO", async () => {
    const certifier = new PerformanceAndScaleCertifier();
    const result = await certifier.runAll();
    expect(result.scorecard.schema).toBe(SCALE_BENCHMARK_SCORECARD_SCHEMA);
    expect(result.scorecard.metrics.length).toBe(6);
    expect(result.scorecard.allPass, JSON.stringify(result.scorecard, null, 2)).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.markdown).toContain("Performance & Scale Benchmark Scorecard");
    for (const metric of result.scorecard.metrics) {
      expect(metric.threshold.length).toBeGreaterThan(0);
      expect(["pass", "fail"]).toContain(metric.passFail);
    }
  }, 240_000);

  it("fail-closed probes catch DB and Board regressions", () => {
    expect(certifyInjectedDb(95, 1).pass).toBe(false);
    expect(certifyInjectedBoard(8, 24).pass).toBe(false);
  });
});