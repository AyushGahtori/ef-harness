import { canonicalizeJson } from "./canonical.js";
import { resolveSearchCanonical } from "./canonical.js";
import { decodeKeysetCursor, encodeKeysetCursor } from "./cursor.js";
import { SearchReadLimitReached } from "./errors.js";
import {
  DEFAULT_SNIPPET_CHARS,
  DEFAULT_TOKEN_BUDGET,
  hashFilters,
  nodeFilterSql,
  normalizeFilters,
  SEARCH_PAGE_MAX,
  SEARCH_READ_CAP,
  type NormalizedFilters,
} from "./filters.js";
import { escapeLike, extractIdentNeedles, extractSearchTokens, sanitizeFtsQuery } from "./sanitize.js";
import { buildSnippet, estimateTokens } from "./snippet.js";
import type {
  KnowledgeSearchOptions,
  ListNodesQuery,
  RecordSearchReadInput,
  RecordSearchReadResult,
  SearchCanonical,
  SearchHit,
  SearchQuery,
  SearchResultPage,
  SearchResultRef,
  SqliteConnection,
  SqlValue,
  StaleSearchRead,
} from "./types.js";

interface RankedRow {
  nid: number;
  id: string;
  kind: string;
  version: number;
  title: string;
  text: string;
  status: string;
  feature: string | null;
  basis: string | null;
  score: number;
}

const READ_SQL_FORBIDDEN =
  /\b(insert|update|delete|replace|begin|commit|rollback|vacuum|attach|offset|create|drop|alter)\b/i;

const NODE_COLUMNS = `
  n.nid AS nid,
  n.id AS id,
  n.kind AS kind,
  n.version AS version,
  n.title AS title,
  n.text AS text,
  n.status AS status,
  n.feature AS feature,
  n.basis AS basis
`;

/**
 * Dual FTS5 knowledge search over `kb_words` (BM25, title weighted above body)
 * and `kb_ident` (trigram external content, queried with bounded LIKE).
 * `searchNodes` and `listNodesPaginated` only prepare SELECT statements on `reader`.
 */
export class KnowledgeSearchService {
  private readonly reader: SqliteConnection;
  private readonly writer: SqliteConnection;
  private readonly canonical: SearchCanonical;
  private readonly snippetChars: number;
  private readonly tokenBudget: number;

  constructor(options: KnowledgeSearchOptions) {
    this.reader = options.reader;
    this.writer = options.writer;
    this.canonical = resolveSearchCanonical(options.canonical);
    this.snippetChars = positiveInt(options.snippetChars, DEFAULT_SNIPPET_CHARS);
    this.tokenBudget = positiveInt(options.tokenBudget, DEFAULT_TOKEN_BUDGET);
  }

  searchNodes(query: SearchQuery): SearchResultPage {
    const filters = normalizeFilters(query);
    const text = typeof query.query === "string" ? query.query : "";
    const tokens = extractSearchTokens(text);
    const merged = this.collectHits(text, filters);
    merged.sort(compareHits);
    return this.finishRankedPage(merged, tokens, filters.limit, true);
  }

  /** Substring search of node ids through `kb_ident`. One- and two-character needles use LIKE. */
  searchByIdSubstring(substring: string, filtersInput: Omit<SearchQuery, "query"> = {}): SearchResultPage {
    const filters = normalizeFilters(filtersInput);
    const needle = typeof substring === "string" ? substring.trim() : "";
    const hits = needle.length === 0 ? [] : this.identHits([needle], filters);
    hits.sort(compareHits);
    const tokens = extractSearchTokens(needle);
    return this.finishRankedPage(hits, tokens, filters.limit, true);
  }

