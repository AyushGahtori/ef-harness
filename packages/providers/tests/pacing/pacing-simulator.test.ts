import { describe, expect, it } from "vitest";
import { simulateFiveHourChatGptPlusWindow } from "../../src/pacing/index.js";

describe("pacing five-hour discrete-event simulator", () => {
  it("protects a 20% reserve across 30 tasks, a transient 429, and k[model] calibration", async () => {
    const report = await simulateFiveHourChatGptPlusWindow();
    expect(report.startedCwnd).toBe(2);
    expect(report.peakCwnd).toBeGreaterThanOrEqual(3);
    expect(report.saw429Halving).toBe(true);
    expect(report.minCwndAfter429).toBeLessThan(report.peakCwnd);
    expect(report.ceilingPpm).toBe(800_000);
    expect(report.finalUsedPpm).toBeGreaterThan(0);
    expect(report.finalUsedPpm).toBeLessThanOrEqual(800_000);
    expect(report.crossedReserve).toBe(false);
    expect(report.tasksCompleted).toBeGreaterThan(0);
    expect(report.tasksRemaining).toBeGreaterThan(0);
    expect(report.tasksDispatched).toBe(report.providerCalls);
    expect(report.providerCallsAfterCwndZero).toBe(0);
    expect(report.windowMs).toBe(5 * 60 * 60 * 1000);
    const priorError = Math.abs(report.priorPpmPer1k - report.truePpmPer1k);
    const learnedError = Math.abs(report.learnedPpmPer1k - report.truePpmPer1k);
    expect(learnedError).toBeLessThan(priorError / 2);
  });
});
