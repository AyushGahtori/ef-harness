---
task_id: "Task-069"
branch: "task/069-discovery-core-opening-rubrics"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/discovery/src/core/**"
  - "packages/discovery/tests/core/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 069 handoff

Discovery session core, database persistence, `opening-rubric-map@1`, and offset-preserving long-turn chunking. Commit stays on `task/069-discovery-core-opening-rubrics`.

## Exports Provided

Import from `packages/discovery/src/core/index.ts` (the package barrel does not re-export these yet):

- `DiscoverySessionManager` — explicit-send session: five opening prompts, both presentation modes, one turn/rubric pipeline, drafts, scope revisions, release intent, delegations, batch cursor.
- `DiscoveryDbRepo` — atomic writes of `work_items`, `discovery_scopes`, `scope_criteria`, `discovery_batches`, decision `nodes`, `turns`, and `operations` through the knowledge-graph port.
- `OPENING_RUBRIC_MAP_V1` — version `opening-rubric-map@1`.
- `OpeningRubricMapper`, `validateOpeningRubricMap`, `defaultOpeningCatalog`.
- `chunkTurnWithOffsets`, `absoluteOffsets`, `LONG_TURN_CHUNK_MAX_CHARS` (4000), `LONG_TURN_CHUNK_OVERLAP_CHARS` (400).
- `classifyReleaseIntent`.
- `DeterministicOpeningReviewer` and `OpeningReviewer` (local stand-in for `opening-review@1`).
- `LocalSqliteKnowledgeGraph` and `KnowledgeGraphRepo` (local port).
- `SETTLED_BASES`, `CRITERION_STATUSES`, `isSettledBasis`, `isCriterionStatus` (local port).
- `FileDraftStore`, `MemoryDraftStore`.
- `InvalidRubricMapError`, `BasisStatusSeparationError`, `IdempotencyConflictError`, `DelegationBoundsError`, `UnknownQuestionError`.

`opening.1` → `product.purpose`, `delivery.platform`.
`opening.2` → `product.audience`, `actors.roles`.
`opening.3` → `workflows.primary`, `data.entities` (`partial`).
`opening.4` → acceptance examples on `workflows.primary`, `product.stage` (`inferred_confirmed`).
`opening.5` → `constraints.stack_preferences`, `deploy.target`, `constraints.deadline_budget`, plus delegations.

Startup calls `validateOpeningRubricMap`. A retired or unknown target throws `InvalidRubricMapError` before any interview write.

## Shared Wiring Needs (Root / Index Barrels)

`packages/discovery/src/index.ts` is frozen. When wiring is allowed, re-export the session surface:

```ts
export {
  DiscoverySessionManager,
  DiscoveryDbRepo,
  OPENING_RUBRIC_MAP_V1,
  OpeningRubricMapper,
  chunkTurnWithOffsets,
  absoluteOffsets,
  classifyReleaseIntent,
  type KnowledgeGraphRepo,
  type OpeningReviewer,
  type SendResult,
} from "./core/index.js";
```

No root `package.json`, workspace, tsconfig, or eslint change.

## Dependency Intents (New Packages Requested)

No new package. `@ef-harness/discovery` already depends on `@ef-harness/shared-contracts`. Sibling branches are not on this base, so these local ports stand in:

- **Task 010 vocabularies.** `packages/discovery/src/core/vocabularies.ts` copies `SETTLED_BASES` and `CRITERION_STATUSES`. Swap those imports to the shared-contracts barrel once `packages/shared-contracts/src/index.ts` exports `packages/shared-contracts/src/vocabularies/**`. Do not deep-import the sibling package.
- **Task 017 `KnowledgeGraphRepo`.** `KnowledgeGraphRepo` in `packages/discovery/src/core/knowledge-graph-port.ts` is the port `DiscoveryDbRepo` calls. `LocalSqliteKnowledgeGraph` implements it with `node:sqlite` and `schema/state.sql` because `packages/db/src/index.ts` does not export `KnowledgeGraphRepo`. Replace `LocalSqliteKnowledgeGraph` with the db-package repo when that barrel exports `commitChangeSet`, turn persistence, and a transaction that can also write `work_items`, `discovery_scopes`, `scope_criteria`, and `discovery_batches`. Those four tables are not in Task 017's published method list; keep them behind this port or extend the db repo in a later wiring change.
- **Task 007 content hash.** `localContentHash` is SHA-256 of canonical `{ kind, title, text, fields }`. Swap for `computeNodeContentHash` / NFC helper when that API is on a barrel this package can import.
- **Task 070 prompts.** `DeterministicOpeningReviewer` recognizes the documented opening examples and ignores presentation target so one pipeline can credit `opening.4` from text submitted on prompt 3. Inject Task 070's `DiscoveryPromptOrchestrator` as `OpeningReviewer`. `DiscoveryModelPort.onExplicitSend` runs only after an explicit send commits. It returns void, so model text cannot become evidence.

## Contract Change Requests

None. Schema files stay untouched. `turns` has no sequence or `op_id` column. This task stores:

- `turns.id` = `turn-0001` style ordinal (the sequence number)
- `turns.target` = focused prompt, question, or criterion at send time
- `turns.text` = the single immutable submitted string
- `operations.op_id` = client `op_id`
- `operations.request_hash` = canonical hash of `{ kind, workItemId, target, text }`
- `operations.result` = the committed send or delegation result

Same `op_id` with the same hash returns that result and does not insert another turn or call the model. Same `op_id` with a different hash throws `IdempotencyConflictError`.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-069-discovery-core-opening-rubrics`:

- `pnpm --filter @ef-harness/discovery typecheck` — pass (`tsc -b`, exit 0).
- `pnpm --filter @ef-harness/discovery lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/discovery test -- core` — pass, 17 tests, 1 file, exit 0. Covers the four discovery tables and batch-3 cursor resume at cursor 2, rubric-map success and `InvalidRubricMapError`, 25,000-character chunk offsets, draft/silence/laptop with zero turns and zero model calls, empty-answer zero credit, delegation zero credit until `sqlite` is chosen with `basis = delegated`, release-intent sentences, and the `+4 since your last message: you added email delivery` scope snapshot.
- `node scripts/verify-harmony.mjs --task 069` — pass (`harmony ok for Task-069`, exit 0). That command also re-ran repository typecheck, lint, and test.

## Known Limitations / Follow-Ups

- Pattern review covers the specified phrases (build, office manager, staff submit, soup count, existing web repo, free local database). It is not a general language model. Task 070 replaces it through `OpeningReviewer`.
- A delegated value is inside the recorded limits only when every limit token is a known tag of that value. The built-in tag table accepts `sqlite` for `free` + `local`. Other in-bounds engines need tags added beside that table when the catalog names them.
- Release feature names are a single token (`printing`, `export`). "Maybe add X" enters the current release with a `move_to_later` action. "Add X after launch" enters milestone `after launch`. A feature that is scrapped in the same submitted text is not written.
- Cross-chunk retraction before the first decision write, when the withdrawal is only implied across chunks rather than by these phrases, stays with Task 071. Chunks themselves are produced here and share one `turns.id`.
- `product.stage` from `opening.4` stays `open` with `needs_confirmation` and earns no value credit. `data.entities` from `opening.3` is stored as `partial` with no basis.
- Must-ask "Decide for me" on `product.purpose`, `product.audience`, `workflows.primary`, and opening prompts 1–4 returns 1–2 anchor questions and does not write a value. "I don't know" returns recommendations and does not write a delegation.
- No `discovery.scope_ready` outbox event. That transition belongs to Task 074 and Task 026.
- Question-card options are frozen in the session from `beginInput` until explicit send. The open `discovery_batches.questions` array stays the ordered decision ids from schema.