  /**
   * Keyset page over `nodes.nid`. `limit` is clamped to `[1, 500]`.
   * `WHERE nid > :lastNid` stays valid when the cursor's node later changes status.
   */
  listNodesPaginated(query: ListNodesQuery = {}): SearchResultPage {
    const filters = normalizeFilters(query);
    const cursor = query.cursor === undefined || query.cursor === "" ? undefined : query.cursor;
    const lastNid = cursor === undefined ? 0 : decodeKeysetCursor(cursor);
    const filter = nodeFilterSql(filters, { excludeHiddenChecks: false });
    const params: Record<string, SqlValue> = {
      ...filter.params,
      last_nid: lastNid,
      page_limit: filters.limit + 1,
    };
    const rows = this.readAll(
      `SELECT ${NODE_COLUMNS}
         FROM nodes AS n
        WHERE ${filter.sql}
          AND n.nid > :last_nid
        ORDER BY n.nid ASC
        LIMIT :page_limit`,
      params,
    );
    const hasExtra = rows.length > filters.limit;
    const pageRows = hasExtra ? rows.slice(0, filters.limit) : rows;
    const items = pageRows.map((row) => {
      const ranked = readRanked(row, 0);
      return this.hitFromRow({ ...ranked, text: "" }, []);
    });
    const last = items[items.length - 1];
    const nextCursor = hasExtra && last ? encodeKeysetCursor(last.nid) : null;
    return {
      items,
      nextCursor,
      hasMore: hasExtra,
      resultHash: this.canonical.computeResultSetHash(refsOf(items)),
    };
  }

  /**
   * Persist what an attempt saw, including an empty result set.
   * The same `query_hash` is stored once. A 51st distinct query returns `SearchReadLimitReached`.
   */
  recordSearchRead(input: RecordSearchReadInput): RecordSearchReadResult {
    const attempt = requireAttempt(input.attempt);
    const rev = requireRev(input.rev);
    const filters = normalizeFilters(input.query);
    const payload = { query: input.query.query, filters: hashFilters(filters) };
    const queryJson = canonicalizeJson(payload);
    const queryHash = this.canonical.computeSearchQueryHash(payload);
    const items = input.items ?? refsOf(this.searchNodes(input.query).items);
    const resultHash = this.canonical.computeResultSetHash(items);
    return this.transaction(() => {
      const existing = this.writer.prepare(
        `SELECT result_hash AS result_hash
           FROM search_reads
          WHERE attempt = :attempt AND query_hash = :query_hash`,
      ).get({ attempt, query_hash: queryHash });
      if (existing) {
        return {
          ok: true as const,
          queryHash,
          resultHash: rowString(existing, "result_hash"),
          deduplicated: true,
        };
      }
      const countRow = this.writer.prepare(
        `SELECT count(*) AS c FROM search_reads WHERE attempt = :attempt`,
      ).get({ attempt });
      const count = countRow ? rowNumber(countRow, "c") : 0;
      if (count >= SEARCH_READ_CAP) {
        return { ok: false as const, notice: new SearchReadLimitReached(attempt) };
      }
      this.writer.prepare(
        `INSERT INTO search_reads(attempt, query_hash, query, result_hash, rev)
         VALUES (:attempt, :query_hash, :query, :result_hash, :rev)`,
      ).run({
        attempt,
        query_hash: queryHash,
        query: queryJson,
        result_hash: resultHash,
        rev,
      });
      return { ok: true as const, queryHash, resultHash, deduplicated: false };
    });
  }

  /** Re-run every recorded search. A changed hash, including empty to non-empty, is stale. */
  verifyRecordedSearchReads(attempt: string): StaleSearchRead[] {
    const id = requireAttempt(attempt);
    const rows = this.readAll(
      `SELECT query_hash AS query_hash, query AS query, result_hash AS result_hash, rev AS rev
         FROM search_reads
        WHERE attempt = :attempt
        ORDER BY query_hash ASC`,
      { attempt: id },
    );
    const stale: StaleSearchRead[] = [];
    for (const row of rows) {
      const storedQuery = rowString(row, "query");
      const recordedResultHash = rowString(row, "result_hash");
      const replay = this.searchNodes(parseStoredQuery(storedQuery));
      const currentResultHash = this.canonical.computeResultSetHash(refsOf(replay.items));
      if (currentResultHash === recordedResultHash) continue;
      stale.push({
        attempt: id,
        queryHash: rowString(row, "query_hash"),
        query: storedQuery,
        recordedResultHash,
        currentResultHash,
        rev: rowNumber(row, "rev"),
      });
    }
    return stale;
  }

  /** `INSERT INTO fts(fts) VALUES('optimize')` for both knowledge indexes. */
  optimizeSearchIndexes(): void {
    this.writer.exec("INSERT INTO kb_words(kb_words) VALUES('optimize')");
    this.writer.exec("INSERT INTO kb_ident(kb_ident) VALUES('optimize')");
  }

