export const MICRO_USD_PER_DOLLAR = 1_000_000;

export const BILLING_CLASSES = [
  "local_free",
  "subscription",
  "pay_per_token",
  "copilot_overage",
] as const;

export type BillingClass = (typeof BILLING_CLASSES)[number];

export const HARD_PAUSE_TRIGGERS = [
  "window_exhausted",
  "expired",
  "route_revoked",
  "repeated_failure",
  "crashed",
] as const;

export type HardPauseTrigger = (typeof HARD_PAUSE_TRIGGERS)[number];

export type FallbackTrigger = HardPauseTrigger | "selection";

export const REPEATED_FAILURE_THRESHOLD = 3;

export type ConnectionHealth =
  | "healthy"
  | "exhausted"
  | "expired"
  | "route_revoked"
  | "failed"
  | "crashed"
  | "paused";

export interface GuardConnection {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly family: string;
  readonly billingClass: BillingClass;
  readonly costRank: number;
  readonly costEstimate: string;
  readonly status: ConnectionHealth;
  readonly routable: boolean;
}

export interface ExplicitFallbackRule {
  readonly fromConnectionId: string;
  readonly toConnectionId: string;
  readonly capMicroUsd: number;
}

export interface ProjectFallbackPolicy {
  readonly neverFallbackWithoutAsking: boolean;
  readonly explicitFallbackOrder: readonly ExplicitFallbackRule[];
}

export const DEFAULT_FALLBACK_POLICY: ProjectFallbackPolicy = {
  neverFallbackWithoutAsking: true,
  explicitFallbackOrder: [],
};

export type EscalationKind =
  | "local_to_paid"
  | "subscription_to_api"
  | "subscription_to_overage"
  | "cheap_to_expensive";

export interface FallbackInput {
  readonly active: GuardConnection;
  readonly candidate: GuardConnection;
  readonly reason: FallbackTrigger;
  readonly policy: ProjectFallbackPolicy;
  readonly spentMicroUsd: number;
  readonly incomingMicroUsd: number;
  readonly userConsent: boolean;
}

export interface CheckpointStopCard {
  readonly kind: "checkpoint_stop";
  readonly title: "Checkpoint stop";
  readonly action: "Switch Connection";
  readonly message: string;
  readonly parked: true;
  readonly capExhausted: boolean;
  readonly switchConnection: {
    readonly fromConnectionId: string;
    readonly toConnectionId: string;
    readonly costEstimate: string;
    readonly requiresOneClickConsent: true;
  };
}

export interface FallbackAllow {
  readonly outcome: "allow";
  readonly parked: false;
  readonly bounded: boolean;
  readonly remainingCapMicroUsd: number | null;
  readonly escalation: EscalationKind | null;
  readonly routeTo: string;
}

export interface FallbackBlock {
  readonly outcome: "block";
  readonly parked: true;
  readonly capExhausted: boolean;
  readonly escalation: EscalationKind | null;
  readonly card: CheckpointStopCard;
  readonly error: FallbackBlockedError;
}

export type FallbackDecision = FallbackAllow | FallbackBlock;

export interface FallbackBlockedError extends Error {
  readonly name: "FallbackBlockedNeedsConsentError";
  readonly code: "fallback_blocked_needs_consent";
  readonly parked: true;
  readonly capExhausted: boolean;
  readonly card: CheckpointStopCard;
}

export function isHardPauseTrigger(reason: FallbackTrigger): reason is HardPauseTrigger {
  return reason !== "selection";
}

export function isPaidBilling(billingClass: BillingClass): boolean {
  return billingClass !== "local_free";
}

export function formatMicroUsd(microUsd: number): string {
  const negative = microUsd < 0;
  const abs = Math.abs(Math.trunc(microUsd));
  const dollars = Math.floor(abs / MICRO_USD_PER_DOLLAR);
  const cents = Math.floor((abs % MICRO_USD_PER_DOLLAR) / 10_000);
  const text = `$${dollars}.${String(cents).padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

export function triggerForStatus(
  status: ConnectionHealth,
  failureCount: number,
): FallbackTrigger | null {
  if (status === "exhausted") return "window_exhausted";
  if (status === "expired") return "expired";
  if (status === "route_revoked") return "route_revoked";
  if (status === "crashed") return "crashed";
  if (status === "failed" && failureCount >= REPEATED_FAILURE_THRESHOLD) {
    return "repeated_failure";
  }
  return null;
}

export function fallbackInput(
  input: Omit<FallbackInput, "policy" | "spentMicroUsd" | "incomingMicroUsd" | "userConsent"> &
    Partial<Pick<FallbackInput, "policy" | "spentMicroUsd" | "incomingMicroUsd" | "userConsent">>,
): FallbackInput {
  return {
    active: input.active,
    candidate: input.candidate,
    reason: input.reason,
    policy: input.policy ?? DEFAULT_FALLBACK_POLICY,
    spentMicroUsd: input.spentMicroUsd ?? 0,
    incomingMicroUsd: input.incomingMicroUsd ?? 0,
    userConsent: input.userConsent ?? false,
  };
}
