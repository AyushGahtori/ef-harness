import type { SearchReadRow } from "./ports/search-reads-store.js";
import { normalizeSearchConcept } from "./text.js";
import { NEGATIVE_SEARCH_THRESHOLD } from "./types.js";

export interface NegativeSearchGap {
  readonly query: string;
  readonly distinctAttempts: number;
  readonly message: string;
}

/**
 * Mines zero-hit `search_reads` and batches each recurring concept into one finding.
 * Security probes of sealed oracles stay in `search_reads` but are not proposed as doc gaps.
 */
export class NegativeSearchGapDetector {
  detect(rows: readonly SearchReadRow[]): readonly NegativeSearchGap[] {
    const attemptsByQuery = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.hitCount !== 0 || row.securityProbe) continue;
      const concept = normalizeSearchConcept(row.concept);
      if (!concept) continue;
      const attempts = attemptsByQuery.get(concept) ?? new Set<string>();
      attempts.add(row.attempt);
      attemptsByQuery.set(concept, attempts);
    }
    const gaps: NegativeSearchGap[] = [];
    for (const [query, attempts] of attemptsByQuery) {
      if (attempts.size < NEGATIVE_SEARCH_THRESHOLD) continue;
      gaps.push({
        query,
        distinctAttempts: attempts.size,
        message: `Undocumented convention searched ${attempts.size}×: '${query}'`,
      });
    }
    gaps.sort((left, right) => left.query.localeCompare(right.query));
    return gaps;
  }
}
