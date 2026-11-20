import type { AcceptanceCard, BatchEntry } from "./types.js";

function endpointClause(entry: BatchEntry, first: boolean): string {
  const verb = first ? "Imported" : "imported";
  return `${verb} ${entry.endpointCount} API endpoints from ${entry.sourceName} (exact)`;
}

/**
 * One calm card for a dropped folder. Risky and conflicting items stay
 * uncommitted until the developer accepts them.
 */
export class ImportBatchSummarizer {
  summarize(entries: readonly BatchEntry[]): AcceptanceCard {
    const parts: string[] = [];
    const withEndpoints = entries.filter((entry) => entry.endpointCount > 0);
    withEndpoints.forEach((entry, index) => {
      parts.push(endpointClause(entry, index === 0 && parts.length === 0));
    });
    for (const entry of entries) {
      if (entry.requirementCount > 0) {
        parts.push(`extracted ${entry.requirementCount} candidate requirements from ${entry.sourceName}`);
      }
    }
    const conflicts = entries.reduce((sum, entry) => sum + entry.conflictCount, 0);
    if (conflicts > 0) parts.push(`found ${conflicts} conflicts with your prompt`);
    const riskyItemCount = entries.filter((entry) => entry.risky || entry.conflictCount > 0).length;
    return {
      summary: parts.join(", "),
      documents: entries,
      reviewBeforeCommit: true,
      riskyItemCount,
    };
  }

  selectiveAcceptance(
    card: AcceptanceCard,
    choice: { readonly includeRisky?: boolean; readonly sources?: readonly string[] } = {},
  ): { readonly accepted: readonly string[]; readonly heldForReview: readonly string[] } {
    const includeRisky = choice.includeRisky === true;
    const allowed = choice.sources ? new Set(choice.sources) : null;
    const accepted: string[] = [];
    const heldForReview: string[] = [];
    for (const entry of card.documents) {
      if (allowed && !allowed.has(entry.sourceName)) {
        heldForReview.push(entry.sourceName);
        continue;
      }
      const risky = entry.risky || entry.conflictCount > 0;
      if (risky && !includeRisky) heldForReview.push(entry.sourceName);
      else accepted.push(entry.sourceName);
    }
    return { accepted, heldForReview };
  }
}
