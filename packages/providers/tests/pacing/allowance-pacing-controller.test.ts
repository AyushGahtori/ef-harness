import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_STOP_ACTIONS,
  CONSERVATIVE_PRIOR_PPM_PER_1K,
  RESERVATION_SAFETY_MARGIN,
} from "../../src/pacing/index.js";
import type { SlotDecision } from "../../src/pacing/index.js";
import { chatGptRegistration, createHarness, signal } from "./harness.js";

const START = Date.UTC(2026, 10, 22, 12, 0, 0);
const CONNECTION = "chatgpt-plus";

async function boot(reserveFraction = 0.2) {
  const harness = createHarness("project-a", START);
  await harness.controller.registerConnection(chatGptRegistration(START, reserveFraction));
  return harness;
}

async function completeTiny(
  harness: Awaited<ReturnType<typeof boot>>,
  count: number,
): Promise<void> {
  let done = 0;
  while (done < count) {
    const grants: Extract<SlotDecision, { ok: true }>[] = [];
    while (grants.length < 8) {
      const decision = await harness.controller.requestSlot({
        connectionId: CONNECTION,
        taskId: `tiny-${done}-${grants.length}`,
        modelId: "gpt-5.x-mini",
        effectiveTokens: 100,
        role: "senior-coding",
        priority: "background",
      });
      if (!decision.ok) break;
      grants.push(decision);
    }
    if (grants.length === 0) {
      throw new Error(`pacing stopped dispatching after ${done} clean turns`);
    }
    for (const grant of grants) {
      await harness.controller.completeTurn({
        connectionId: CONNECTION,
        grantId: grant.grantId,
        actualPpm: 10,
        effectiveTokens: 100,
        modelId: "gpt-5.x-mini",
        deltaPpm: null,
        quotaSource: null,
      });
      done += 1;
      if (done >= count) break;
    }
  }
}

