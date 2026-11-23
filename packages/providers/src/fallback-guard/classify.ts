import { isPaidBilling, type EscalationKind, type GuardConnection } from "./types.js";

export function classifyEscalation(
  active: GuardConnection,
  candidate: GuardConnection,
): EscalationKind | null {
  if (active.id === candidate.id) return null;
  if (active.billingClass === "local_free" && isPaidBilling(candidate.billingClass)) {
    return "local_to_paid";
  }
  if (active.billingClass === "subscription" && candidate.billingClass === "pay_per_token") {
    return "subscription_to_api";
  }
  if (
    (active.billingClass === "subscription" || active.provider === "github_copilot") &&
    candidate.billingClass === "copilot_overage"
  ) {
    return "subscription_to_overage";
  }
  if (
    isPaidBilling(active.billingClass) &&
    isPaidBilling(candidate.billingClass) &&
    candidate.costRank > active.costRank
  ) {
    return "cheap_to_expensive";
  }
  return null;
}
