import { describe, expect, it } from "vitest";
import {
  FallbackBlockedNeedsConsentError,
  MICRO_USD_PER_DOLLAR,
  MemoryBudgetLedger,
  NoSilentPaidFallbackGuard,
  OLLAMA_STOPPED_ALERT,
  REPEATED_FAILURE_THRESHOLD,
  billingClassForBadge,
  dispatchConnectionProbe,
  evaluateScreenFallback,
  evaluateWithLedger,
  fallbackInput,
  triggerForStatus,
  type ExplicitFallbackRule,
  type FallbackTrigger,
  type GuardConnection,
  type ProjectFallbackPolicy,
} from "../../src/fallback-guard/index.js";

const CAP = 2 * MICRO_USD_PER_DOLLAR;

function connection(overrides: Partial<GuardConnection> & Pick<GuardConnection, "id" | "billingClass">): GuardConnection {
  return {
    label: overrides.id,
    provider: overrides.provider ?? overrides.id,
    family: overrides.family ?? "other",
    costRank: overrides.costRank ?? 0,
    costEstimate: overrides.costEstimate ?? "$0.00",
    status: overrides.status ?? "healthy",
    routable: overrides.routable ?? true,
    ...overrides,
  };
}

const ollama = connection({
  id: "ollama",
  label: "Ollama",
  provider: "ollama",
  family: "local",
  billingClass: "local_free",
  costRank: 0,
  costEstimate: "$0.00",
  status: "crashed",
});

const openai = connection({
  id: "openai",
  label: "OpenAI",
  provider: "openai",
  family: "openai",
  billingClass: "pay_per_token",
  costRank: 30,
  costEstimate: "About $0.01 per 1K output tokens (estimated, table v4)",
});

const chatgpt = connection({
  id: "chatgpt",
  label: "ChatGPT Plus",
  provider: "chatgpt",
  family: "openai",
  billingClass: "subscription",
  costRank: 10,
  costEstimate: "ChatGPT Plus allowance",
  status: "exhausted",
});

const anthropic = connection({
  id: "anthropic",
  label: "Anthropic Console",
  provider: "anthropic",
  family: "anthropic",
  billingClass: "pay_per_token",
  costRank: 40,
  costEstimate: "About $0.015 per 1K output tokens (estimated, table v4)",
});

const openrouter = connection({
  id: "openrouter",
  label: "OpenRouter",
  provider: "openrouter",
  family: "openrouter",
  billingClass: "pay_per_token",
  costRank: 20,
  costEstimate: "OpenRouter credits, provider-reported",
});

const copilot = connection({
  id: "copilot",
  label: "GitHub Copilot",
  provider: "github_copilot",
  family: "github",
  billingClass: "subscription",
  costRank: 10,
  costEstimate: "Copilot plan allowance",
  status: "exhausted",
});

const overage = connection({
  id: "copilot-overage",
  label: "Copilot overage",
  provider: "github_copilot",
  family: "github",
  billingClass: "copilot_overage",
  costRank: 80,
  costEstimate: "Copilot paid overage",
});

const cheap = connection({
  id: "cheap",
  label: "Cheap API",
  provider: "openai",
  family: "openai",
  billingClass: "pay_per_token",
  costRank: 15,
  costEstimate: "Lower published rate (estimated, table v4)",
});

const expensive = connection({
  id: "expensive",
  label: "Expensive API",
  provider: "anthropic",
  family: "anthropic",
  billingClass: "pay_per_token",
  costRank: 90,
  costEstimate: "Higher published rate (estimated, table v4)",
});

const lmStudio = connection({
  id: "lmstudio",
  label: "LM Studio",
  provider: "lmstudio",
  family: "local",
  billingClass: "local_free",
  costRank: 0,
  costEstimate: "$0.00",
});

function opted(rule: ExplicitFallbackRule): ProjectFallbackPolicy {
  return { neverFallbackWithoutAsking: false, explicitFallbackOrder: [rule] };
}

const guard = new NoSilentPaidFallbackGuard();

const matrix: readonly {
  readonly name: string;
  readonly active: GuardConnection;
  readonly candidate: GuardConnection;
  readonly reason: FallbackTrigger;
}[] = [
  { name: "Local → Paid", active: ollama, candidate: openai, reason: "crashed" },
  { name: "Subscription → Paid", active: chatgpt, candidate: anthropic, reason: "window_exhausted" },
  { name: "Copilot → Overage", active: copilot, candidate: overage, reason: "window_exhausted" },
  { name: "Cheap → Expensive", active: cheap, candidate: expensive, reason: "selection" },
];

