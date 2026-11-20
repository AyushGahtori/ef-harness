import { describe, expect, it } from "vitest";
import {
  HistoricalPassRateCalibrator,
  PRIOR_STRENGTH,
  VersionedModelRoster,
  betaBinomialMean,
  passObservationsFromTelemetry,
  passPriors,
} from "../../src/crew-levels/index.js";
import type { PassObservation } from "../../src/crew-levels/index.js";
import { model } from "./fixtures.js";

function runs(count: number, passed: boolean, phase: PassObservation["phase"] = "first_pass"): PassObservation[] {
  return Array.from({ length: count }, () => ({
    modelId: "m-junior",
    difficulty: "standard" as const,
    language: "ts",
    passed,
    phase,
  }));
}

describe("HistoricalPassRateCalibrator", () => {
  it("stays on the roster prior at zero observations and never divides by zero", () => {
    expect(betaBinomialMean(0.7, 0, 0)).toBeCloseTo(0.7, 10);
    expect(betaBinomialMean(0, 0, 0)).toBe(0.05);
    expect(betaBinomialMean(1, 0, 0)).toBe(0.98);
    expect(betaBinomialMean(0.01, 0, 50)).toBe(0.05);
    expect(betaBinomialMean(0.99, 50, 0)).toBe(0.98);
  });

  it("does not swing on the first one to five observations", () => {
    for (let count = 1; count <= 5; count += 1) {
      const bound = count / (count + PRIOR_STRENGTH);
      const failed = betaBinomialMean(0.7, 0, count);
      const passed = betaBinomialMean(0.7, count, 0);
      expect(Math.abs(failed - 0.7)).toBeLessThanOrEqual(bound + 1e-12);
      expect(Math.abs(passed - 0.7)).toBeLessThanOrEqual(bound + 1e-12);
      expect(failed).toBeGreaterThan(0.2);
      expect(passed).toBeLessThan(0.98);
    }
    expect(betaBinomialMean(0.7, 0, 1)).toBeCloseTo(7 / 11, 10);
  });

  it("converges smoothly across 50 simulated runs and keeps first-pass separate from retries", () => {
    let previous = 0.7;
    for (let successes = 1; successes <= 50; successes += 1) {
      const next = betaBinomialMean(0.7, successes, 0);
      expect(next).toBeGreaterThan(previous);
      expect(next).toBeLessThanOrEqual(0.98);
      previous = next;
    }
    expect(betaBinomialMean(0.7, 45, 5)).toBeGreaterThan(0.8);
    expect(betaBinomialMean(0.7, 45, 5)).toBeLessThan(0.9);

    const roster = VersionedModelRoster.seed([
      model({ modelId: "m-junior", tier: "junior", priors: passPriors("junior", { standard: 0.7 }) }),
      model({ modelId: "m-other", tier: "mid" }),
    ]);
    const observations = [
      ...runs(45, true),
      ...runs(5, false),
      ...runs(50, false, "retry").map((observation) => ({ ...observation, language: "py" })),
      ...runs(50, false).map((observation) => ({
        ...observation,
        modelId: "m-other",
        difficulty: "critical" as const,
      })),
    ];
    const calibrator = HistoricalPassRateCalibrator.fromRoster(roster, observations);
    const first = calibrator.firstPass("m-junior", "standard", "ts");
    const retry = calibrator.retry("m-junior", "standard", "ts");
    const otherLanguage = calibrator.firstPass("m-junior", "standard", "py");
    const otherModel = calibrator.firstPass("m-other", "standard", "ts");
    expect(first.observations).toBe(50);
    expect(first.stronglyShifted).toBe(true);
    expect(first.probability).toBeGreaterThan(0.8);
    expect(first.probability).toBeLessThan(0.9);
    expect(retry.observations).toBe(0);
    expect(retry.probability).toBeCloseTo(0.7, 10);
    expect(otherLanguage.observations).toBe(0);
    expect(otherModel.probability).toBeCloseTo(otherModel.prior, 10);
  });

  it("reads metric telemetry rows and ignores other kinds", () => {
    const parsed = passObservationsFromTelemetry([
      { kind: "heartbeat", data: { modelId: "m", difficulty: "standard", language: "ts", passed: true, phase: "first_pass" } },
      { kind: "metric", data: { modelId: "m", difficulty: "standard", language: "ts", passed: false, phase: "retry" } },
      { kind: "metric", data: { note: "not an outcome" } },
    ]);
    expect(parsed).toEqual([
      { modelId: "m", difficulty: "standard", language: "ts", passed: false, phase: "retry" },
    ]);
  });
});
