import type { KnowledgeSearchPort, SearchVerification } from "./ports.js";
import {
  EMPTY_SEARCH_RESULT_HASH,
  canonicalSearchResultHash,
  type SearchResultItem,
} from "./search-hash.js";
import { asRecord, parseJsonOrNull, readRowNumber, readRowString, type SqlDatabase } from "./sql.js";
import type { SearchDivergence } from "./types.js";

/** Read-only re-run of `search_reads` until Task 018's service is wired. */
export class LocalRecordedSearchVerifier implements KnowledgeSearchPort {
  constructor(private readonly db: SqlDatabase) {}

  verifyRecordedSearchReads(input: { readonly attempt: string; readonly limit: number }): SearchVerification {
    const countRow = this.db
      .prepare(`SELECT count(*) AS n FROM search_reads WHERE attempt = :attempt`)
      .get({ attempt: input.attempt });
    const total = countRow ? readRowNumber(countRow, "n") : 0;
    const rows = this.db
      .prepare(
        `SELECT query_hash, query, result_hash
           FROM search_reads
          WHERE attempt = :attempt
          ORDER BY query_hash
          LIMIT :limit`,
      )
      .all({ attempt: input.attempt, limit: input.limit });
    const divergences: SearchDivergence[] = [];
    for (const row of rows) {
      const queryHash = readRowString(row, "query_hash");
      const recordedResultHash = readRowString(row, "result_hash");
      const currentItems = executeRecordedSearch(this.db, readRowString(row, "query"));
      const currentResultHash = canonicalSearchResultHash(currentItems);
      if (currentResultHash === recordedResultHash) continue;
      const recordedWasEmpty = recordedResultHash === EMPTY_SEARCH_RESULT_HASH;
      divergences.push({
        queryHash,
        recordedResultHash,
        currentResultHash,
        recordedWasEmpty,
        currentItems,
        appeared: recordedWasEmpty ? currentItems : [],
      });
    }
    return {
      divergences,
      checked: rows.length,
      truncated: total > input.limit,
    };
  }
}

export function executeRecordedSearch(db: SqlDatabase, queryJson: string): SearchResultItem[] {
  const parsed = asRecord(parseJsonOrNull(queryJson));
  const query = typeof parsed?.query === "string" ? parsed.query : "";
  const filters = asRecord(parsed?.filters);
  const kind = typeof filters?.kind === "string" ? filters.kind : null;
  const feature = typeof filters?.feature === "string" ? filters.feature : null;
  const rows = db
    .prepare(
      `SELECT id, version
         FROM nodes
        WHERE status = 'active'
          AND (:kind = '' OR kind = :kind)
          AND (:feature = '' OR feature = :feature)
          AND (
            :query = ''
            OR instr(lower(id), lower(:query)) > 0
            OR instr(lower(title), lower(:query)) > 0
            OR instr(lower(text), lower(:query)) > 0
          )
        ORDER BY id
        LIMIT 500`,
    )
    .all({ kind: kind ?? "", feature: feature ?? "", query });
  return rows.map((row) => ({
    id: readRowString(row, "id"),
    version: readRowNumber(row, "version"),
  }));
}
