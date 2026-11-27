import type { RouteDecision, SymptomCard } from "./types.js";

const CRITICAL_GAPS = new Set([
  "expectedBehavior",
  "observedBehavior",
  "reproductionSteps",
  "expected",
  "observed",
  "steps",
]);

/**
 * Complete, located cards go to Brownfield Fix Discovery (Task 169).
 * Incomplete cards go to the 6-stage Mystery-Bug Investigation (Task 182).
 */
export function routeSymptomCard(card: SymptomCard): RouteDecision {
  const missingCritical = card.missingReproInfo.some((item) => CRITICAL_GAPS.has(item));
  const located =
    card.mappedStackFrames.some((frame) => frame.resolved) ||
    card.affectedUrlsOrRoutes.length > 0 ||
    card.failingHttpRequests.length > 0;
  const clear =
    card.title.trim().length > 0 &&
    card.observedBehavior.trim().length > 0 &&
    card.expectedBehavior.trim().length > 0 &&
    card.reproductionSteps.length > 0 &&
    !missingCritical &&
    located;
  if (clear) {
    return {
      route: "brownfield_fix_discovery",
      task: "169",
      reason:
        "Symptom card has a complete reproduction and a located failure, so it enters focused Brownfield Fix Discovery.",
    };
  }
  return {
    route: "mystery_investigation",
    task: "182",
    reason:
      "Symptom card is missing reproduction detail or a located failure, so it enters the 6-stage Mystery-Bug Investigation.",
  };
}
