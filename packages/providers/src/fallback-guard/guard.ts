import { classifyEscalation } from "./classify.js";
import { FallbackBlockedNeedsConsentError } from "./errors.js";
import {
  formatMicroUsd,
  isHardPauseTrigger,
  isPaidBilling,
  type CheckpointStopCard,
  type EscalationKind,
  type ExplicitFallbackRule,
  type FallbackAllow,
  type FallbackBlock,
  type FallbackDecision,
  type FallbackInput,
  type GuardConnection,
} from "./types.js";

const OLLAMA_OPENAI_ALERT =
  "Ollama stopped — Restart Ollama or explicitly switch to OpenAI";

function matchingRule(input: FallbackInput): ExplicitFallbackRule | null {
  for (const rule of input.policy.explicitFallbackOrder) {
    if (
      rule.fromConnectionId === input.active.id &&
      rule.toConnectionId === input.candidate.id
    ) {
      return rule;
    }
  }
  return null;
}

function integersAreSound(input: FallbackInput): boolean {
  return (
    Number.isInteger(input.spentMicroUsd) &&
    input.spentMicroUsd >= 0 &&
    Number.isInteger(input.incomingMicroUsd) &&
    input.incomingMicroUsd >= 0 &&
    Number.isInteger(input.candidate.costRank) &&
    Number.isInteger(input.active.costRank)
  );
}

function capDecision(
  rule: ExplicitFallbackRule,
  candidate: GuardConnection,
  spentMicroUsd: number,
  incomingMicroUsd: number,
): "allow" | "cap" {
  if (candidate.billingClass === "local_free") return "allow";
  if (rule.capMicroUsd <= 0) return "cap";
  if (spentMicroUsd >= rule.capMicroUsd) return "cap";
  if (spentMicroUsd + incomingMicroUsd > rule.capMicroUsd) return "cap";
  return "allow";
}

function consentMessage(
  active: GuardConnection,
  candidate: GuardConnection,
  escalation: EscalationKind | null,
  reason: FallbackInput["reason"],
): string {
  const localCrash = active.billingClass === "local_free" && (reason === "crashed" || active.status === "crashed");
  if (localCrash && active.provider === "ollama" && candidate.provider === "openai") {
    return OLLAMA_OPENAI_ALERT;
  }
  if (localCrash) {
    return `${active.label} stopped — Restart ${active.label} or explicitly switch to ${candidate.label}`;
  }
  if (escalation === "subscription_to_overage") {
    return `${active.label} included allowance is exhausted. Paid overage needs explicit approval before any charge. Estimated cost: ${candidate.costEstimate}.`;
  }
  if (escalation === "local_to_paid") {
    return `${active.label} cannot silently switch to paid ${candidate.label}. Restart it or explicitly switch. Estimated cost: ${candidate.costEstimate}.`;
  }
  return `${active.label} is paused. Switch Connection to ${candidate.label} only with explicit approval. Estimated cost: ${candidate.costEstimate}.`;
}

function stopCard(
  active: GuardConnection,
  candidate: GuardConnection,
  message: string,
  capExhausted: boolean,
): CheckpointStopCard {
  return {
    kind: "checkpoint_stop",
    title: "Checkpoint stop",
    action: "Switch Connection",
    message,
    parked: true,
    capExhausted,
    switchConnection: {
      fromConnectionId: active.id,
      toConnectionId: candidate.id,
      costEstimate: candidate.costEstimate,
      requiresOneClickConsent: true,
    },
  };
}

function allow(
  candidateId: string,
  escalation: EscalationKind | null,
  bounded: boolean,
  remainingCapMicroUsd: number | null,
): FallbackAllow {
  return {
    outcome: "allow",
    parked: false,
    bounded,
    remainingCapMicroUsd,
    escalation,
    routeTo: candidateId,
  };
}

function block(
  active: GuardConnection,
  candidate: GuardConnection,
  escalation: EscalationKind | null,
  message: string,
  capExhausted: boolean,
): FallbackBlock {
  const card = stopCard(active, candidate, message, capExhausted);
  return {
    outcome: "block",
    parked: true,
    capExhausted,
    escalation,
    card,
    error: new FallbackBlockedNeedsConsentError(card),
  };
}

function capMessage(rule: ExplicitFallbackRule): string {
  return `Fallback hard-stopped at ${formatMicroUsd(rule.capMicroUsd)}. Cumulative fallback spend reached the cap.`;
}

