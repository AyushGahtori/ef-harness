---
task_id: "Task-045"
branch: "task/045-secure-doc-fetcher"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/sandbox/src/doc-fetcher/**"
  - "packages/sandbox/tests/doc-fetcher/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 045 handoff

Secure doc fetcher for `harness.fetch_docs`: local package source first, allowlisted fetches, hidden-content sanitizer, page version detector, and a 90-day research cache. Commit stays on `task/045-secure-doc-fetcher`.

## Exports Provided

Import from `packages/sandbox/src/doc-fetcher/index.ts` (the package barrel is outside this task's write scope):

- `SecureDocFetcher` with `fetchDocs`, `readLocalPackageSource`, `detectPageVersion`, `sanitizeHtmlToQuotedMarkdown`, and `invalidateForLockfileUpdate`
- `DocFetchResult`
- `DOC_DOMAIN_ALLOWLIST` (coding workers: official docs, npm/PyPI metadata, GitHub only at a 40-hex commit)
- `RESEARCHER_DOC_DOMAIN_ALLOWLIST` (that list plus broader technical documentation hosts)
- `sanitizeHtmlToQuotedMarkdown`
- `detectPageVersion`
- `readLocalPackageSource`
- `DirectResearcherAllowlistProxy` (`AllowlistProxyServer`, researcher profile, GET/HEAD only, pinned-address SSRF check)
- `PlaywrightDocRenderer` and `HeadlessDocRenderer`
- `SqliteResearchCacheStore`, `MemoryResearchCacheStore`, `MemoryCasBlobStore`
- `DomainNotAllowlistedError`, `SsrfBlockedError`, `DownloadTooLargeError`, `PathTraversalError`, `RedirectLimitError`, `DocMethodNotAllowedError`

`Task 048` (`harness.fetch_docs`), `Task 082` (research engine), and `Task 193` (red team) should consume `SecureDocFetcher`, `DocFetchResult`, `DOC_DOMAIN_ALLOWLIST`, and `sanitizeHtmlToQuotedMarkdown`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/sandbox/src/index.ts` is outside the owned subtree. Re-export the symbols above from that barrel when a later integration task is allowed to edit it.

`SecureDocFetcher` cannot import `@ef-harness/db` (same layer). Inject these ports at integration time:

- `ResearchCacheStore` to `GlobalBrokerDb.research_cache` (`putResearchCache`, `lookupResearchCache`, `invalidateResearchCache`) and `cas_pins` rows with `holder_kind = 'research'`
- `CasBlobStore` to Task 028 `CasBlobStore.putBlob` / `getBlob` for the cleaned Markdown bytes
- `AllowlistProxyServer` to Task 044, profile `researcher` (GET/HEAD only). The fetcher still applies the narrower worker list before the call. The proxy researcher profile must allow `RESEARCHER_DOC_DOMAIN_ALLOWLIST`, or broader technical-doc hosts will be refused by the proxy.

No root manifest or `packages/shared-contracts/src/index.ts` edits.

## Dependency Intents (New Packages Requested)

Optional `playwright` for `PlaywrightDocRenderer` when the caller does not inject a `HeadlessDocRenderer`. It is not added to `packages/sandbox/package.json` because that manifest is outside the owned subtree, and tests must not download a browser. Unit tests inject a renderer. The optional Chromium test skips when `playwright` is not installed.

## Contract Change Requests

None. `schema/global.sql` `research_cache` and `cas_pins` are used as they stand. Cleaned Markdown bytes are the CAS blob. `research_cache.artifact_hash` is the SHA-256 of those bytes. Pin `holder_id` is `research:<package>:<major.minor>:<sha256(doc_url) prefix>`.

## Exact Verification Commands & Results

- `pnpm --filter @ef-harness/sandbox test -- doc-fetcher` — 24 passed, 1 skipped (7 files). The skip is the optional Playwright Chromium render because `playwright` is not installed. Covered: HTML-to-Markdown tables and fenced code, hidden DOM/CSS/Unicode-tag stripping, `</data>` and `<instruction>` escaping, SPA empty-shell JS-render fallback, `detectPageVersion` for URL / switcher / meta / heading, 90-day cache hit, exact expiry, minor-version lockfile invalidation and `cas_pins` cleanup, local `.d.ts` / exports / README with zero sockets, and path-traversal rejection.
- `pnpm --filter @ef-harness/sandbox typecheck` — passed.
- `pnpm --filter @ef-harness/sandbox lint` — passed.
- `node scripts/verify-harmony.mjs --task 045` — passed (`harmony ok for Task-045`).

## Known Limitations / Follow-Ups

- Same-layer imports are forbidden, so this branch does not call Task 014 `GlobalBrokerDb`, Task 028 `CasBlobStore`, or Task 044 `AllowlistProxyServer` directly. `SqliteResearchCacheStore` speaks the canonical `research_cache` and `cas_pins` SQL. `DirectResearcherAllowlistProxy` is the stand-in transport until those packages are wired. `MemoryCasBlobStore` holds bytes in process; durable bytes belong to Task 028.
- Cache hits set `finalUrl` to the requested `doc_url`, `truncated` to false, and `originalChars` to the stored Markdown length. The fixed schema has no columns for the redirect target or the pre-truncation length. The stored blob is the cleaned Markdown returned to the model.
- `testOnlyLoopbackOverride` allows a non-IP allowlisted hostname to resolve to `127.0.0.0/8` or `::1` for fixture servers. Construction throws when `NODE_ENV` is `production`. Metadata, RFC1918, link-local, and ambiguous IP literals stay blocked.
- Coding workers use `DOC_DOMAIN_ALLOWLIST` plus local package source. `feature-researcher@1` may also use `RESEARCHER_DOC_DOMAIN_ALLOWLIST`. Both roles are read-only GET/HEAD. GitHub and `raw.githubusercontent.com` require a 40-hex commit.
- JS rendering uses an injected `HeadlessDocRenderer`, or Playwright when that package and browser are installed. Tests did not download a browser.