  /**
   * Repopulate `kb_words` from `nodes` (`rebuild` is rejected on a contentless table)
   * and rebuild external-content `kb_ident` from `nodes.nid`.
   */
  rebuildSearchIndexes(): void {
    this.transaction(() => {
      const rows = this.writer.prepare(
        `SELECT nid AS nid, title AS title, text AS text, fields AS fields FROM nodes ORDER BY nid ASC`,
      ).all();
      this.writer.exec("DELETE FROM kb_words");
      const insert = this.writer.prepare(
        `INSERT INTO kb_words(rowid, title, body) VALUES (:nid, :title, :body)`,
      );
      for (const row of rows) {
        const text = rowString(row, "text");
        const fields = rowString(row, "fields");
        insert.run({
          nid: rowNumber(row, "nid"),
          title: this.canonical.splitSearchText(rowString(row, "title")),
          body: this.canonical.splitSearchText(`${text} ${fields}`),
        });
      }
      this.writer.exec("INSERT INTO kb_ident(kb_ident) VALUES('rebuild')");
    });
  }

  private collectHits(text: string, filters: NormalizedFilters): RankedRow[] {
    const byNid = new Map<number, RankedRow>();
    const match = sanitizeFtsQuery(text);
    if (match.length > 0) {
      for (const row of this.wordHits(match, filters)) {
        byNid.set(row.nid, row);
      }
    }
    const needles = extractIdentNeedles(text);
    if (needles.length > 0) {
      for (const row of this.identHits(needles, filters)) {
        const existing = byNid.get(row.nid);
        if (!existing) {
          byNid.set(row.nid, row);
          continue;
        }
        if (row.score < existing.score) existing.score = row.score;
      }
    }
    return [...byNid.values()];
  }

  private wordHits(match: string, filters: NormalizedFilters): RankedRow[] {
    const filter = nodeFilterSql(filters, { excludeHiddenChecks: true });
    const sql = `SELECT ${NODE_COLUMNS}, bm25(kb_words, 2.0, 1.0) AS score
       FROM kb_words
       JOIN nodes AS n ON n.nid = kb_words.rowid
      WHERE kb_words MATCH :match
        AND ${filter.sql}
      ORDER BY bm25(kb_words, 2.0, 1.0) ASC, n.id ASC
      LIMIT :fetch_limit`;
    try {
      return this.readAll(sql, {
        ...filter.params,
        match,
        fetch_limit: SEARCH_PAGE_MAX + 1,
      }).map((row) => readRanked(row, rowNumber(row, "score")));
    } catch (error) {
      if (isFtsSyntaxError(error)) return [];
      throw error;
    }
  }

  private identHits(needles: readonly string[], filters: NormalizedFilters): RankedRow[] {
    const filter = nodeFilterSql(filters, { excludeHiddenChecks: true });
    const clauses: string[] = [];
    const params: Record<string, SqlValue> = { ...filter.params, fetch_limit: SEARCH_PAGE_MAX + 1 };
    needles.forEach((needle, index) => {
      const key = `needle_${index}`;
      clauses.push(`k.id LIKE '%' || :${key} || '%' ESCAPE '\\'`);
      params[key] = escapeLike(needle);
    });
    if (clauses.length === 0) return [];
    const sql = `SELECT ${NODE_COLUMNS}
       FROM kb_ident AS k
       JOIN nodes AS n ON n.nid = k.rowid
      WHERE (${clauses.join(" OR ")})
        AND ${filter.sql}
      LIMIT :fetch_limit`;
    return this.readAll(sql, params).map((row) => {
      const id = rowString(row, "id");
      return readRanked(row, identScore(id, needles));
    });
  }

  private finishRankedPage(
    ranked: readonly RankedRow[],
    tokens: readonly string[],
    limit: number,
    applyTokenBudget: boolean,
  ): SearchResultPage {
    const capped = ranked.slice(0, limit);
    const items: SearchHit[] = [];
    let used = 0;
    let truncated = ranked.length > limit;
    for (const row of capped) {
      const hit = this.hitFromRow(row, tokens);
      const cost = estimateTokens(`${hit.title}\n${hit.snippet}`);
      if (applyTokenBudget && items.length > 0 && used + cost > this.tokenBudget) {
        truncated = true;
        break;
      }
      items.push(hit);
      used += cost;
    }
    return {
      items,
      nextCursor: null,
      hasMore: truncated,
      resultHash: this.canonical.computeResultSetHash(refsOf(items)),
    };
  }

