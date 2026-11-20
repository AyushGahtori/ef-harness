---
task_id: "Task-089"
branch: "task/089-rule-matching-pull-to-push"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/rule-matching/**"
  - "packages/planner/tests/rule-matching/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 089 handoff

Cross-cutting rule scope matcher, `kb.*` pull tools, pull analytics, and the pull-to-push compiler feedback loop. Commit stays on `task/089-rule-matching-pull-to-push`.

## Exports Provided

Import from `packages/planner/src/rule-matching/index.ts` (the package barrel is frozen):

- `CrossCuttingRuleMatcher` — `match({ taskTouches, inheritedEntityTags, screenEndpointTags })` and `matchTags(tags)`. Match when `rule.global === true` OR (`any` is absent or intersects AND `all` is absent or is a subset). Provenance is `global`, `direct_tag` (task touches plus screen/endpoint tags), or `entity_inheritance`. Catalog is `corpusCrossCuttingRules()` (`X-01`–`X-14`, `UP-01`–`UP-08`). `scopeMatches` is the same boolean.
- `KbPullToolHandlers` — read-only `kb.search`, `kb.get_node`, `kb.get_contract`, `kb.list_rules_for_tags`. `register(server)` and `call(name, args, ctx)`. `definitions()` are all `readOnly: true`. Limit is clamped to `[1, 10]`. Responses are `{ trust: "kb", label: "data" }`.
- `PullReadAnalyticsRecorder` — `record(draft)` writes telemetry and, for searches, `search_reads`. Telemetry failure appends `TELEMETRY_DROPPED` and does not throw. `pulls`, `anomalies`, `warnings`.
- `PullToPushFeedbackAnalyzer` — `analyze(input)`, `apply(recommendations, hook)`, `run(input, hook)`. Thresholds: `>= 3` distinct tasks sharing a tag, or `>= 40%` of a wave (`pullers * 5 >= members * 2`). Late verification failure (`pulledLate`) targets `MUST` only when every receiving task stays within Junior `3,000` / Senior `6,000`; otherwise `SHOULD` with `capped: true`. Repeated pulls target `SHOULD`. `effectiveWave` is the evidence wave plus one.
- Also exported for the same subtree: `NegativeSearchGapDetector`, `PushNoiseDemotionMetric`, `PullTurnBudget` (`25` calls and `24 * 1024` bytes per attempt turn), `InMemoryFtsSearchRepo`, `InMemorySearchReadStore`, `InMemoryTelemetryStore`, `UnavailableTelemetryStore`, `LocalLeasedMcpServer`, `LocalKnowledgePacketSlicer`, `LocalSlicerPromotionStore`, `planPulls`.

`NOT_FOUND` for a sealed oracle (`hidden`, kind `hidden_check` / `sealed_oracle`, or visibility `hidden_check` / `held_back` / `sealed`) is the same object as a missing id. The anomaly is only on the recorder (`security_anomaly`), never in the tool body. `PULL_BUDGET_EXCEEDED` message: `Pull quota reached; proceed with current context or escalate via harness.ask_owner if key context is missing`. Gap message: `Undocumented convention searched ${n}×: '${query}'` for `>= 3` distinct attempts with `hit_count = 0`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/planner/src/index.ts` on this branch. When integration is allowed, re-export the four names above from that barrel:

```ts
export {
  CrossCuttingRuleMatcher,
  KbPullToolHandlers,
  PullReadAnalyticsRecorder,
  PullToPushFeedbackAnalyzer,
} from "./rule-matching/index.js";
```

Sibling branches are not in this base. Swap the local ports for the real owners:

- Task 018 `KnowledgeSearchService` (`searchNodes`, `recordSearchRead`) replaces `FtsSearchRepo` / `InMemoryFtsSearchRepo`. Keep title weight `2.0`, body weight `1.0`, and ident substring (`C-01` finds `C-014`). The task text calls this `FtsSearchRepo`.
- Task 048 `AttemptMcpServer` is the lease host. The task text says `LeasedMcpServer` (Task 049); Task 049 in the spec is the test-environment orchestrator and does not own MCP. Register `KbPullToolHandlers.definitions()` on `AttemptMcpServer` and keep the epoch fence.
- Task 077 `EntityTagInheritor.inherit(snapshot)` replaces `inheritedTagsForTask`. This port maps entity tag `pii` to corpus tag `personal_data` before matching. Screen and endpoint tags are passed as `screenEndpointTags` and count as `direct_tag`.
- Task 088 `KnowledgePacketSlicer` plus `BandTokenBudgeter` / `OversizedMustAutoSplitGuard` replace `LocalKnowledgePacketSlicer` and `LocalSlicerPromotionStore`. Call `PullToPushFeedbackAnalyzer.run(input, slicer)` so `upsertBand` lands in the project slicer. Ceilings used here are Junior MUST `3,000` (hard `3,200`) and Senior MUST `6,000` (hard `6,400`). Promotions never add a fact that would pass the target ceiling; the slicer also moves an overflowing MUST promotion to SHOULD.

`planPulls(brief, desiredNodeIds)` is the Wave 2 behavior: a fact already in MUST or SHOULD is not pulled. Redundant issued pulls stay `0`.

## Dependency Intents (New Packages Requested)

None. No package.json changes.

## Contract Change Requests

None for frozen schema files. Local `SearchReadRow` stores the canonical `search_reads` columns (`attempt`, `query_hash`, `query`, `result_hash`, `rev`) plus `hitCount` and `securityProbe`, because `schema/state.sql` has no `hit_count` column and Task 089 mines `search_reads(hit_count = 0)`. Empty results use `sha256("[]")`. When Task 018 lands, keep `hit_count = 0` queryable (column or equivalent empty-set hash) so `NegativeSearchGapDetector` can keep the same filter. Security probes are persisted and excluded from gap findings so sealed-oracle searches are not proposed as new spec items.

Telemetry rows match `telemetry.db.telemetry` (`attempt`, `ts`, `kind`, `data`). `data` includes `attemptId`, `taskId`, `taskTags`, `toolName`, `queriedNodeId`, `wasInCouldIndex`, `wasNegativeMiss`, `latencyMs`.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-089-rule-matching-pull-to-push`:

- `pnpm --filter @ef-harness/planner typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/planner lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/planner test -- rule-matching` — pass (vitest 5.1.1, 3 files, 24 tests, exit 0).
- `node scripts/verify-harmony.mjs --task 089` — pass (`harmony ok for Task-089`, exit 0). This also runs repo `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- `InMemoryFtsSearchRepo` is a deterministic stand-in for SQLite FTS5 `kb_words` + `kb_ident` (BM25 title 2 / body 1, ident substring, hidden nodes omitted before ranking). It does not open `state.db`.
- Pull ceilings are per `(attemptId, turnId)`, matching the per-turn invariant. A new turn gets a fresh 25-call / 24 KB budget.
- Repeated pulls promote to SHOULD. MUST is only the late-verification path, and only when Junior 3,000 / Senior 6,000 still fit. Wave 1 evidence applies at `effectiveWave` (Wave 2), not back into Wave 1.
- `UP-01`–`UP-08` scopes are the closed tags implied by their corpus cells (screens → `interactive_ui` / `route`, forms → `form_input`, and so on). They are not `global`.
- Gap detection counts distinct attempts after lowercasing and collapsing whitespace. One attempt searching the same query twice does not count twice (`search_reads` primary key is attempt + query hash).
- Push-noise diagnostics are in memory for Meta-Lab (Task 191). They are not written to `state.db`.
- Outgoing contract links whose target is a sealed oracle are dropped from `kb.get_node` so a visible node cannot point at a hidden id.
