import { describe, expect, it } from "vitest";
import {
  AimdConcurrencyRegulator,
  CHECKPOINT_STOP_ACTIONS,
  RateLimitVsUsageLimitClassifier,
  rateLimitLabel,
} from "../../src/pacing/index.js";
import { signal } from "./harness.js";

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);

function apply(body: string, patch: Parameters<typeof signal>[0] = { nowMs: NOW }) {
  const aimd = new AimdConcurrencyRegulator({
    connectionMaxCap: 8,
    hardwareCap: 8,
    now: () => NOW,
    random: () => 0,
  });
  for (let index = 0; index < 12; index += 1) aimd.noteCleanCompletion();
  expect(aimd.value).toBe(4);
  const applied = new RateLimitVsUsageLimitClassifier().apply(
    signal({ nowMs: NOW, httpStatus: 429, bodyText: body, ...patch, bodyText: body }),
    aimd,
    { connectionId: "chatgpt-plus", projectId: "project-a", usedPpm: 100, ceilingPpm: 800_000 },
  );
  return { aimd, applied };
}

describe("pacing 429 versus usage-limit classifier", () => {
  it("formats the calm board countdown as Rate-limited · retrying in 0:28", () => {
    expect(rateLimitLabel(28_000)).toBe("Rate-limited · retrying in 0:28");
    expect(rateLimitLabel(15_000)).toBe("Rate-limited · retrying in 0:15");
  });

  it("treats rate_limit_exceeded try again in 15s as a transient 429 and halves 4 to 2", () => {
    const { aimd, applied } = apply("rate_limit_exceeded: try again in 15s");
    expect(applied.classification.kind).toBe("transient_429");
    expect(applied.classification.limitClass).toBe("rate");
    expect(applied.classification.retryAllowed).toBe(true);
    expect(applied.buildStopped).toBe(false);
    expect(applied.stopCard).toBeNull();
    expect(aimd.value).toBe(2);
    expect(applied.waitMs).toBe(15_000);
    expect(applied.boardMessage).toBe("Rate-limited · retrying in 0:15");
  });

  it("keeps a 20 second RPM burst distinct from a 5-hour exhaustion", () => {
    const classified = new RateLimitVsUsageLimitClassifier().classify(
      signal({
        nowMs: NOW,
        httpStatus: 429,
        bodyText: "rpm limit: try again in 20s",
      }),
    );
    expect(classified.kind).toBe("transient_429");
    expect(classified.limitClass).toBe("rpm");
    expect(classified.retryAfterMs).toBe(20_000);
  });

  it("classifies TPM and concurrency bursts as transient", () => {
    const classifier = new RateLimitVsUsageLimitClassifier();
    expect(
      classifier.classify(signal({ nowMs: NOW, httpStatus: 429, bodyText: "tpm exceeded" }))
        .limitClass,
    ).toBe("tpm");
    expect(
      classifier.classify(
        signal({ nowMs: NOW, httpStatus: 429, bodyText: "concurrency limit" }),
      ).limitClass,
    ).toBe("concurrency");
  });

  it("sets cwnd to 0 on a 5-hour usage limit and refuses another retry", () => {
    const { aimd, applied } = apply(
      "usage_limit_reached: 5-hour limit resets at 19:30 UTC",
    );
    expect(applied.classification.kind).toBe("usage_limit_exhausted");
    expect(applied.classification.reason).toBe("five_hour_window");
    expect(applied.classification.resetAtMs).toBe(Date.UTC(2026, 10, 22, 19, 30, 0));
    expect(applied.retryAllowed).toBe(false);
    expect(applied.buildStopped).toBe(true);
    expect(aimd.value).toBe(0);
    expect(applied.stopCard?.actions).toEqual([...CHECKPOINT_STOP_ACTIONS]);
    expect(applied.stopCard?.retryAllowed).toBe(false);
    expect(applied.boardMessage).toBeNull();
  });

  it("classifies weekly cap, Copilot remaining 0, and OpenRouter credit 0 as usage limits", () => {
    const classifier = new RateLimitVsUsageLimitClassifier();
    const weekly = classifier.classify(
      signal({ nowMs: NOW, httpStatus: 429, bodyText: "weekly cap reached" }),
    );
    expect(weekly.kind).toBe("usage_limit_exhausted");
    expect(weekly.reason).toBe("weekly_cap");
    expect(weekly.retryAllowed).toBe(false);
    const copilot = classifier.classify(
      signal({ nowMs: NOW, copilotRemaining: 0, resetAtMs: NOW + 86_400_000 }),
    );
    expect(copilot.reason).toBe("copilot_remaining_zero");
    expect(copilot.resetAtMs).toBe(NOW + 86_400_000);
    const credit = classifier.classify(signal({ nowMs: NOW, openRouterCredit: 0 }));
    expect(credit.reason).toBe("openrouter_credit_zero");
    expect(credit.retryAllowed).toBe(false);
  });

  it("does not treat a positive Copilot remainder as exhaustion", () => {
    const classified = new RateLimitVsUsageLimitClassifier().classify(
      signal({ nowMs: NOW, copilotRemaining: 4, httpStatus: 200, bodyText: "" }),
    );
    expect(classified.kind).toBe("none");
  });
});
