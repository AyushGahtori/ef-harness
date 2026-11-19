export { asSqliteConnection } from "./connection.js";
export {
  canonicalizeJson,
  computeResultSetHash,
  computeSearchQueryHash,
  createLocalSearchCanonical,
  normalizeNfc,
  resolveSearchCanonical,
  splitSearchText,
} from "./canonical.js";
export { decodeKeysetCursor, encodeKeysetCursor } from "./cursor.js";
export { InvalidCursorError, SearchReadLimitReached } from "./errors.js";
export {
  DEFAULT_PAGE_LIMIT,
  DEFAULT_SNIPPET_CHARS,
  DEFAULT_TOKEN_BUDGET,
  SEARCH_PAGE_MAX,
  SEARCH_READ_CAP,
} from "./filters.js";
export { extractIdentNeedles, extractSearchTokens, sanitizeFtsQuery } from "./sanitize.js";
export { KnowledgeSearchService } from "./service.js";
export type {
  KnowledgeSearchOptions,
  ListNodesQuery,
  RecordSearchReadInput,
  RecordSearchReadResult,
  SearchCanonical,
  SearchFilters,
  SearchHit,
  SearchQuery,
  SearchResultPage,
  SearchResultRef,
  SqliteConnection,
  StaleSearchRead,
} from "./types.js";
