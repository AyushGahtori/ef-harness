import { describe, expect, it } from "vitest";
import {
  CopilotOverageConfirmationRequiredError,
  CopilotPlanCostWeighting,
  CopilotPremiumExhaustedError,
  CopilotQuotaReader,
  LocalGlobalDbConnections,
  LocalSignedProviderPolicy,
  LocalWindowsDpapiSecretsVault,
  ManualClock,
  ManualTimerRegistry,
  RedactingAuditLog,
  exhaustedPremiumMessage,
} from "../../src/copilot-cursor-auth/index.js";
import type { CopilotBillingMode, CopilotQuota, GlobalConnectionRecord } from "../../src/copilot-cursor-auth/index.js";
import { COPILOT_TOKEN, RecordingCheckpoints, RecordingPacing, ScriptedQuota } from "./fakes.js";

const RESET = "2026-12-01T00:00:00.000Z";

function quota(partial: Partial<CopilotQuota> = {}): CopilotQuota {
  return {
    entitlement: 300,
    remaining: 120,
    percentRemaining: 40,
    resetDateUtc: RESET,
    overageEnabled: false,
    ...partial,
  };
}

function seed(input: {
  billingMode?: CopilotBillingMode;
  token?: string;
  overageApprovedForReset?: string | null;
}) {
  const billingMode = input.billingMode ?? "copilot_subscription";
  const token = input.token ?? COPILOT_TOKEN;
  const id = "copilot-octocat";
  const vault = new LocalWindowsDpapiSecretsVault();
  const connections = new LocalGlobalDbConnections();
  const secretId = `vault:gitHubToken:${id}:1`;
  const written = vault.writeSecret({
    secretId,
    name: "gitHubToken",
    plaintext: token,
    providerHint: "github_copilot",
  });
  const record: GlobalConnectionRecord = {
    id,
    provider: "github_copilot",
    route: "copilot_sdk",
    plan: "individual",
    vaultRef: written.secretId,
    currency: billingMode === "byok_api_key" ? "usd" : `allowance:${id}`,
    scale: 1,
    enabled: 1,
    createdAt: 1,
    metadata: {
      kind: "copilot",
      authMode: "github_device_flow",
      billingMode,
      accountLogin: "octocat",
      allowedModels: ["included-fast", "standard-chat", "premium-reasoner"],
      orgPolicyMessage: null,
      maskedPreview: "••••lpha",
      verifiedAt: 1,
      status: "active",
      overageApprovedForReset: input.overageApprovedForReset ?? null,
    },
  };
  connections.upsert(record);
  const log = new RedactingAuditLog();
  const account = new ScriptedQuota(quota());
  const pacing = new RecordingPacing();
  const checkpoints = new RecordingCheckpoints();
  const timers = new ManualTimerRegistry();
  const reader = new CopilotQuotaReader({
    vault,
    connections,
    account,
    pacing,
    checkpoints,
    log,
    timers,
    clock: new ManualClock(50),
  });
  return { reader, account, pacing, checkpoints, timers, connections, vault, log, id };
}

