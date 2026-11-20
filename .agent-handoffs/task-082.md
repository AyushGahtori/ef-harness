---
task_id: "Task-082"
branch: "task/082-research-engine-api-verifier"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/research-engine/src/**"
  - "packages/research-engine/tests/**"
  - ".agent-handoffs/task-082.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 082 handoff

Risk-triggered research topics, `feature-researcher@1` orchestration, token quote matching, installed `.d.ts` verification, and the 90-day research cache. Commit stays on `task/082-research-engine-api-verifier`.

## Exports Provided

Import from `packages/research-engine/src/public.ts` (the package barrel is outside this task's write scope):

- `RiskTriggeredTopicGenerator` — keeps only high-risk topics (major-version API changes, SaaS webhook/OAuth, Windows native bindings, DB/ORM quirks, security/compliance, cross-cutting risk tags, one stack-compatibility topic) and skips language basics. The 3% wave cap is `floor(waveTokenBudget * 3 / 100)`. Topics that do not fit are `deferred_to_installed_types`.
- `FeatureResearchOrchestrator` — fetches through an injected doc-fetcher port, quarantines the page, calls `feature-researcher@1` with `tools: []` and `toolAuthority: "none"`, quote-checks every claim, prefers installed `.d.ts` over stale web docs, and writes `research_fact` nodes with `basis: "observed"` plus `informs` edges. Unverified claims are not committed.
- `TokenBasedQuoteMatcher` — whitespace/punctuation-normalized token windows. Accepts alignment `>= 95%`. Rejects polarity keyword swaps (`required`/`optional`), flags, version numbers, and camelCase or dotted method names that are not in the source. Failures are flagged `unverified_quote`.
- `InstalledTypeApiVerifier` — `ts.createProgram` with `noEmit: true` (read-only). Confirms function name, signature, option keys, and `package.json` export path against the installed package. A disagreeing web claim is `version_mismatch` and the installed signature wins. Names not on `approvedPackages` are `unapproved_package`.
- `ResearchFactCache` — logical key `(canonical_topic_hash, library_name, major_minor_version)`, 90-day TTL (`RESEARCH_CACHE_TTL_MS`), SHA-256 of the sanitized excerpt, `cache_hit: true` and `tokens: 0` inside the window. Day 91 is expired, or `stale_offline_fallback` when the network is denied. A major or minor bump is a different key.
- `quarantineWebDoc` — strips comments, script/style, `display:none` / `visibility:hidden` / `aria-hidden` / `hidden`, CSS-hidden classes and ids, 1pt white-on-white text, `<instruction>`, and invisible Unicode, then wraps the remainder in `<data trust="untrusted" tools="none">`.

Also on `public.ts` for tests and wiring: `parseFeatureResearcherV1`, `MemoryGlobalResearchCache`, `MemoryKnowledgeGraph`, `researchTokenCap`, and the port types in `ports.ts`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/research-engine/src/index.ts` is a Task 001 package barrel. Re-export the public module from it when an integration task is allowed to edit the barrel:

```ts
export {
  FeatureResearchOrchestrator,
  InstalledTypeApiVerifier,
  MemoryGlobalResearchCache,
  MemoryKnowledgeGraph,
  ResearchFactCache,
  RiskTriggeredTopicGenerator,
  TokenBasedQuoteMatcher,
  parseFeatureResearcherV1,
  quarantineWebDoc,
  researchTokenCap,
  RESEARCH_CACHE_TTL_MS,
} from "./public.js";
export type {
  DocFetchOutcome,
  FeatureResearcherModel,
  FeatureResearcherPrompt,
  GlobalResearchCachePort,
  KnowledgeGraphPort,
  PublishedFact,
  ResearchFact,
  ResearchRunRequest,
  ResearchRunResult,
  SecureDocFetcherPort,
  TopicSignal,
} from "./public.js";
```

No root manifest, `packages/research-engine/package.json`, or `packages/shared-contracts/src/index.ts` edits.

Sibling packages are not on this branch. Construct `FeatureResearchOrchestrator` with these ports and swap them at integration:

- `SecureDocFetcherPort.fetchDocs` → Task 045 `SecureDocFetcher.fetchDocs` (the task text cites Task 047; the exporter is Task 045). The real fetcher throws. The adapter should return `{ ok: false, code: "fetch_failed", reason }` for HTTP 404, off-allowlist redirects, and unreachable hosts so planning does not crash. Pass `role: "researcher"`. Do not pass shell, write, or arbitrary URL tools.
- `GlobalResearchCachePort` → Task 014 `GlobalBrokerDb.putResearchCache`, `lookupResearchCache`, and `invalidateResearchCache`. `MemoryGlobalResearchCache` is the in-process stand-in. `readResearchCache` is a local extra so an expired row can be labeled `stale_offline_fallback` after Task 014's lookup has deleted it.
- `KnowledgeGraphPort.commitChangeSet` → Task 017 `KnowledgeGraphRepo.commitChangeSet` with `origin: "research"`, `kind: "research_fact"`, `fields.basis: "observed"`, and edges of type `informs`.
- `FeatureResearcherModel.complete` → the Mid model for `feature-researcher@1`. Validate the JSON with Task 009 `FeatureResearcherV1Schema` instead of `parseFeatureResearcherV1` once that schema is on the shared-contracts barrel. This orchestrator still forces an empty tool list.
- `LOCAL_RESEARCHER_DOC_HOSTS` / `urlAllowed` → Task 045 `RESEARCHER_DOC_DOMAIN_ALLOWLIST`. GitHub and `raw.githubusercontent.com` still require a 40-hex commit.

Physical `research_cache` row, because `schema/global.sql` cannot gain a topic-hash column here:

- `package` = library name
- `version_range` = `major.minor`
- `doc_url` = `ef-topic:<canonical_topic_hash>`
- `artifact_hash` = SHA-256 of the sanitized excerpt
- `expires_at` = `fetched_at + 90 days`

Fact JSON is held by `ResearchFactCache` next to that row. When Task 028 is wired, store the sanitized excerpt as a CAS blob pinned with `holder_kind = 'research'` and keep `artifact_hash` as that digest.

## Dependency Intents (New Packages Requested)

None. `typescript` is already a devDependency of `@ef-harness/research-engine` and is used only as `ts.createProgram` (`noEmit: true`, `noLib: true`). Zod is not added; the local parser mirrors Task 009 until the schema is exported from `@ef-harness/shared-contracts`.

## Contract Change Requests

- Add `('informs', 0)` to `edge_types` in `schema/state.sql`. Task 082 links each observed `research_fact` to its feature and decision nodes with `informs`. Those edges are not in the seeded type list (`documents` and `cites` are different relations). `KnowledgeGraphRepo` will reject the insert on the foreign key until the row exists. `MemoryKnowledgeGraph` accepts `informs` on this branch.
- Task 090 and this task cap research at 3% of the wave budget (`floor(budget * 3 / 100)` tokens or micro-USD). The economics table in `build-pipeline.md` still lists Research at 5%. This package follows the task spec (3%). Do not retune it to 5% without changing Task 090.

No other schema or root-manifest edits.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-082-research-engine-api-verifier` on `task/082-research-engine-api-verifier`.

- `pnpm --filter @ef-harness/research-engine test` — pass. Vitest 5.1.1: 6 files, 17 tests passed. Covers low-risk filtering and the 15-topic 3% cap, whitespace-normalized quotes, `required`→`optional`, flags, versions, method names, fixture `.d.ts` confirmation and stale web-doc override, 90-day cross-project hits for `zod@3.24` and `playwright@1.50`, day-91 expiry, minor/major bumps, hidden HTML/Unicode stripping, tool-less researcher prompts, `fetch_failed` for 404 and off-allowlist redirects, offline `research_unavailable`, and installed-type fallback.
- `pnpm --filter @ef-harness/research-engine typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/research-engine lint` — pass (`eslint .`, exit 0).
- `node scripts/verify-harmony.mjs --task 082` — pass (`harmony ok for Task-082`). Schema 67/67, diagram check, owned-path scope, and workspace typecheck, lint, and tests.

## Known Limitations / Follow-Ups

- `build-pipeline.md` also asks `entailment-checker@1` to confirm a quote supports its claim. That checker is Task 071 and is not on this branch. A fact becomes `observed` only after `TokenBasedQuoteMatcher` or `InstalledTypeApiVerifier` accepts it. Open `open_contradictions` block persistence.
- `ts.createProgram` uses `noLib: true` so fixture checks do not parse the full TypeScript lib. Signatures name the declared parameter type (`PaymentIntentCreateParams`) rather than expanding it. Option keys are the properties declared in the installed `.d.ts`.
- Task 009 marks `feature-researcher@1` tool access as `scoped`. Task 082 forbids shell, write, and arbitrary network tools, so the prompt is built with an empty tool list and `toolAuthority: "none"`.
- Task 014 `lookupResearchCache` returns null and deletes a row once `expires_at <= now`. The fact body stays in `ResearchFactCache` so a fully offline caller can still return `stale_offline_fallback` instead of inventing a signature.
- The local allowlist is a copy of the Task 045 researcher hosts. Hosts such as `docs.stripe.com` are refused until that list is extended or the caller passes `extraAllowHosts`. Tests use `nodejs.org` fixtures and never open a socket.
- `informs` is not in `schema/state.sql` yet. See the contract change request above.
