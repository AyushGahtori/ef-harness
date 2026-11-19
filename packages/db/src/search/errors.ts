/** Thrown when a keyset cursor is missing, truncated, or not a positive `nid`. */
export class InvalidCursorError extends Error {
  readonly code = "invalid_cursor" as const;

  constructor(message = "malformed keyset cursor") {
    super(message);
    this.name = "InvalidCursorError";
  }
}

/**
 * Structured notice returned when an attempt already has 50 distinct `search_reads`.
 * Repeating an existing `query_hash` does not produce this notice.
 */
export class SearchReadLimitReached extends Error {
  readonly code = "search_read_limit_reached" as const;
  readonly attempt: string;
  readonly limit = 50 as const;

  constructor(attempt: string) {
    super(`attempt ${attempt} already recorded 50 search reads`);
    this.name = "SearchReadLimitReached";
    this.attempt = attempt;
  }
}