describe("Copilot quota reader and plan-aware weights", () => {
  it("reads account.getQuota on verify, build start, and a periodic tick", async () => {
    const kit = seed({});
    await kit.reader.read(kit.id, "connection_verify");
    await kit.reader.read(kit.id, "build_start");
    kit.reader.startPeriodic(kit.id, 60_000);
    expect(kit.timers.activeCount()).toBe(1);
    kit.timers.fire(kit.timers.soleHandle());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kit.account.calls).toBe(3);
    expect(kit.pacing.events.map((event) => event.reason)).toEqual([
      "connection_verify",
      "build_start",
      "periodic",
    ]);
    expect(kit.pacing.events[0]).toMatchObject({
      entitlement: 300,
      remaining: 120,
      percentRemaining: 40,
      resetDateUtc: RESET,
      overageEnabled: false,
      analyticsCurrency: "premium_requests",
      dispatch: "allow",
    });
    kit.reader.stopPeriodic(kit.id);
    expect(kit.timers.activeCount()).toBe(0);
    expect(kit.log.text()).not.toContain(COPILOT_TOKEN);
    expect(JSON.stringify(kit.pacing.events)).not.toContain(COPILOT_TOKEN);
  });

  it("opens the checkpoint card when premium requests are exhausted without overage", async () => {
    const kit = seed({});
    kit.account.quota = quota({ remaining: 0, percentRemaining: 0, overageEnabled: false });
    const outcome = await kit.reader.read(kit.id, "build_start");
    const message = exhaustedPremiumMessage(RESET);
    expect(message).toBe(
      "Copilot premium requests exhausted — resets on 2026-12-01T00:00:00.000Z · Switch to 0x included model / Switch Connection / Keep Parked",
    );
    expect(outcome.kind).toBe("exhausted_included");
    if (outcome.kind === "exhausted_included") {
      expect(outcome.proceeded).toBe(false);
      expect(outcome.checkpoint.message).toBe(message);
      expect(outcome.checkpoint.actions).toEqual([
        "Switch to 0x included model",
        "Switch Connection",
        "Keep Parked",
      ]);
    }
    expect(kit.checkpoints.cards).toHaveLength(1);
    expect(kit.pacing.events[0]?.dispatch).toBe("park");
    await expect(kit.reader.assertMaySpendPremium(kit.id)).rejects.toBeInstanceOf(
      CopilotPremiumExhaustedError,
    );
  });

  it("pauses for explicit confirmation before paid overage and allows it only after approval", async () => {
    const kit = seed({});
    kit.account.quota = quota({ remaining: 0, percentRemaining: 0, overageEnabled: true });
    const outcome = await kit.reader.read(kit.id, "build_start");
    expect(outcome.kind).toBe("paid_overage_confirmation_required");
    if (outcome.kind === "paid_overage_confirmation_required") {
      expect(outcome.proceeded).toBe(false);
      expect(outcome.confirmation.task141PaidTransition).toBe(true);
    }
    expect(kit.checkpoints.cards).toHaveLength(0);
    expect(kit.pacing.events[0]?.dispatch).toBe("pause_for_confirmation");
    await expect(kit.reader.assertMaySpendPremium(kit.id)).rejects.toBeInstanceOf(
      CopilotOverageConfirmationRequiredError,
    );
    kit.reader.confirmPaidOverage(kit.id, RESET);
    const allowed = await kit.reader.assertMaySpendPremium(kit.id);
    expect(allowed).toEqual({ allowed: true, explicitUserApproval: true });
    kit.account.quota = quota({
      remaining: 0,
      percentRemaining: 0,
      overageEnabled: true,
      resetDateUtc: "2027-01-01T00:00:00.000Z",
    });
    const nextWindow = await kit.reader.read(kit.id, "periodic");
    expect(nextWindow.kind).toBe("paid_overage_confirmation_required");
  });

  it("tags bring-your-own-key usage as api dollars instead of subscription quota", async () => {
    const kit = seed({ billingMode: "byok_api_key" });
    kit.account.quota = quota({ remaining: 0, percentRemaining: 0, overageEnabled: true });
    const outcome = await kit.reader.read(kit.id, "connection_verify");
    expect(outcome.kind).toBe("ok");
    expect(outcome.pacing.billingMode).toBe("byok_api_key");
    expect(outcome.pacing.analyticsCurrency).toBe("api_usd");
    expect(outcome.pacing.subscriptionQuotaApplies).toBe(false);
    expect(outcome.pacing.dispatch).toBe("allow");
    expect(kit.checkpoints.cards).toHaveLength(0);
    const stored = kit.connections.get(kit.id);
    expect(stored?.currency).toBe("usd");
    expect(stored?.metadata).toMatchObject({ billingMode: "byok_api_key" });
  });

  it("maps 0x, 1x, and 3x multipliers so routine presets save premium requests", () => {
    const weighting = new CopilotPlanCostWeighting(new LocalSignedProviderPolicy());
    const allowed = ["included-fast", "standard-chat", "premium-reasoner", "claude-sonnet"];
    const junior = weighting.select({ preset: "balanced", difficulty: "junior", allowedModels: allowed });
    expect(junior).toMatchObject({
      modelId: "included-fast",
      multiplier: 0,
      savesPremiumRequests: true,
      task106Roster: { premiumRequestMultiplier: 0 },
      task140Weight: { paceAsPremium: false },
    });
    expect(
      weighting.select({ preset: "cheapest", difficulty: "mid", allowedModels: allowed }).multiplier,
    ).toBe(0);
    const senior = weighting.select({ preset: "balanced", difficulty: "senior", allowedModels: allowed });
    expect(senior).toMatchObject({
      modelId: "premium-reasoner",
      multiplier: 3,
      task140Weight: { paceAsPremium: true },
    });
    expect(senior.modelId).not.toBe("claude-sonnet");
    expect(
      weighting.select({ preset: "cheapest", difficulty: "senior", allowedModels: allowed }),
    ).toMatchObject({ modelId: "standard-chat", multiplier: 1 });
    expect(
      weighting.select({
        preset: "balanced",
        difficulty: "senior",
        allowedModels: ["included-fast", "standard-chat"],
      }).modelId,
    ).not.toBe("claude-sonnet");
  });
});