  private hitFromRow(row: RankedRow, tokens: readonly string[]): SearchHit {
    return {
      nid: row.nid,
      id: row.id,
      kind: row.kind,
      version: row.version,
      title: row.title,
      status: row.status,
      feature: row.feature,
      basis: row.basis,
      snippet: buildSnippet(row.title, row.text, tokens, this.snippetChars),
      score: row.score,
    };
  }

  private readAll(sql: string, params: Record<string, SqlValue>): Record<string, unknown>[] {
    assertSelect(sql);
    return this.reader.prepare(sql).all(params);
  }

  private transaction<T>(work: () => T): T {
    let started = false;
    try {
      this.writer.exec("BEGIN IMMEDIATE");
      started = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/within a transaction/i.test(message)) throw error;
    }
    try {
      const value = work();
      if (started) this.writer.exec("COMMIT");
      return value;
    } catch (error) {
      if (started) this.rollback();
      throw error;
    }
  }

  private rollback(): void {
    try {
      this.writer.exec("ROLLBACK");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/no transaction is active/i.test(message)) throw error;
    }
  }
}

function compareHits(left: RankedRow, right: RankedRow): number {
  if (left.score < right.score) return -1;
  if (left.score > right.score) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function identScore(id: string, needles: readonly string[]): number {
  const folded = id.toLowerCase();
  let best = 0;
  for (const needle of needles) {
    const probe = needle.toLowerCase();
    if (folded === probe) return -1_000_000_000;
    if (folded.includes(probe)) best = -1_000_000;
  }
  return best;
}

function readRanked(row: Record<string, unknown>, score: number): RankedRow {
  return {
    nid: rowNumber(row, "nid"),
    id: rowString(row, "id"),
    kind: rowString(row, "kind"),
    version: rowNumber(row, "version"),
    title: rowString(row, "title"),
    text: rowString(row, "text"),
    status: rowString(row, "status"),
    feature: rowNullableString(row, "feature"),
    basis: rowNullableString(row, "basis"),
    score,
  };
}

function refsOf(items: readonly { id: string; version: number }[]): SearchResultRef[] {
  return items.map((item) => ({ id: item.id, version: item.version }));
}

function parseStoredQuery(text: string): SearchQuery {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("stored search query is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("stored search query is not an object");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.query !== "string") throw new Error("stored search query is missing query");
  const filters = record.filters;
  const query: SearchQuery = { query: record.query };
  if (filters === null || typeof filters !== "object" || Array.isArray(filters)) return query;
  const bag = filters as Record<string, unknown>;
  const kinds = stringList(bag.kinds);
  const basis = stringList(bag.basis);
  const tags = stringList(bag.tags);
  return {
    query: record.query,
    ...(kinds === undefined ? {} : { kinds }),
    ...(typeof bag.feature === "string" ? { feature: bag.feature } : {}),
    ...(typeof bag.status === "string" ? { status: bag.status } : {}),
    ...(basis === undefined ? {} : { basis }),
    ...(tags === undefined ? {} : { tags }),
    ...(typeof bag.limit === "number" ? { limit: bag.limit } : {}),
  };
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length === 0 ? undefined : items;
}

function assertSelect(sql: string): void {
  const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  if (!/^select\b/i.test(stripped) || READ_SQL_FORBIDDEN.test(stripped)) {
    throw new Error("KnowledgeSearchService read path only executes SELECT");
  }
}

function isFtsSyntaxError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fts5:/i.test(message);
}

function requireAttempt(attempt: string): string {
  if (typeof attempt !== "string" || attempt.length === 0) {
    throw new Error("search read requires an attempt id");
  }
  return attempt;
}

function requireRev(rev: number): number {
  if (!Number.isSafeInteger(rev) || rev < 0) throw new Error("search read rev must be a non-negative integer");
  return rev;
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) return fallback;
  return value;
}

function rowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`expected string column ${key}`);
  return value;
}

function rowNullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`expected string column ${key}`);
  return value;
}

function rowNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`column ${key} exceeds the safe integer range`);
    return Number(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`expected numeric column ${key}`);
}
