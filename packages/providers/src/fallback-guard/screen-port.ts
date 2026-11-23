import { NoSilentPaidFallbackGuard } from "./guard.js";
import {
  HARD_PAUSE_TRIGGERS,
  type BillingClass,
  type ExplicitFallbackRule,
  type FallbackTrigger,
  type GuardConnection,
} from "./types.js";

export interface ScreenFallbackRequest {
  readonly activeId: string;
  readonly candidateId: string;
  readonly reason: string;
  readonly neverFallbackWithoutAsking: boolean;
  readonly explicitFallbackOrder: readonly ExplicitFallbackRule[];
  readonly spentMicroUsd: number;
  readonly incomingMicroUsd: number;
  readonly userConsent: boolean;
  readonly connections: readonly GuardConnection[];
}

export interface ScreenFallbackResult {
  readonly outcome: "allow" | "block";
  readonly message: string;
  readonly costEstimate: string;
  readonly parked: boolean;
}

const KNOWN_REASONS = new Set<string>([...HARD_PAUSE_TRIGGERS, "selection"]);

export function billingClassForBadge(
  badge: "Subscription" | "Pay-per-token" | "Local Free",
): BillingClass {
  if (badge === "Local Free") return "local_free";
  if (badge === "Subscription") return "subscription";
  return "pay_per_token";
}

function knownReason(reason: string): FallbackTrigger | null {
  return KNOWN_REASONS.has(reason) ? (reason as FallbackTrigger) : null;
}

export function evaluateScreenFallback(
  guard: NoSilentPaidFallbackGuard,
  request: ScreenFallbackRequest,
): ScreenFallbackResult {
  const active = request.connections.find((item) => item.id === request.activeId);
  const candidate = request.connections.find((item) => item.id === request.candidateId);
  if (!active || !candidate) {
    return {
      outcome: "block",
      message: "Unknown connection. Connect a provider before switching.",
      costEstimate: "$0.00",
      parked: true,
    };
  }
  const reason = knownReason(request.reason);
  if (!reason) {
    return {
      outcome: "block",
      message: "Unknown fallback reason. Routing stays parked until the reason is explicit.",
      costEstimate: candidate.costEstimate,
      parked: true,
    };
  }
  const decision = guard.evaluate({
    active,
    candidate,
    reason,
    policy: {
      neverFallbackWithoutAsking: request.neverFallbackWithoutAsking,
      explicitFallbackOrder: request.explicitFallbackOrder,
    },
    spentMicroUsd: request.spentMicroUsd,
    incomingMicroUsd: request.incomingMicroUsd,
    userConsent: request.userConsent,
  });
  if (decision.outcome === "block") {
    return {
      outcome: "block",
      message: decision.card.message,
      costEstimate: decision.card.switchConnection.costEstimate,
      parked: true,
    };
  }
  return {
    outcome: "allow",
    message: "Allowed by an explicit capped fallback.",
    costEstimate: candidate.costEstimate,
    parked: false,
  };
}
