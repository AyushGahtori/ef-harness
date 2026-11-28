import { describe, expect, it } from "vitest";
import {
  BurnRateWindowTracker,
  harnessCeilingPpm,
  windDownThresholdPpm,
} from "../../src/pacing/index.js";
import type { WindowUsage } from "../../src/pacing/index.js";

function window(kind: WindowUsage["kind"], start: number, durationMs: number): WindowUsage {
  return {
    kind,
    windowStartMs: start,
    windowEndMs: start + durationMs,
    durationMs,
    usedPpm: 0,
    observedPpm: null,
    reservedInFlightPpm: 0,
    source: "harness_estimate",
    observedAtMs: null,
  };
}

describe("pacing burn-rate window tracker", () => {
  it("protects a 20% reserve with an 800_000 ceiling and a 720_000 wind-down", () => {
    const tracker = new BurnRateWindowTracker(0.2, [window("5h", 0, 5 * 60 * 60 * 1000)]);
    expect(harnessCeilingPpm(0.2)).toBe(800_000);
    expect(tracker.ceilingPpm).toBe(800_000);
    expect(windDownThresholdPpm(800_000)).toBe(720_000);
    expect(tracker.windDownPpm).toBe(720_000);
    expect(tracker.pacedBackgroundSlots(4, 0)).toBe(4);
  });

  it("steps paced concurrency down as usage nears the wind-down and stops new work at 720_000", () => {
    const tracker = new BurnRateWindowTracker(0.2, [window("5h", 0, 5 * 60 * 60 * 1000)]);
    tracker.applyAuthoritative("5h", 700_000, 1_000, "account/rateLimits/read");
    expect(tracker.pacedBackgroundSlots(4, 1_000)).toBe(2);
    expect(tracker.allowsAdditiveIncrease()).toBe(false);
    tracker.applyAuthoritative("5h", 720_000, 2_000, "account/rateLimits/read");
    expect(tracker.pacedBackgroundSlots(4, 2_000)).toBe(0);
    expect(tracker.crossedWindDown()).toBe(true);
    expect(tracker.tryHold(1)).toBe(true);
    expect(tracker.tryHold(80_000)).toBe(false);
    expect(tracker.usedPpm("5h")).toBe(720_000);
  });

  it("tracks the short 5h window and the long weekly window and binds the tighter one", () => {
    const tracker = new BurnRateWindowTracker(0.2, [
      window("5h", 0, 5 * 60 * 60 * 1000),
      window("weekly", 0, 7 * 24 * 60 * 60 * 1000),
    ]);
    tracker.applyAuthoritative("5h", 100_000, 1_000, "estimate");
    tracker.applyAuthoritative("weekly", 750_000, 1_000, "estimate");
    expect(tracker.bindingWindow(1_000)?.kind).toBe("weekly");
    expect(tracker.pacedBackgroundSlots(4, 1_000)).toBe(0);
    expect(tracker.usedPpm("5h")).toBe(100_000);
  });

  it("refuses a hold that would cross the harness ceiling", () => {
    const tracker = new BurnRateWindowTracker(0.2, [window("5h", 0, 5 * 60 * 60 * 1000)]);
    tracker.applyAuthoritative("5h", 790_000, 1_000, "estimate");
    expect(tracker.tryHold(20_000)).toBe(false);
    expect(tracker.tryHold(10_000)).toBe(true);
    expect(tracker.settledAtCeiling()).toBe(false);
    tracker.releaseHold(10_000);
    tracker.settle(0, 10_000, 2_000);
    expect(tracker.usedPpm("5h")).toBe(800_000);
    expect(tracker.settledAtCeiling()).toBe(true);
  });

  it("slows when the observed burn would empty the window early", () => {
    const start = 0;
    const tracker = new BurnRateWindowTracker(0, [window("5h", start, 5 * 60 * 60 * 1000)]);
    tracker.settle(0, 100_000, 1_000);
    tracker.settle(0, 100_000, 2_000);
    const paced = tracker.pacedBackgroundSlots(4, 2_000);
    expect(paced).toBeLessThan(4);
    expect(paced).toBeGreaterThan(0);
  });
});
