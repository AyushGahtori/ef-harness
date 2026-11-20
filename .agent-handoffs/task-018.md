---
task_id: "Task-018"
branch: "task/018-fts5-knowledge-search"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/search/**"
  - "packages/db/tests/search/**"
  - ".agent-handoffs/task-018.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 018 handoff

Dual FTS5 knowledge search (`kb_words` + `kb_ident`), safe query sanitizing, keyset pagination, and negative-read `search_reads`. Commit stays on `task/018-fts5-knowledge-search`.

## Exports Provided

Import path after wiring: `@ef-harness/db` barrel, from `packages/db/src/search/index.ts`.

Runtime values:

- `KnowledgeSearchService`
  - `searchNodes(query: SearchQuery): SearchResultPage`
  - `searchByIdSubstring(substring: string, filters?: Omit<SearchQuery, "query">): SearchResultPage`
  - `listNodesPaginated(query?: ListNodesQuery): SearchResultPage`
  - `recordSearchRead(input: RecordSearchReadInput): RecordSearchReadResult`
  - `verifyRecordedSearchReads(attempt: string): StaleSearchRead[]`
  - `optimizeSearchIndexes(): void`
  - `rebuildSearchIndexes(): void`
- `InvalidCursorError` (`code: "invalid_cursor"`)
- `SearchReadLimitReached` (`code: "search_read_limit_reached"`, `limit: 50`) returned as `notice`, not thrown
- `sanitizeFtsQuery(input: string): string`
- `asSqliteConnection(db: DatabaseSync): SqliteConnection` for `node:sqlite` until Task 012 is wired
- `SEARCH_PAGE_MAX` = `500`, `SEARCH_READ_CAP` = `50`, `DEFAULT_PAGE_LIMIT` = `50`, `DEFAULT_SNIPPET_CHARS` = `180`, `DEFAULT_TOKEN_BUDGET` = `1200`

Types: `SearchQuery`, `SearchResultPage`, `SearchHit`, `StaleSearchRead`, `ListNodesQuery`, `SearchFilters`, `RecordSearchReadInput`, `RecordSearchReadResult`, `SearchResultRef`, `SearchCanonical`, `KnowledgeSearchOptions`, `SqliteConnection`.

`SearchResultPage` is `{ items, nextCursor, hasMore, resultHash }`. List pages set `nextCursor` to an opaque base64url keyset `{ v: 1, nid }`. Ranked search sets `nextCursor` to `null` and uses `hasMore` when the limit or the token budget cuts the page. No method returns more than 500 rows. Requested `limit` is clamped to `[1, 500]`. Omitted `limit` defaults to 50.

`searchNodes` queries `kb_words` with `bm25(kb_words, 2.0, 1.0)` (title weighted above body; lower score is better) and, for identifier fragments (`C-01`, `C-014`, `SI-212`, `T07`), `kb_ident` with `id LIKE '%' || :needle || '%' ESCAPE '\'`. Hits are deduped by `nid`. Equal BM25 scores sort by `nodes.id ASC`. Exact id matches sort ahead of ordinary word scores.

`sanitizeFtsQuery` quotes letter/number tokens and joins them with `AND`. One- and two-character queries become a prefix (`"a"*`). Keywords (`OR`, `NOT`, `NEAR`), hyphens, colons, and unbalanced quotes never reach FTS5 as syntax. An empty sanitizer result does not call `MATCH`. Hyphenated ids are not passed to trigram `MATCH` (`C-01` is parsed as a column filter); substring search uses the bound `LIKE` above, including 1–2 character needles.

Filters: `kinds[]` (OR), `feature`, `status` (default `'active'`, inlined when it is `draft|active|retired|superseded` so `nodes_kind_feature` can apply), `basis[]` (OR), `tags[]` (every tag must appear in `fields.tags` or `fields.touches`). `searchNodes` and `searchByIdSubstring` also exclude sealed checks (`hidden_check`, `sealed_oracle`, `held_back`, or `visibility = "hidden"`). `listNodesPaginated` does not, so an admin list can still see them. `kb.search` must call `searchNodes`.

Snippets are built in process because contentless `kb_words` makes `snippet()` return null. Each snippet is at most 180 characters. Ranked search stops after about 1200 tokens (`ceil(chars / 4)`), always keeping at least one hit. Returned hits do not include `nodes.text`.

`recordSearchRead` inserts `{ attempt, query_hash, query, result_hash, rev }` inside `BEGIN IMMEDIATE`, including the canonical empty-set hash. `query` is canonical JSON `{ query, filters }` where filters are `{ basis, excludeHiddenChecks, feature, kinds, limit, status, tags }`. The same `query_hash` is stored once (the first `result_hash` wins) and does not consume another of the 50 slots. A 51st distinct hash returns `{ ok: false, notice: SearchReadLimitReached }`. `verifyRecordedSearchReads` re-runs each stored search and returns a `StaleSearchRead` when `currentResultHash !== recordedResultHash`.

`optimizeSearchIndexes` runs `INSERT INTO kb_words(kb_words) VALUES('optimize')` and the same for `kb_ident`. `rebuildSearchIndexes` cannot use `rebuild` on contentless `kb_words`; it deletes that index and repopulates it with `splitSearchText`, then `INSERT INTO kb_ident(kb_ident) VALUES('rebuild')`.

`searchNodes` and `listNodesPaginated` only `prepare` `SELECT` statements on `reader`. `recordSearchRead`, `optimizeSearchIndexes`, and `rebuildSearchIndexes` use `writer`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is frozen by Task 001. Add:

```ts
export {
  InvalidCursorError,
  KnowledgeSearchService,
  SEARCH_PAGE_MAX,
  SEARCH_READ_CAP,
  SearchReadLimitReached,
  asSqliteConnection,
} from "./search/index.js";
export type {
  KnowledgeSearchOptions,
  ListNodesQuery,
  RecordSearchReadInput,
  RecordSearchReadResult,
  SearchCanonical,
  SearchHit,
  SearchQuery,
  SearchResultPage,
  StaleSearchRead,
  SqliteConnection,
} from "./search/index.js";
```

Task 007's `SearchQuery` is the hash payload `{ query, filters }`. This task's `SearchQuery` is the service input (`query` plus optional `kinds`, `feature`, `status`, `basis`, `tags`, `limit`). Keep both names, and do not merge the types.

When the shared-contracts barrel exports Task 007, construct the service with:

```ts
canonical: { splitSearchText, computeSearchQueryHash, computeResultSetHash }
```

Until that wiring lands, the service uses a local RFC 8785 parity implementation of those three functions. `computeResultSetHash([])` is `sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.

Pass Task 012's reader and writer as `SqliteConnection` (`exec`, `prepare`, bare named parameters). `asSqliteConnection` is only the `node:sqlite` adapter for this branch.

## Dependency Intents (New Packages Requested)

None. `fast-check` is already a root devDependency and is imported from the search tests.

## Contract Change Requests

None. Schema tables `kb_words`, `kb_ident`, `nodes`, and `search_reads` are used as written in `schema/state.sql`.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-018-fts5-knowledge-search`:

- `pnpm --filter @ef-harness/db test -- search` — pass, 6 files, 16 tests. Covers `toPrintRows` / `print rows`, `C-01` substring via `kb_ident`, `cutoff_rule`, updated-node reindex, post-`VACUUM` nid stability and zero orphan FTS rows, 1,000 `fast-check` strings with no FTS5 syntax error, empty `search_reads` then a new match flagged stale, deduped repeat not burning the 50-read cap, and 1,200 nodes in three disjoint 500-row keyset pages. Also 5,000 requirements + 500 tasks searched and listed in under 200 ms.
- `pnpm --filter @ef-harness/db typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/db lint` — pass.
- `node scripts/verify-harmony.mjs --task 018` — pass (`harmony ok for Task-018`), including schema 67/67, diagram check, root typecheck, lint, and workspace tests.

## Known Limitations / Follow-Ups

- Task 007 and Task 012 are not on `harness/integration`. Hashing and the SQLite connection are ports with the signatures those tasks publish. Pass their real exports through `KnowledgeSearchOptions` at integration; do not keep the local hasher once the barrel export exists.
- Ranked search is a top-N page (`nextCursor` is null). Keyset cursors are for `listNodesPaginated` only.
- `listNodesPaginated` does not hide sealed checks. Pull-tool search must use `searchNodes` / `searchByIdSubstring`.
- Identifier search uses bound `LIKE` on external-content `kb_ident` rather than trigram `MATCH`, because a hyphenated `MATCH` string is an FTS column expression.
- `rebuild` is invalid on contentless `kb_words`; rebuild deletes and repopulates that table, then rebuilds `kb_ident`.
