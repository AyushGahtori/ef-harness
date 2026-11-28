import { VersionedModelRoster, type SubscriptionWeight } from "@ef-harness/planner";
import type { SignedProviderPolicyEngine } from "../policy/signed-provider-policy-engine.js";
import type { SubscriptionWeightFeed } from "./types.js";

export function subscriptionWeightsFromFeeds(feeds: readonly SubscriptionWeightFeed[]): SubscriptionWeight[] {
  return feeds.map((feed) => ({
    modelId: feed.modelId,
    allowancePpmPer1M: feed.allowancePpmPer1M,
  }));
}

/** Task 106 consumes Task 140 weights without planner importing providers. */
export function applyAllowanceWeights(
  roster: VersionedModelRoster,
  feeds: readonly SubscriptionWeightFeed[],
): VersionedModelRoster {
  return roster.applySubscriptionWeights(subscriptionWeightsFromFeeds(feeds));
}

/**
 * Signed policy seeds the roster. Pacing feeds then set subscription `k[model]`.
 * Both calls stay in providers, which already depends on planner.
 */
export function rosterWithPolicyAndPacing(
  policy: SignedProviderPolicyEngine,
  feeds: readonly SubscriptionWeightFeed[],
): VersionedModelRoster | null {
  const roster = policy.plannerRoster();
  if (!roster) return null;
  return applyAllowanceWeights(roster, feeds);
}
