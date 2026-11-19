import type { SearchReadLimitReached } from "./errors.js";

/** Bound value accepted by the SQLite driver wrapper. */
export type SqlValue = string | number | bigint | null | Uint8Array;

export interface SqliteStatement {
  all(params?: Readonly<Record<string, SqlValue>>): Record<string, unknown>[];
  get(params?: Readonly<Record<string, SqlValue>>): Record<string, unknown> | undefined;
  run(params?: Readonly<Record<string, SqlValue>>): {
    changes: number;
    lastInsertRowid: number | bigint;
  };
}

/**
 * Structural subset of `SqliteConnection` from Task 012.
 * Named parameters are bound without the `:prefix` (`:nid` binds as `{ nid }`).
 * Search reads use `reader`. Writes (`search_reads`, index maintenance) use `writer`.
 */
export interface SqliteConnection {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

/** One ranked or listed knowledge node. Bodies are never returned; see `snippet`. */
export interface SearchHit {
  readonly nid: number;
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly title: string;
  readonly status: string;
  readonly feature: string | null;
  readonly basis: string | null;
  readonly snippet: string;
  readonly score: number;
}

/**
 * A bounded page of nodes.
 * `listNodesPaginated` fills `nextCursor` with an opaque base64 keyset of `nid`.
 * Ranked search sets `nextCursor` to null and uses `hasMore` when the cap or token budget cuts the page.
 */
export interface SearchResultPage {
  readonly items: readonly SearchHit[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly resultHash: string;
}

/** Filters shared by ranked search and keyset listing. `status` defaults to `active`. */
export interface SearchFilters {
  readonly kinds?: readonly string[];
  readonly feature?: string;
  readonly status?: string;
  readonly basis?: readonly string[];
  readonly tags?: readonly string[];
  readonly limit?: number;
}

export interface SearchQuery extends SearchFilters {
  readonly query: string;
}

export interface ListNodesQuery extends SearchFilters {
  readonly cursor?: string;
}

/** A recorded search whose current result hash no longer matches `search_reads`. */
export interface StaleSearchRead {
  readonly attempt: string;
  readonly queryHash: string;
  readonly query: string;
  readonly recordedResultHash: string;
  readonly currentResultHash: string;
  readonly rev: number;
}

export interface SearchResultRef {
  readonly id: string;
  readonly version: number;
}

export interface RecordSearchReadInput {
  readonly attempt: string;
  readonly query: SearchQuery;
  readonly rev: number;
  /** Result set the attempt actually saw. Omitted means "search again now". */
  readonly items?: readonly SearchResultRef[];
}

export type RecordSearchReadResult =
  | {
      readonly ok: true;
      readonly queryHash: string;
      readonly resultHash: string;
      readonly deduplicated: boolean;
    }
  | {
      readonly ok: false;
      readonly notice: SearchReadLimitReached;
    };

/** Task 007 functions this service consumes. A local parity implementation is the fallback. */
export interface SearchCanonical {
  splitSearchText(value: unknown): string;
  computeSearchQueryHash(input: { query: unknown; filters: unknown }): string;
  computeResultSetHash(results: readonly SearchResultRef[]): string;
}

export interface KnowledgeSearchOptions {
  readonly reader: SqliteConnection;
  readonly writer: SqliteConnection;
  readonly canonical?: SearchCanonical;
  /** Hard cap on each snippet. Defaults to 180 characters. */
  readonly snippetChars?: number;
  /** Approximate token budget for one ranked search response. Defaults to 1200. */
  readonly tokenBudget?: number;
}