describe("NoSilentPaidFallbackGuard", () => {
  it.each(matrix)("refuses $name unless an explicit dollar cap opts in", (row) => {
    const blocked = guard.evaluate(
      fallbackInput({ active: row.active, candidate: row.candidate, reason: row.reason }),
    );
    expect(blocked.outcome).toBe("block");
    if (blocked.outcome !== "block") return;
    expect(blocked.parked).toBe(true);
    expect(blocked.capExhausted).toBe(false);
    expect(blocked.error).toBeInstanceOf(FallbackBlockedNeedsConsentError);
    expect(blocked.error.name).toBe("FallbackBlockedNeedsConsentError");
    expect(blocked.card.action).toBe("Switch Connection");
    expect(blocked.card.switchConnection.requiresOneClickConsent).toBe(true);
    expect(blocked.card.switchConnection.costEstimate).toBe(row.candidate.costEstimate);
    expect(() =>
      guard.assertAllowed(
        fallbackInput({ active: row.active, candidate: row.candidate, reason: row.reason }),
      ),
    ).toThrow(FallbackBlockedNeedsConsentError);

    const under = guard.evaluate(
      fallbackInput({
        active: row.active,
        candidate: row.candidate,
        reason: row.reason,
        policy: opted({
          fromConnectionId: row.active.id,
          toConnectionId: row.candidate.id,
          capMicroUsd: CAP,
        }),
        spentMicroUsd: CAP - 1,
      }),
    );
    expect(under.outcome).toBe("allow");
    if (under.outcome !== "allow") return;
    expect(under.bounded).toBe(true);
    expect(under.parked).toBe(false);
    expect(under.remainingCapMicroUsd).toBe(1);
    expect(under.routeTo).toBe(row.candidate.id);

    const atCap = guard.evaluate(
      fallbackInput({
        active: row.active,
        candidate: row.candidate,
        reason: row.reason,
        policy: opted({
          fromConnectionId: row.active.id,
          toConnectionId: row.candidate.id,
          capMicroUsd: CAP,
        }),
        spentMicroUsd: CAP,
      }),
    );
    expect(atCap.outcome).toBe("block");
    if (atCap.outcome !== "block") return;
    expect(atCap.capExhausted).toBe(true);
    expect(atCap.card.message).toContain("$2.00");
    expect(atCap.parked).toBe(true);

    const crosses = guard.evaluate(
      fallbackInput({
        active: row.active,
        candidate: row.candidate,
        reason: row.reason,
        policy: opted({
          fromConnectionId: row.active.id,
          toConnectionId: row.candidate.id,
          capMicroUsd: CAP,
        }),
        spentMicroUsd: CAP - 10,
        incomingMicroUsd: 11,
        userConsent: true,
      }),
    );
    expect(crosses.outcome).toBe("block");
    if (crosses.outcome !== "block") return;
    expect(crosses.capExhausted).toBe(true);
  });

  it("parks ChatGPT Plus at 100% instead of routing onto an Anthropic key", () => {
    const decision = guard.evaluate(
      fallbackInput({
        active: chatgpt,
        candidate: anthropic,
        reason: "window_exhausted",
      }),
    );
    expect(decision.outcome).toBe("block");
    if (decision.outcome !== "block") return;
    expect(decision.error.code).toBe("fallback_blocked_needs_consent");
    expect(decision.card.kind).toBe("checkpoint_stop");
    expect(decision.card.message).toContain("ChatGPT Plus");
    expect(decision.card.message).toContain("explicit approval");
    expect(decision.card.switchConnection.fromConnectionId).toBe("chatgpt");
    expect(decision.card.switchConnection.toConnectionId).toBe("anthropic");
  });

  it("allows ChatGPT Plus to fall back to OpenRouter only under a $2.00 cap", () => {
    const policy = opted({
      fromConnectionId: "chatgpt",
      toConnectionId: "openrouter",
      capMicroUsd: CAP,
    });
    const allowed = guard.assertAllowed(
      fallbackInput({
        active: chatgpt,
        candidate: openrouter,
        reason: "window_exhausted",
        policy,
        spentMicroUsd: 1_500_000,
        incomingMicroUsd: 400_000,
      }),
    );
    expect(allowed.routeTo).toBe("openrouter");
    expect(allowed.remainingCapMicroUsd).toBe(100_000);

    const stopped = guard.evaluate(
      fallbackInput({
        active: chatgpt,
        candidate: openrouter,
        reason: "window_exhausted",
        policy,
        spentMicroUsd: CAP,
      }),
    );
    expect(stopped.outcome).toBe("block");
    if (stopped.outcome !== "block") return;
    expect(stopped.capExhausted).toBe(true);
    expect(stopped.card.message).toBe(
      "Fallback hard-stopped at $2.00. Cumulative fallback spend reached the cap.",
    );
  });

  it("refuses a silent move from crashed Ollama onto a paid OpenAI key", () => {
    expect(() =>
      guard.assertAllowed(
        fallbackInput({ active: ollama, candidate: openai, reason: "crashed" }),
      ),
    ).toThrow(OLLAMA_STOPPED_ALERT);
    const decision = guard.evaluate(
      fallbackInput({ active: ollama, candidate: openai, reason: "crashed" }),
    );
    expect(decision.outcome).toBe("block");
    if (decision.outcome !== "block") return;
    expect(decision.error.message).toBe(OLLAMA_STOPPED_ALERT);
    expect(decision.card.message).toBe(OLLAMA_STOPPED_ALERT);
  });

  it("also refuses local to subscription and allows a one-click consent switch", () => {
    const plus = connection({
      id: "plus",
      billingClass: "subscription",
      provider: "chatgpt",
      costRank: 10,
      costEstimate: "ChatGPT Plus allowance",
      label: "ChatGPT Plus",
    });
    const silent = guard.evaluate(
      fallbackInput({ active: ollama, candidate: plus, reason: "crashed" }),
    );
    expect(silent.outcome).toBe("block");
    const consented = guard.assertAllowed(
      fallbackInput({
        active: ollama,
        candidate: plus,
        reason: "crashed",
        userConsent: true,
      }),
    );
    expect(consented.routeTo).toBe("plus");
    expect(consented.bounded).toBe(false);
  });

  it("hard-pauses expiry, revocation, and repeated failure without an opt-in rule", () => {
    expect(triggerForStatus("failed", REPEATED_FAILURE_THRESHOLD - 1)).toBeNull();
    expect(triggerForStatus("failed", REPEATED_FAILURE_THRESHOLD)).toBe("repeated_failure");
    expect(triggerForStatus("expired", 0)).toBe("expired");
    expect(triggerForStatus("route_revoked", 0)).toBe("route_revoked");
    for (const reason of ["expired", "route_revoked", "repeated_failure"] as const) {
      const decision = guard.evaluate(
        fallbackInput({ active: chatgpt, candidate: lmStudio, reason }),
      );
      expect(decision.outcome).toBe("block");
      if (decision.outcome !== "block") continue;
      expect(decision.parked).toBe(true);
      expect(decision.card.action).toBe("Switch Connection");
    }
    const explicitLocal = guard.assertAllowed(
      fallbackInput({
        active: chatgpt,
        candidate: lmStudio,
        reason: "route_revoked",
        policy: opted({
          fromConnectionId: "chatgpt",
          toConnectionId: "lmstudio",
          capMicroUsd: 0,
        }),
      }),
    );
    expect(explicitLocal.routeTo).toBe("lmstudio");
    expect(explicitLocal.bounded).toBe(false);
  });

  it("allows a cheaper paid selection and blocks a paused candidate", () => {
    const cheaper = guard.assertAllowed(
      fallbackInput({ active: expensive, candidate: cheap, reason: "selection" }),
    );
    expect(cheaper.routeTo).toBe("cheap");
    const paused = { ...openrouter, routable: false, label: "OpenRouter" };
    const decision = guard.evaluate(
      fallbackInput({ active: chatgpt, candidate: paused, reason: "window_exhausted", userConsent: true }),
    );
    expect(decision.outcome).toBe("block");
    if (decision.outcome !== "block") return;
    expect(decision.card.message).toContain("paused");
  });

  it("keeps the active connection when nothing is switching", () => {
    const stay = guard.assertAllowed(
      fallbackInput({ active: chatgpt, candidate: chatgpt, reason: "window_exhausted" }),
    );
    expect(stay.routeTo).toBe("chatgpt");
    expect(stay.parked).toBe(false);
  });

  it("reads cumulative fallback spend from the budget ledger port", () => {
    const policy = opted({
      fromConnectionId: "chatgpt",
      toConnectionId: "openrouter",
      capMicroUsd: CAP,
    });
    const ledger = new MemoryBudgetLedger();
    ledger.set("project-1", "chatgpt", "openrouter", CAP);
    const decision = evaluateWithLedger(
      guard,
      ledger,
      "project-1",
      fallbackInput({
        active: chatgpt,
        candidate: openrouter,
        reason: "window_exhausted",
        policy,
      }),
    );
    expect(decision.outcome).toBe("block");
    if (decision.outcome !== "block") return;
    expect(decision.capExhausted).toBe(true);
  });

  it("refuses a silent move from an expired Cursor subscription onto a paid API key", () => {
    const decision = guard.refuseSilentPaidFallback({
      connectionId: "cursor-personal",
      from: "cursor_subscription",
      to: "paid_api_key",
    });
    expect(decision.outcome).toBe("block");
    expect(decision.parked).toBe(true);
    expect(decision.capExhausted).toBe(false);
    expect(decision.error).toBeInstanceOf(FallbackBlockedNeedsConsentError);
    expect(decision.card.switchConnection.fromConnectionId).toBe("cursor-personal");
    expect(decision.card.switchConnection.toConnectionId).toBe("cursor-personal:paid-api");
    expect(decision.escalation).toBe("subscription_to_api");
  });

  it("adapts a settings-screen request onto the same guard", () => {
    expect(billingClassForBadge("Local Free")).toBe("local_free");
    expect(billingClassForBadge("Subscription")).toBe("subscription");
    expect(billingClassForBadge("Pay-per-token")).toBe("pay_per_token");
    const blocked = evaluateScreenFallback(guard, {
      activeId: "chatgpt",
      candidateId: "anthropic",
      reason: "window_exhausted",
      neverFallbackWithoutAsking: true,
      explicitFallbackOrder: [],
      spentMicroUsd: 0,
      incomingMicroUsd: 0,
      userConsent: false,
      connections: [chatgpt, anthropic],
    });
    expect(blocked.outcome).toBe("block");
    expect(blocked.parked).toBe(true);
    expect(blocked.message).toContain("explicit approval");
    expect(blocked.costEstimate).toBe(anthropic.costEstimate);

    const allowed = evaluateScreenFallback(guard, {
      activeId: "chatgpt",
      candidateId: "openrouter",
      reason: "window_exhausted",
      neverFallbackWithoutAsking: false,
      explicitFallbackOrder: [
        { fromConnectionId: "chatgpt", toConnectionId: "openrouter", capMicroUsd: CAP },
      ],
      spentMicroUsd: 100_000,
      incomingMicroUsd: 50_000,
      userConsent: false,
      connections: [chatgpt, openrouter],
    });
    expect(allowed).toEqual({
      outcome: "allow",
      message: "Allowed by an explicit capped fallback.",
      costEstimate: openrouter.costEstimate,
      parked: false,
    });

    expect(
      evaluateScreenFallback(guard, {
        activeId: "missing",
        candidateId: "anthropic",
        reason: "selection",
        neverFallbackWithoutAsking: true,
        explicitFallbackOrder: [],
        spentMicroUsd: 0,
        incomingMicroUsd: 0,
        userConsent: true,
        connections: [anthropic],
      }).message,
    ).toContain("Unknown connection");
  });

  it("dispatches a zero-token probe to the matching auth port", async () => {
    const probe = async (connectionId: string) => ({
      latencyMs: connectionId.length,
      discoveredModelCount: 2,
      diagnostic: connectionId,
    });
    const result = await dispatchConnectionProbe(
      "api_key",
      {
        apiKey: { kind: "api_key", probe },
        siwc: { kind: "siwc", probe },
        openRouterAndLocal: { kind: "openrouter_or_local", probe },
        copilotCursor: { kind: "copilot_or_cursor", probe },
      },
      "console",
    );
    expect(result).toEqual({ latencyMs: 7, discoveredModelCount: 2, diagnostic: "console" });
  });

  it("ignores a stored rule while ask-first is still on", () => {
    const decision = guard.evaluate(
      fallbackInput({
        active: chatgpt,
        candidate: openrouter,
        reason: "window_exhausted",
        policy: {
          neverFallbackWithoutAsking: true,
          explicitFallbackOrder: [
            {
              fromConnectionId: "chatgpt",
              toConnectionId: "openrouter",
              capMicroUsd: CAP,
            },
          ],
        },
      }),
    );
    expect(decision.outcome).toBe("block");
    if (decision.outcome !== "block") return;
    expect(decision.capExhausted).toBe(false);
  });
});
