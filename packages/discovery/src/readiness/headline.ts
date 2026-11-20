import { ReadinessHonestyError, type ReadinessCounts, type ScopeDisposition } from "./types.js";

export function formatReadinessHeadline(input: {
  counts: ReadinessCounts;
  disposition: ScopeDisposition;
  transitivePrereqsMet: boolean;
  blockedByPrereq: readonly string[];
}): string {
  if (input.disposition === "awaiting_definition") return "awaiting scope definition";
  if (input.disposition === "not_applicable") {
    return "Not applicable · excluded from the active denominator";
  }
  const counts = input.counts;
  const parts = [`${counts.settledTotal} of ${counts.activeDenominator} settled`];
  if (counts.openMustAsk > 0) parts.push(`${counts.openMustAsk} must-ask left`);
  const conflictIsOnlyRemainder =
    counts.conflict > 0 &&
    counts.openMustAsk === 0 &&
    counts.pendingVerification === 0 &&
    counts.openStandard === 0 &&
    counts.partial === 0 &&
    counts.missing === 0 &&
    counts.chosenForYou === 0 &&
    counts.deferred === 0;
  if (counts.conflict > 0) {
    if (conflictIsOnlyRemainder) {
      parts.push(
        counts.conflict === 1 ? "1 conflict blocks planning" : `${counts.conflict} conflicts block planning`,
      );
    } else {
      parts.push(counts.conflict === 1 ? "1 conflict" : `${counts.conflict} conflicts`);
    }
  }
  if (counts.pendingVerification > 0) parts.push(`${counts.pendingVerification} pending verification`);
  if (counts.openStandard > 0) parts.push(`${counts.openStandard} open`);
  if (counts.partial > 0) parts.push(`${counts.partial} partial`);
  if (counts.missing > 0) parts.push(`${counts.missing} missing`);
  if (counts.chosenForYou > 0) parts.push(`${counts.chosenForYou} chosen for you`);
  if (counts.deferred > 0) parts.push(`${counts.deferred} deferred`);
  if (!input.transitivePrereqsMet && input.blockedByPrereq.length > 0) {
    parts.push(`blocked by ${input.blockedByPrereq.join(", ")}`);
  }
  const headline = parts.join(" · ");
  if (headline.includes("%") || headline.includes("NaN") || headline.includes("Infinity")) {
    throw new ReadinessHonestyError("readiness headlines use exact counts and never a rounded percentage");
  }
  return headline;
}
