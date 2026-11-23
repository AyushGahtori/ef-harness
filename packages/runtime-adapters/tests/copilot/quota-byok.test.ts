import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CopilotByokComplianceError,
  CopilotOveragePausedError,
  normalizeAccountQuota,
} from "../../src/copilot/index.js";
import { RESET, TOKEN, consoleKey, createHarness, disposeHarness, sessionSpec, subscriptionKey } from "./fakes.js";

describe("Copilot metrics, quota, and BYOK", () => {
  it("reads getMetrics and getQuota, feeds pacing, and pauses before paid overage", async () => {
    const env = createHarness();
    try {
      env.sdk.quotaState = {
        entitlement: 4,
        remaining: 4,
        percentRemaining: 100,
        resetDateUtc: RESET,
        overageEnabled: true,
      };
      const ref = await env.adapter.startSession(sessionSpec(env.worktree));
      for (let turn = 0; turn < 4; turn += 1) {
        const receipt = await env.adapter.sendTurn(ref.sessionId, `turn ${turn + 1}`);
        expect(receipt.dispatched).toBe(true);
      }
      expect(env.sdk.quotaState.remaining).toBe(0);
      expect(env.pacing.getCwnd("copilot-1")).toBe(0);
      expect(env.cards.stops).toHaveLength(1);
      expect(env.cards.stops[0]).toMatchObject({
        kind: "checkpoint_stop",
        reason: "paid_overage",
        remaining: 0,
        overageEnabled: true,
        cwnd: 0,
        requiresExplicitApproval: true,
      });
      const window = env.windows.latest("copilot-1");
      expect(window?.source).toBe("account.getQuota");
      expect(window?.remaining).toBe(0);
      expect(window?.overageEnabled).toBe(true);
      expect(window?.resetDateUtc).toBe(RESET);
      expect(env.pacing.observations.length).toBeGreaterThan(0);
      expect(env.pacing.observations.at(-1)?.next.remaining).toBe(0);

      await expect(env.adapter.sendTurn(ref.sessionId, "turn 5")).rejects.toBeInstanceOf(
        CopilotOveragePausedError,
      );
      expect(env.sdk.sendCount).toBe(4);

      env.adapter.approvePaidOverage("copilot-1", RESET);
      const approved = await env.adapter.sendTurn(ref.sessionId, "turn 5 approved");
      expect(approved.dispatched).toBe(true);
      expect(approved.usage.explicitOverageApproval).toBe(true);
      expect(env.sdk.sendCount).toBe(5);
    } finally {
      disposeHarness(env);
    }
  });

  it("normalizes the nested account.getQuota premium snapshot", () => {
    const quota = normalizeAccountQuota({
      quotaSnapshots: {
        premiumInteractions: {
          entitlement: 100,
          used: 99,
          remainingPercentage: 1,
          resetDate: RESET,
          overagePermitted: true,
        },
      },
    });
    expect(quota.remaining).toBe(1);
    expect(quota.entitlement).toBe(100);
    expect(quota.percentRemaining).toBe(1);
    expect(quota.overageEnabled).toBe(true);
    expect(quota.resetDateUtc).toBe(RESET);
  });

  it("bills BYOK turns in micro-USD and does not spend Copilot premium quota", async () => {
    const env = createHarness();
    try {
      const key = consoleKey("fixture");
      env.byokVault.put("vault:anthropic", {
        key,
        keyClass: "console_api",
        provider: "anthropic",
        connectionId: "anthropic-1",
        model: "claude-sonnet",
        baseUrl: null,
      });
      env.sdk.quotaState.remaining = 4;
      const before = env.sdk.quotaState.remaining;
      const ref = await env.adapter.startSession(
        sessionSpec(env.worktree, {
          billing: { mode: "byok_api_key", byokVaultRef: "vault:anthropic" },
        }),
      );
      const receipt = await env.adapter.sendTurn(ref.sessionId, "use the console key");
      expect(receipt.usage.billingMode).toBe("byok_api_key");
      expect(receipt.usage.subscriptionQuotaApplies).toBe(false);
      expect(receipt.usage.premiumRequests).toBe(0);
      expect(receipt.usage.byokConnectionId).toBe("anthropic-1");
      expect(receipt.usage.costMicroUsd).toBeGreaterThan(0);
      expect(env.ledger.entries()).toEqual([
        expect.objectContaining({
          connectionId: "anthropic-1",
          provider: "anthropic",
          billingMode: "byok_api_key",
          microUsd: receipt.usage.costMicroUsd,
        }),
      ]);
      expect(env.sdk.quotaState.remaining).toBe(before);
      expect(env.windows.list("copilot-1")).toEqual([]);
      expect(env.sdk.lastConfig?.byok?.apiKey).toBe(key);
      const onDisk = fs.readFileSync(path.join(env.worktree, ".ef-copilot", "session.json"), "utf8");
      expect(onDisk).not.toContain(key);
      expect(onDisk).not.toContain(TOKEN);
      expect(env.cards.stops).toHaveLength(0);
    } finally {
      disposeHarness(env);
    }
  });

  it("rejects an Anthropic subscription key before opening a BYOK session", async () => {
    const env = createHarness();
    try {
      env.byokVault.put("vault:anthropic", {
        key: subscriptionKey("fixture"),
        keyClass: "consumer_plan",
        provider: "anthropic",
        connectionId: "anthropic-1",
        model: "claude-sonnet",
        baseUrl: null,
      });
      await expect(
        env.adapter.startSession(
          sessionSpec(env.worktree, {
            billing: { mode: "byok_api_key", byokVaultRef: "vault:anthropic" },
          }),
        ),
      ).rejects.toBeInstanceOf(CopilotByokComplianceError);
      expect(env.sdk.lastConfig).toBeNull();
      expect(env.sdk.sendCount).toBe(0);
    } finally {
      disposeHarness(env);
    }
  });
});
