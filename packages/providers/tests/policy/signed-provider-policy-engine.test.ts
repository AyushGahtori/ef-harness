import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  POLICY_FETCH_TIMEOUT_MS,
  POLICY_REFRESH_MIN_INTERVAL_MS,
  POLICY_STARTUP_REFRESH_DELAY_MS,
  readBundledPolicyText,
  verifyAndParse,
  type PolicyRoute,
} from "../../src/policy/index.js";
import { createEngine, editablePolicy, signPolicy } from "./fixtures.js";

describe("SignedProviderPolicyEngine", () => {
  it("loads the bundled signed policy offline without fetching", () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    const { engine } = createEngine({ fetchImpl });
    const loaded = engine.loadStartup();
    const verified = verifyAndParse(readBundledPolicyText());
    expect(verified.ok).toBe(true);
    expect(loaded.fetchAttempted).toBe(false);
    expect(loaded.source).toBe("bundled");
    expect(loaded.policyVersion).toBe(2026111701);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(engine.policyHistory()).toHaveLength(1);
    expect(engine.policyHistory()[0]?.diffSummary).toContain("loaded policy version 2026111701");
    expect(engine.transparency().diagnosticLine).toBe("Policy has not been checked remotely yet");
  });

  it("loads a cached verified policy synchronously in under 5ms", () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    const { engine } = createEngine({ fetchImpl });
    engine.loadStartup();
    const started = performance.now();
    const loaded = engine.loadStartup();
    const elapsed = performance.now() - started;
    expect(loaded.source).toBe("cache");
    expect(loaded.fetchAttempted).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(elapsed).toBeLessThan(5);
    expect(loaded.elapsedMs).toBeLessThan(5);
  });

  it("reports a 10 day offline cache without a network wait or an error", () => {
    const { engine, dir, close } = createEngine();
    engine.loadStartup();
    close();
    const cachePath = join(dir, "provider-policy.verified.json");
    const envelope = JSON.parse(readFileSync(cachePath, "utf8")) as { checkedAt: string | null };
    const now = Date.parse("2026-11-22T12:00:00.000Z");
    envelope.checkedAt = new Date(now - 10 * 86_400_000 - 60_000).toISOString();
    writeFileSync(cachePath, `${JSON.stringify(envelope)}\n`, "utf8");
    const restarted = createEngine({ now: () => now, fetchImpl: vi.fn() }, dir);
    expect(() => restarted.engine.loadStartup()).not.toThrow();
    expect(restarted.engine.transparency().diagnosticLine).toBe("Policy last checked 10d ago");
    expect(restarted.engine.transparency().policyVersion).toBe(2026111701);
  });

  it("schedules the daily refresh 30 seconds after startup and does not fetch during boot", () => {
    const calls: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    const { engine } = createEngine({
      fetchImpl,
      schedule: (fn, delayMs) => {
        calls.push(delayMs);
        return { cancel: () => undefined };
      },
    });
    engine.loadStartup();
    engine.scheduleDailyRefresh();
    expect(calls).toEqual([POLICY_STARTUP_REFRESH_DELAY_MS]);
    expect(POLICY_STARTUP_REFRESH_DELAY_MS).toBe(30_000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("applies a newer signed policy and rejects signatures, rollbacks, and unchanged bytes", async () => {
    const now = Date.parse("2026-11-22T00:00:00.000Z");
    const next = editablePolicy();
    next.policyVersion += 1;
    next.publishedAt = "2026-11-22T00:00:00.000Z";
    const mid = next.models.find((model) => model.modelId === "openai-general-mid");
    expect(mid).toBeTruthy();
    if (!mid) return;
    mid.inputMicroUsdPer1M = 2_600_000;
    const body = JSON.stringify(signPolicy(next));
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(JSON.parse(body) as unknown));
    const { engine } = createEngine({ fetchImpl, now: () => now });
    engine.loadStartup();
    const applied = await engine.refreshDaily();
    expect(applied.applied).toBe(true);
    expect(applied.reason).toBe("applied");
    expect(engine.activeDocument().policyVersion).toBe(next.policyVersion);
    expect(engine.policyHistory().map((row) => row.policyVersion)).toEqual([
      2026111701,
      next.policyVersion,
    ]);
    expect(applied.detail).toContain("price update openai-general-mid");

    const repeated = engine.ingestRemotePolicy(body);
    expect(repeated.reason).toBe("unchanged");
    expect(engine.policyHistory()).toHaveLength(2);

    const forged = signPolicy(editablePolicy());
    const siwc = forged.routes.find((route) => route.id === "siwc_preview");
    expect(siwc).toBeTruthy();
    if (siwc) {
      siwc.status = "route_revoked";
      siwc.revocationNotice = "forged by a network attacker";
    }
    const tampered = engine.ingestRemotePolicy(forged);
    expect(tampered.reason).toBe("invalid_signature");
    expect(routeStatus(engine, "siwc_preview")).toBe("allowed");
    expect(engine.policyHistory()).toHaveLength(2);

    const rollback = editablePolicy();
    rollback.policyVersion = 2026111700;
    const rejected = engine.ingestRemotePolicy(signPolicy(rollback));
    expect(rejected.reason).toBe("rollback");
    expect(engine.activeDocument().policyVersion).toBe(next.policyVersion);
    expect(engine.policyHistory()).toHaveLength(2);

    const broken = engine.ingestRemotePolicy("{");
    expect(broken.reason).toBe("malformed");
    expect(broken.applied).toBe(false);
  });

  it("fail-opens when the daily refresh is offline, throttles to once per 24h, and aborts at 5s", async () => {
    expect(POLICY_FETCH_TIMEOUT_MS).toBe(5_000);
    let now = Date.parse("2026-11-22T00:00:00.000Z");
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    const { engine } = createEngine({ fetchImpl, now: () => now });
    engine.loadStartup();
    const version = engine.activeDocument().policyVersion;
    const offline = await engine.refreshDaily();
    expect(offline.applied).toBe(false);
    expect(offline.reason).toBe("offline");
    expect(offline.detail).toBe("fetch_failed");
    expect(engine.activeDocument().policyVersion).toBe(version);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const throttled = await engine.refreshDaily();
    expect(throttled.reason).toBe("throttled");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += POLICY_REFRESH_MIN_INTERVAL_MS;
    await engine.refreshDaily();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const hanging: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const fail = () => {
          const error = new Error("timeout");
          error.name = "TimeoutError";
          reject(error);
        };
        if (init?.signal?.aborted) fail();
        else init?.signal?.addEventListener("abort", fail, { once: true });
      });
    const quick = createEngine({
      fetchImpl: hanging,
      timeoutMs: 50,
      now: () => Date.parse("2026-12-01T00:00:00.000Z"),
    });
    quick.engine.loadStartup();
    const quickResult = await quick.engine.refreshDaily();
    expect(quickResult.reason).toBe("offline");
    expect(quickResult.detail).toBe("timeout");
    expect(quickResult.applied).toBe(false);
    expect(quick.engine.activeDocument().policyVersion).toBe(version);

    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      controller.abort();
      return controller.signal;
    });
    try {
      const defaults = createEngine({
        fetchImpl: async (_input, init) => {
          if (init?.signal?.aborted) {
            const error = new Error("timeout");
            error.name = "TimeoutError";
            throw error;
          }
          throw new Error("expected the default timeout signal");
        },
        now: () => Date.parse("2027-01-01T00:00:00.000Z"),
      });
      defaults.engine.loadStartup();
      const defaultResult = await defaults.engine.refreshDaily();
      expect(timeoutSpy).toHaveBeenCalledWith(POLICY_FETCH_TIMEOUT_MS);
      expect(defaultResult.detail).toBe("timeout");
      expect(defaultResult.applied).toBe(false);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("parks a revoked route from a signed update and refuses a silent paid fallback", () => {
    const { engine } = createEngine();
    engine.loadStartup();
    const next = editablePolicy();
    next.policyVersion += 1;
    next.publishedAt = "2026-11-22T00:00:00.000Z";
    const siwc = next.routes.find((route) => route.id === "siwc_preview");
    expect(siwc).toBeTruthy();
    if (!siwc) return;
    siwc.status = "route_revoked";
    siwc.revocationNotice =
      "Sign in with ChatGPT direct preview was withdrawn by signed policy.";
    const checkpointed: string[] = [];
    const result = engine.ingestRemotePolicy(signPolicy(next), {
      connections: [
        {
          id: "chatgpt-plus",
          provider: "openai",
          route: "siwc_preview",
          currency: "allowance:chatgpt",
          enabled: true,
          billing: "plan",
        },
        {
          id: "openai-paid",
          provider: "openai",
          route: "openai_api",
          currency: "usd",
          enabled: true,
          billing: "api_key",
        },
        {
          id: "local-ollama",
          provider: "ollama",
          route: "local_ollama",
          currency: "local_slots",
          enabled: true,
          billing: "local",
        },
      ],
      activeSteps: [
        {
          stepId: "wave-3-turn",
          connectionId: "chatgpt-plus",
          routeId: "siwc_preview",
          checkpointed: false,
          corrupted: false,
        },
      ],
      checkpoint: (step) => {
        checkpointed.push(step.stepId);
        return { ...step, checkpointed: true, corrupted: false };
      },
    });
    expect(result.applied).toBe(true);
    expect(result.card?.kind).toBe("route_revoked");
    expect(result.card?.routeIds).toEqual(["siwc_preview"]);
    expect(result.card?.connectionIds).toEqual(["chatgpt-plus"]);
    expect(result.card?.revocationNotice).toContain("withdrawn by signed policy");
    expect(result.card?.actions.map((action) => action.label)).toEqual([
      "Switch Connection",
      "Keep Parked",
    ]);
    expect(result.card?.silentPaidFallback).toBe(false);
    expect(checkpointed).toEqual(["wave-3-turn"]);
    const handler = engine.revocationHandler();
    expect(handler.allowDispatch({ routeId: "siwc_preview", connectionId: "chatgpt-plus" }).allowed).toBe(
      false,
    );
    expect(handler.allowDispatch({ routeId: "local_ollama", connectionId: "local-ollama" }).allowed).toBe(
      true,
    );
    expect(
      handler.considerSilentFallback({
        fromRouteId: "siwc_preview",
        toRouteId: "openai_api",
        toBilling: "api_key",
      }),
    ).toEqual({ accepted: false, reason: "no_silent_paid_fallback" });
    expect(handler.acceptExplicitSwitch({ toRouteId: "openai_api", explicitUserChoice: false }).accepted).toBe(
      false,
    );

    const again = editablePolicy();
    again.policyVersion += 2;
    again.publishedAt = "2026-11-23T00:00:00.000Z";
    const still = again.routes.find((route) => route.id === "siwc_preview");
    if (!still) return;
    still.status = "route_revoked";
    still.revocationNotice = siwc.revocationNotice;
    const second = engine.ingestRemotePolicy(signPolicy(again));
    expect(second.applied).toBe(true);
    expect(second.card).toBeNull();
  });
});

function routeStatus(
  engine: ReturnType<typeof createEngine>["engine"],
  routeId: string,
): PolicyRoute["status"] | undefined {
  return engine.activeDocument().routes.find((route) => route.id === routeId)?.status;
}