describe("pacing allowance controller", () => {
  it("ramps 2 → 3 → 4, slows near 720_000 ppm, and parks before the 20% reserve", async () => {
    const harness = await boot();
    const initial = await harness.controller.telemetry(CONNECTION);
    expect(initial.cwnd).toBe(2);
    expect(initial.maxCwnd).toBe(8);
    expect(initial.reserveCeilingPpm).toBe(800_000);
    expect(initial.pacingState).toBe("normal");
    expect(initial.windowUsedPpm).toBe(0);

    await completeTiny(harness, 6);
    expect((await harness.controller.telemetry(CONNECTION)).cwnd).toBe(3);
    await completeTiny(harness, 6);
    expect((await harness.controller.telemetry(CONNECTION)).cwnd).toBe(4);

    const slowed = await harness.controller.observeAuthoritativeUsage({
      connectionId: CONNECTION,
      windowKind: "5h",
      usedPpm: 700_000,
      source: "account/rateLimits/read",
    });
    expect(slowed.pacingState).toBe("burn_paced");
    expect(slowed.windowUsedPpm).toBe(700_000);
    const granted: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const decision = await harness.controller.requestSlot({
        connectionId: CONNECTION,
        taskId: `near-${index}`,
        modelId: "gpt-5.x-mini",
        effectiveTokens: 100,
        role: "senior-coding",
        priority: "background",
      });
      if (decision.ok) granted.push(decision.grantId);
    }
    expect(granted.length).toBe(2);
    expect(granted.length).toBeLessThan(4);

    await harness.controller.observeAuthoritativeUsage({
      connectionId: CONNECTION,
      windowKind: "5h",
      usedPpm: 720_000,
      source: "account/rateLimits/read",
    });
    const parked = await harness.controller.requestSlot({
      connectionId: CONNECTION,
      taskId: "over-wind-down",
      modelId: "gpt-5.x-mini",
      effectiveTokens: 1_000,
      role: "senior-coding",
      priority: "background",
    });
    expect(parked.ok).toBe(false);
    if (!parked.ok) expect(parked.reason).toBe("burn_paced");
    expect(harness.windDown.observations.some((item) => item.phase === "wind_down")).toBe(true);
    expect(harness.windDown.observations[0]?.windDownPpm).toBe(720_000);
    expect(harness.windDown.observations[0]?.ceilingPpm).toBe(800_000);

    for (const grantId of granted) {
      await harness.controller.completeTurn({
        connectionId: CONNECTION,
        grantId,
        actualPpm: 10,
        effectiveTokens: 100,
        modelId: "gpt-5.x-mini",
        deltaPpm: null,
        quotaSource: null,
      });
    }
    const finished = await harness.controller.telemetry(CONNECTION);
    expect(finished.windowUsedPpm).toBeLessThanOrEqual(800_000);
    expect(finished.windowUsedPpm).toBeGreaterThanOrEqual(720_000);
  });

  it("backs off a transient 429 without stopping the build, then resumes", async () => {
    const harness = await boot();
    await completeTiny(harness, 12);
    expect((await harness.controller.telemetry(CONNECTION)).cwnd).toBe(4);
    const grant = await harness.controller.requestSlot({
      connectionId: CONNECTION,
      taskId: "burst",
      modelId: "gpt-5.x-mini",
      effectiveTokens: 100,
      role: "senior-coding",
      priority: "background",
    });
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;
    const applied = await harness.controller.observeProviderSignal({
      connectionId: CONNECTION,
      grantId: grant.grantId,
      signal: signal({
        nowMs: START,
        httpStatus: 429,
        bodyText: "rate_limit_exceeded: try again in 15s",
      }),
    });
    expect(applied.classification.kind).toBe("transient_429");
    expect(applied.buildStopped).toBe(false);
    expect(applied.retryAllowed).toBe(true);
    expect(harness.windDown.cards).toHaveLength(0);
    expect(harness.board.messages).toEqual(["Rate-limited · retrying in 0:15"]);
    const during = await harness.controller.telemetry(CONNECTION);
    expect(during.cwnd).toBe(2);
    expect(during.pacingState).toBe("backoff_429");
    const denied = await harness.controller.requestSlot({
      connectionId: CONNECTION,
      taskId: "while-backing-off",
      modelId: "gpt-5.x-mini",
      effectiveTokens: 100,
      role: "senior-coding",
      priority: "background",
    });
    expect(denied.ok).toBe(false);
    harness.clock.advance(15_000);
    const resumed = await harness.controller.requestSlot({
      connectionId: CONNECTION,
      taskId: "after-backoff",
      modelId: "gpt-5.x-mini",
      effectiveTokens: 100,
      role: "senior-coding",
      priority: "background",
    });
    expect(resumed.ok).toBe(true);
    expect((await harness.controller.telemetry(CONNECTION)).pacingState).not.toBe("window_exhausted");
  });

  it("opens the checkpoint stop card on a 5-hour usage limit and does not retry", async () => {
    const harness = await boot();
    const applied = await harness.controller.observeProviderSignal({
      connectionId: CONNECTION,
      signal: signal({
        nowMs: START,
        httpStatus: 429,
        bodyText: "usage_limit_reached: 5-hour limit resets at 19:30 UTC",
      }),
    });
    expect(applied.classification.reason).toBe("five_hour_window");
    expect(applied.retryAllowed).toBe(false);
    expect(applied.cwnd).toBe(0);
    const resetAt = Date.UTC(2026, 10, 22, 19, 30, 0);
    expect(applied.classification.resetAtMs).toBe(resetAt);
    expect((await harness.controller.telemetry(CONNECTION)).pacingState).toBe("window_exhausted");
    expect((await harness.controller.telemetry(CONNECTION)).resetAt).toBe(resetAt);
    expect(harness.windDown.cards).toHaveLength(1);
    expect(harness.windDown.cards[0]?.actions).toEqual([...CHECKPOINT_STOP_ACTIONS]);
    expect(harness.windDown.cards[0]?.retryAllowed).toBe(false);
    const before = (await harness.controller.accounting(CONNECTION)).admittedDispatches;
    for (let index = 0; index < 8; index += 1) {
      const denied = await harness.controller.requestSlot({
        connectionId: CONNECTION,
        taskId: `storm-${index}`,
        modelId: "gpt-5.x-mini",
        effectiveTokens: 100,
        role: "senior-coding",
        priority: "background",
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.retryAllowed).toBe(false);
    }
    const accounting = await harness.controller.accounting(CONNECTION);
    expect(accounting.admittedDispatches).toBe(before);
    expect(accounting.deniedWhileExhausted).toBe(8);
    expect(harness.windDown.cards).toHaveLength(1);
  });

  it("runs ask-owner-responder@1 while four background workers fill cwnd", async () => {
    const harness = await boot();
    await completeTiny(harness, 12);
    const held: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const decision = await harness.controller.requestSlot({
        connectionId: CONNECTION,
        taskId: `worker-${index}`,
        modelId: "gpt-5.x-mini",
        effectiveTokens: 100,
        role: "senior-coding",
        priority: "background",
      });
      expect(decision.ok).toBe(true);
      if (decision.ok) held.push(decision.grantId);
    }
    const fifth = await harness.controller.requestSlot({
      connectionId: CONNECTION,
      taskId: "worker-4",
      modelId: "gpt-5.x-mini",
      effectiveTokens: 100,
      role: "senior-coding",
      priority: "background",
    });
    expect(fifth.ok).toBe(false);
    const question = await harness.controller.requestSlot({
      connectionId: CONNECTION,
      taskId: "whats-left",
      modelId: "gpt-5.x-mini",
      effectiveTokens: 50,
      role: "ask-owner-responder@1",
      priority: "interactive",
    });
    expect(question.ok).toBe(true);
    if (question.ok) expect(question.slot).toBe("interactive");
    expect(held).toHaveLength(4);
  });

  it("treats Copilot remaining 0 as a hard stop and learns from header deltas", async () => {
    const harness = await boot(0);
    await harness.controller.registerConnection({
      ...chatGptRegistration(START, 0),
      connectionId: "copilot",
      provider: "copilot",
      windows: [
        {
          kind: "weekly",
          windowStartMs: START,
          windowEndMs: START + 7 * 24 * 60 * 60 * 1000,
        },
      ],
      priors: [{ modelId: "gpt-5.x-mini", ppmPer1k: 2_000 }],
    });
    const stopped = await harness.controller.observeCopilotQuota({
      connectionId: "copilot",
      modelId: "gpt-5.x-mini",
      effectiveTokens: 1_000,
      previous: {
        remaining: 1,
        entitled: 50,
        remainingPercentage: 2,
        resetDateUtcMs: START + 86_400_000,
      },
      next: {
        remaining: 0,
        entitled: 50,
        remainingPercentage: 0,
        resetDateUtcMs: START + 86_400_000,
      },
    });
    expect(stopped?.classification.reason).toBe("copilot_remaining_zero");
    expect((await harness.controller.telemetry("copilot")).cwnd).toBe(0);

    await harness.controller.observeSiwcHeaders({
      connectionId: CONNECTION,
      modelId: "gpt-5.x-mini",
      effectiveTokens: 2_000,
      windowKind: "5h",
      previous: { remainingPercent: 40, retryAfterSeconds: null, resetAtMs: null },
      next: { remainingPercent: 36, retryAfterSeconds: null, resetAtMs: null },
    });
    const learned = await harness.controller.weight(CONNECTION, "gpt-5.x-mini");
    expect(learned.quotaSamples).toBe(1);
    expect(learned.ppmPer1k).not.toBe(1_000);
    const share = await harness.controller.predictWindowShare(CONNECTION, "gpt-5.x-mini", 1_000);
    expect(share.label).toContain("5h window");
    expect(harness.weights.weights.length).toBeGreaterThan(0);
  });

  it("auto-resume defaults off, and a low disk keeps cwnd parked", async () => {
    const harness = await boot();
    expect((await harness.controller.autoResume(CONNECTION)).optIn).toBe(false);
    const resetAt = Date.UTC(2026, 10, 22, 19, 30, 0);
    await harness.controller.observeProviderSignal({
      connectionId: CONNECTION,
      signal: signal({
        nowMs: START,
        httpStatus: 429,
        bodyText: "usage_limit_reached: 5-hour limit resets at 19:30 UTC",
      }),
    });
    harness.clock.set(resetAt + 15_000);
    const ignored = await harness.controller.tick(CONNECTION);
    expect(ignored.action).toBe("idle");
    expect((await harness.controller.telemetry(CONNECTION)).cwnd).toBe(0);

    await harness.controller.setAutoResumeOptIn(CONNECTION, true);
    harness.preflight.freeBytes = 4 * 1024 * 1024 * 1024;
    const blocked = await harness.controller.tick(CONNECTION);
    expect(blocked.action).toBe("stay_parked");
    expect(blocked.reason).toBe("disk_headroom");
    expect(harness.windDown.diskCards).toHaveLength(1);
    expect((await harness.controller.telemetry(CONNECTION)).cwnd).toBe(0);

    harness.preflight.freeBytes = 10 * 1024 * 1024 * 1024;
    const resumed = await harness.controller.tick(CONNECTION);
    expect(resumed.action).toBe("resume");
    expect(resumed.cwnd).toBe(2);
    const telemetry = await harness.controller.telemetry(CONNECTION);
    expect(telemetry.cwnd).toBe(2);
    expect(telemetry.pacingState).toBe("normal");
    expect(telemetry.windowUsedPpm).toBe(0);
  });

  it("seeds an unseen model from the signed policy prior and falls back when the prior is absent", async () => {
    const harness = createHarness("project-a", START, {
      priorPpmPer1k: (_connectionId, modelId) => (modelId === "gpt-5.x-pro" ? 12_000 : null),
    });
    await harness.controller.registerConnection(chatGptRegistration(START));
    const seeded = await harness.controller.requestSlot({
      connectionId: CONNECTION,
      taskId: "pro-turn",
      modelId: "gpt-5.x-pro",
      effectiveTokens: 1_000,
      role: "senior-coding",
      priority: "background",
    });
    expect(seeded.ok).toBe(true);
    if (seeded.ok) expect(seeded.reservedPpm).toBe(Math.round(12_000 * RESERVATION_SAFETY_MARGIN));
    const learned = await harness.controller.weight(CONNECTION, "gpt-5.x-pro");
    expect(learned.precision).toBe("prior");
    expect(learned.ppmPer1k).toBe(12_000);

    const fallback = await harness.controller.requestSlot({
      connectionId: CONNECTION,
      taskId: "unknown-turn",
      modelId: "unknown-model",
      effectiveTokens: 1_000,
      role: "senior-coding",
      priority: "background",
    });
    expect(fallback.ok).toBe(true);
    if (fallback.ok) {
      expect(fallback.reservedPpm).toBe(
        Math.round(CONSERVATIVE_PRIOR_PPM_PER_1K * RESERVATION_SAFETY_MARGIN),
      );
    }
  });
});
