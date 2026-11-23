import { describe, expect, it } from "vitest";
import {
  ModelAllowanceWeightLearner,
  RESERVATION_SAFETY_MARGIN,
  formatFiveHourShare,
} from "../../src/pacing/index.js";

describe("pacing model allowance weight learner", () => {
  it("seeds k[model] from a signed policy prior and reserves tokens × k × 1.3", () => {
    const learner = new ModelAllowanceWeightLearner("chatgpt-plus");
    learner.seed("gpt-5.x-mini", 4_000);
    learner.seed("gpt-5.x-pro", 12_000);
    const mini = learner.view("gpt-5.x-mini");
    expect(mini.precision).toBe("prior");
    expect(mini.ppmPer1k).toBe(4_000);
    expect(learner.reservationPpm("gpt-5.x-mini", 1_000)).toBe(
      Math.round(4_000 * RESERVATION_SAFETY_MARGIN),
    );
    expect(learner.view("gpt-5.x-pro").ppmPer1k).toBe(12_000);
    const prediction = learner.predictWindowShare("gpt-5.x-mini", 30_000);
    expect(prediction.expectedPpm).toBe(120_000);
    expect(prediction.label).toBe("~12% of 5h window");
    expect(formatFiveHourShare(120_000)).toBe("~12% of 5h window");
    const feed = learner.feeds().find((item) => item.modelId === "gpt-5.x-mini");
    expect(feed?.allowancePpmPer1M).toBe(4_000_000n);
  });

  it("converges k[model] against repeated quota deltas without leaving the prior band", () => {
    const learner = new ModelAllowanceWeightLearner("chatgpt-plus");
    learner.seed("gpt-5.x-mini", 8_000);
    for (let index = 0; index < 12; index += 1) {
      learner.observe({
        connectionId: "chatgpt-plus",
        modelId: "gpt-5.x-mini",
        effectiveTokens: 8_000,
        deltaPpm: 20_000,
        source: "rateLimits/read",
      });
    }
    const view = learner.view("gpt-5.x-mini");
    expect(view.precision).toBe("calibrated");
    expect(view.ppmPer1k).toBeGreaterThan(2_200);
    expect(view.ppmPer1k).toBeLessThan(2_800);
    expect(learner.view("gpt-5.x-pro").precision).toBe("prior");
  });

  it("does not divide by zero when the provider reports no tokens", () => {
    const learner = new ModelAllowanceWeightLearner("chatgpt-plus");
    learner.seed("gpt-5.x-mini", 4_000);
    const view = learner.observe({
      connectionId: "chatgpt-plus",
      modelId: "gpt-5.x-mini",
      effectiveTokens: 0,
      deltaPpm: 50_000,
      source: "header_remaining_percent",
    });
    expect(view.ppmPer1k).toBe(4_000);
    expect(view.precision).toBe("prior");
    expect(view.quotaSamples).toBe(0);
  });

  it("estimates an opaque window from reset timestamps and refuses false precision", () => {
    const learner = new ModelAllowanceWeightLearner("chatgpt-plus");
    learner.seed("gpt-5.x-mini", 4_000);
    const untouched = learner.observeUsageLimitReset({
      connectionId: "chatgpt-plus",
      modelId: "gpt-5.x-mini",
      tokensSinceLastReset: 0,
      resetAtMs: 1_700_000_000_000,
      previousResetAtMs: null,
    });
    expect(untouched.precision).toBe("prior");
    expect(untouched.ppmPer1k).toBe(4_000);
    expect(untouched.lastResetAtMs).toBe(1_700_000_000_000);
    const coarse = learner.observeUsageLimitReset({
      connectionId: "chatgpt-plus",
      modelId: "gpt-5.x-mini",
      tokensSinceLastReset: 100_000,
      resetAtMs: 1_700_018_000_000,
      previousResetAtMs: 1_700_000_000_000,
    });
    expect(coarse.precision).toBe("coarse_reset_estimate");
    expect(coarse.ppmPer1k).toBeGreaterThan(4_000);
    expect(coarse.previousResetAtMs).toBe(1_700_000_000_000);
    expect(coarse.quotaSamples).toBe(0);
  });
});
