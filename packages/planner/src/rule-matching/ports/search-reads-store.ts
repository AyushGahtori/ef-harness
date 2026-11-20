import { searchQueryHash, searchResultHash } from "../hash.js";

/**
 * Canonical `state.db.search_reads` columns plus the hit count Task 089 mines.
 * `schema/state.sql` has no `hit_count` column; the port keeps it beside the canonical row
 * until Task 018's recorder is wired. `hit_count = 0` is the negative-read set.
 */
export interface SearchReadRow {
  readonly attempt: string;
  readonly queryHash: string;
  readonly query: string;
  readonly resultHash: string;
  readonly rev: number;
  readonly hitCount: number;
  readonly securityProbe: boolean;
  readonly concept: string;
}

export interface SearchReadDraft {
  readonly attempt: string;
  readonly query: string;
  readonly types: readonly string[];
  readonly limit: number;
  readonly resultIds: readonly string[];
  readonly rev: number;
  readonly securityProbe: boolean;
  readonly concept: string;
}

export interface SearchReadStore {
  upsert(row: SearchReadRow): void;
  list(): readonly SearchReadRow[];
}

export function toSearchReadRow(draft: SearchReadDraft): SearchReadRow {
  return {
    attempt: draft.attempt,
    queryHash: searchQueryHash({
      query: draft.query,
      types: draft.types,
      limit: draft.limit,
    }),
    query: JSON.stringify({
      limit: draft.limit,
      query: draft.query,
      types: [...draft.types],
    }),
    resultHash: searchResultHash(draft.resultIds),
    rev: draft.rev,
    hitCount: draft.resultIds.length,
    securityProbe: draft.securityProbe,
    concept: draft.concept,
  };
}

export class InMemorySearchReadStore implements SearchReadStore {
  private readonly rows = new Map<string, SearchReadRow>();

  upsert(row: SearchReadRow): void {
    this.rows.set(`${row.attempt}\u0000${row.queryHash}`, row);
  }

  list(): readonly SearchReadRow[] {
    return [...this.rows.values()].sort((left, right) => {
      const attempt = left.attempt.localeCompare(right.attempt);
      if (attempt !== 0) return attempt;
      return left.queryHash.localeCompare(right.queryHash);
    });
  }
}