function remaining(rule: ExplicitFallbackRule, spent: number, incoming: number): number {
  return rule.capMicroUsd - spent - incoming;
}

export class NoSilentPaidFallbackGuard {
  evaluate(input: FallbackInput): FallbackDecision {
    const escalation = classifyEscalation(input.active, input.candidate);
    if (input.active.id === input.candidate.id) {
      return allow(input.active.id, null, false, null);
    }
    if (!input.candidate.routable) {
      return block(
        input.active,
        input.candidate,
        escalation,
        `${input.candidate.label} is paused. Routing skips a paused connection.`,
        false,
      );
    }
    if (!integersAreSound(input)) {
      return block(
        input.active,
        input.candidate,
        escalation,
        "Fallback spend must be a non-negative integer micro-USD amount.",
        false,
      );
    }

    const rule = matchingRule(input);
    const needsGate = escalation !== null || isHardPauseTrigger(input.reason);

    if (input.userConsent) {
      if (rule && capDecision(rule, input.candidate, input.spentMicroUsd, input.incomingMicroUsd) === "cap") {
        return block(input.active, input.candidate, escalation, capMessage(rule), true);
      }
      return allow(
        input.candidate.id,
        escalation,
        rule !== null && isPaidBilling(input.candidate.billingClass),
        rule && isPaidBilling(input.candidate.billingClass)
          ? remaining(rule, input.spentMicroUsd, input.incomingMicroUsd)
          : null,
      );
    }

    if (!needsGate) {
      return allow(input.candidate.id, null, false, null);
    }

    if (input.policy.neverFallbackWithoutAsking || rule === null) {
      return block(
        input.active,
        input.candidate,
        escalation,
        consentMessage(input.active, input.candidate, escalation, input.reason),
        false,
      );
    }

    if (capDecision(rule, input.candidate, input.spentMicroUsd, input.incomingMicroUsd) === "cap") {
      return block(input.active, input.candidate, escalation, capMessage(rule), true);
    }

    const bounded = isPaidBilling(input.candidate.billingClass);
    return allow(
      input.candidate.id,
      escalation,
      bounded,
      bounded ? remaining(rule, input.spentMicroUsd, input.incomingMicroUsd) : null,
    );
  }

  assertAllowed(input: FallbackInput): FallbackAllow {
    const decision = this.evaluate(input);
    if (decision.outcome === "block") {
      throw decision.error;
    }
    return decision;
  }

  refuseSilentPaidFallback(event: {
    readonly connectionId: string;
    readonly from: "cursor_subscription";
    readonly to: "paid_api_key";
  }): FallbackBlock {
    const decision = this.evaluate({
      active: {
        id: event.connectionId,
        label: "Cursor",
        provider: "cursor",
        family: "cursor",
        billingClass: "subscription",
        costRank: 10,
        costEstimate: "Cursor plan allowance",
        status: "expired",
        routable: false,
      },
      candidate: {
        id: `${event.connectionId}:paid-api`,
        label: "Paid API key",
        provider: "paid_api_key",
        family: "api",
        billingClass: "pay_per_token",
        costRank: 50,
        costEstimate: "Pay-per-token API",
        status: "healthy",
        routable: true,
      },
      reason: "expired",
      policy: { neverFallbackWithoutAsking: true, explicitFallbackOrder: [] },
      spentMicroUsd: 0,
      incomingMicroUsd: 0,
      userConsent: false,
    });
    if (decision.outcome === "block") return decision;
    return block(
      {
        id: event.connectionId,
        label: "Cursor",
        provider: "cursor",
        family: "cursor",
        billingClass: "subscription",
        costRank: 10,
        costEstimate: "Cursor plan allowance",
        status: "expired",
        routable: false,
      },
      {
        id: `${event.connectionId}:paid-api`,
        label: "Paid API key",
        provider: "paid_api_key",
        family: "api",
        billingClass: "pay_per_token",
        costRank: 50,
        costEstimate: "Pay-per-token API",
        status: "healthy",
        routable: true,
      },
      "subscription_to_api",
      "Cursor is paused. Switch Connection to a paid API key only with explicit approval.",
      false,
    );
  }
}

export const OLLAMA_STOPPED_ALERT = OLLAMA_OPENAI_ALERT;
