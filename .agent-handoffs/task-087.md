---
task_id: "Task-087"
branch: "task/087-hybrid-revision-impact-engine"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/revisions/**"
  - "packages/planner/tests/revisions/**"
  - ".agent-handoffs/task-087.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 087 handoff

Hybrid revision engine: 4-tier change classification, reverse `impact_walk`, Salsa-style early cutoff, re-verify-before-rework, debounced batch propagation, surgical `revision_in_flight` holds, zero-token impact preview, and persisted `revision_batches`. Commit stays on `task/087-hybrid-revision-impact-engine`.

## Exports Provided

Import from `packages/planner/src/revisions/index.ts`. The package barrel is intentionally unchanged.

- `ChangeClassifier` / `classifyChange` — deterministic `cosmetic` | `clarifying` | `compatible` | `breaking`. Breaking schema, cutoff, auth, and state-machine signals cannot be downgraded. A deleted contract field requested as `cosmetic` stays `breaking` (`floorApplied`).
- `ReverseImpactWalker` — `walkCombined` runs one prepared recursive walk: the canonical `impact_walk` shape plus a visited-path `UNION` guard and `belongs_to` / `consumes`. `executeCanonical` runs the exact `schema/queries.sql` text. The result lists `{ affectedDecisions, affectedRequirements, affectedContracts, affectedScreens, affectedActiveTasks, affectedMergedTasks, affectedChecks }`.
- `EarlyCutoffReverifier` — stops propagation at the first downstream node whose canonical fingerprint is unchanged. Task and check nodes reached from a changed node are passengers (re-verify / hold) and do not themselves cutoff.
- `ReverifyBeforeReworkGate` — pure check of merged code against updated linked checks. It never spawns work. `HybridRevisionEngine` inserts a `rework` row only when the gate returns `rework_required`.
- `DebouncedRevisionPropagator` — default debounce `1,500` ms (`DEFAULT_DEBOUNCE_MS`). `apply()` and `start()` flush immediately. One flush is one `revision_batch`, one contradiction check, and one combined `impact_walk`.
- `RevisionImpactPreviewer` — plain-English blast radius. `llmCalls` is `0`. Breaking estimate is one delta task per post-cutoff finished task at `MICRO_USD_PER_DELTA_TASK` (`175_000` micro-USD, so 2 tasks render `~$0.35`).
- `HybridRevisionEngine` — commits one batch inside `BEGIN IMMEDIATE` and writes `revision_batches`.
- `openRevisionDatabase` — in-memory (or file) SQLite fixture with the graph tables the walker needs, plus `task_holds`, `revision_batches`, and `revision_spawned_tasks`.
- Ports: `FiveLayerContradictionPort`, `PremiseSupersessionPort`, `TaskHoldsPort`, `KnowledgeGraphImpactPort`.
- Test doubles: `AcceptingContradictionEngine`, `ScriptedContradictionEngine`, `LocalPremiseSupersessionReopener`, `ManualScheduler`.

Persisted batch fields: `{ revisionId, triggerSource, changeClass, editedNodeIds, impactedNodeIds, earlyCutoffNodeIds, reverifiedPassedIds, reworkTaskIds }` plus `additiveTaskIds`, `holdTaskIds`, `conflictCard`, `preview`, `llmCalls`, and `createdAt`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/planner/src/index.ts` on this branch. Integration should add:

```ts
export {
  ChangeClassifier,
  DebouncedRevisionPropagator,
  EarlyCutoffReverifier,
  HybridRevisionEngine,
  RevisionImpactPreviewer,
  ReverseImpactWalker,
  ReverifyBeforeReworkGate,
  openRevisionDatabase,
} from "./revisions/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or `packages/planner/package.json` change. The implementation uses built-in `node:sqlite` and `node:crypto` only.

Wire `HybridRevisionEngine` with the sibling repositories below once their barrels are on `harness/integration`. Until then the engine opens its own connection and the local ports.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None for frozen root manifests. These vocabulary and schema additions are required for a later integration pass. This task does not edit `schema/` or package barrels.

1. `schema/state.sql` should gain `revision_batches` and `revision_spawned_tasks` (columns match `REVISION_SCHEMA_SQL` in `packages/planner/src/revisions/schema.ts`). `openRevisionDatabase` creates them on the connection it owns. `KnowledgeGraphRepo` should not be expected to have these tables until that migration lands.
2. Task 021 `HOLD_REASONS` is `user_pause | requirement_change | budget | ccr | governor`. This engine places `revision_in_flight`. Extend that vocabulary (or map the reason at the adapter) before `TaskHoldAndSubmissionRepo.placeHold` will accept it.
3. `node_kinds` has no `screen` row and `edge_types` has `consumes_contract` rather than `consumes`. The walker treats `kind = 'screen'` or `fields.role` / `fields.surface` = `'screen'` as a screen, and follows both `consumes` and `consumes_contract`. `belongs_to` stays `invalidates = 0` in the frozen seed; the cycle-safe walk follows it anyway because this task lists it.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-087-hybrid-revision-impact-engine`:

- `pnpm --filter @ef-harness/planner typecheck` — exit 0 (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/planner lint` — exit 0 (`eslint .`).
- `pnpm --filter @ef-harness/planner test -- revisions` — exit 0. Vitest 5.1.1: 6 files, 23 tests passed. Covers all four change classes, the cosmetic-request floor on a deleted API field, canonical `impact_walk` text against `schema/queries.sql`, a 500-node walk under 15 ms, cycle stability at depth 5 and 50, `belongs_to` / `consumes` beyond `invalidates = 1`, retired edges, the untouched auth worker, early cutoff at `C1` with 14 downstream `WORKING` tasks left running, re-verify pass (0 rework) and fail (one surgical rework carrying the check diff), 4 edits inside 1,500 ms coalesced into 1 batch with 1 contradiction check and 1 combined walk, 3 canvas edits inside 800 ms, immediate `apply` / `start` flush, contradiction pause with no rework and no node write, compatible additive task with an unrelated merged task left `DONE`, and the exact preview sentence `Touches 1 contract, pauses 1 active task ('Order form'), re-checks 2 finished tasks, leaves 9 other tasks untouched · Est. delta: +2 tasks, ~$0.35` at 0 LLM calls.
- `node scripts/verify-harmony.mjs --task 087` — exit 0, `harmony ok for Task-087` (schema 67/67, diagram check, workspace typecheck, lint, and test).

## Known Limitations / Follow-Ups

Sibling branches are not merged. These local ports must be swapped at integration. Do not import the unpublished packages as if they were already on `harness/integration`.

- **Task 017 `KnowledgeGraphRepo.impactWalk`:** `ReverseImpactWalker.walkCombined` prepares `CYCLE_SAFE_IMPACT_WALK_SQL` (canonical `impact_walk` plus a `seen` path guard and `belongs_to` / `consumes`). `executeCanonical` prepares the exact `impact_walk` block from `schema/queries.sql`. The canonical join does not follow `belongs_to` or `consumes` (`invalidates = 0`). After Task 017 is wired, call `KnowledgeGraphRepo.impactWalk` for the canonical half and keep the supplement for those two edge types. `openRevisionDatabase` is the fixture opener until `ProjectStateDb` is injected. Node writes in a non-conflict batch are a direct `UPDATE` of `text` and `fields`, not `commitChangeSet`.
- **Task 021 `TaskHoldAndSubmissionRepo`:** `GraphTaskHolds` inserts `task_holds(reason = 'revision_in_flight')` inside the batch transaction. Swap `placeHold` for the Task 021 repository once `revision_in_flight` is a legal reason. Active states are `WORKING` plus schema `LEASED` and `CODING`. Merged states are `DONE` plus `MERGED_TO_FEATURE` and `ACCEPTED`.
- **Task 071 `PremiseSupersessionReopener`:** `PremiseSupersessionPort.reopenDependents(premiseId, "revised")` is called for each breaking decision or requirement edit when propagation is not paused. `LocalPremiseSupersessionReopener` records the call and returns no ids. Inject the Task 071 reopener so derived decisions actually reopen.
- **Task 081 `FiveLayerContradictionEngine`:** `FiveLayerContradictionPort.checkCombinedState` runs once per batch. The default `AcceptingContradictionEngine` returns no contradictions. Inject the real engine. A non-empty `contradicts` result persists a `conflict_card`, skips node writes, holds, re-verify, additive tasks, and rework, and still records the batch.
- **Fingerprints:** `canonicalFingerprint` is SHA-256 over sorted-key JSON, not RFC 8785 JCS. Downstream nodes change only when `fields.proseReactive === true` (their next fingerprint mixes the upstream token). A contract with a stable `fields.canonical` and no `proseReactive` flag is the early-cutoff boundary. Point this at the Task 007 hasher if integration standardizes on JCS.
- **Depth:** default `impact_walk` depth is 64 (`DEFAULT_IMPACT_MAX_DEPTH`). The 500-node acceptance graph is a depth-1 star, so it finishes inside that cap and under 15 ms. Callers with a deeper chain must pass a larger `maxDepth`. The SQL `LIMIT 5001` still marks `partial` when the cap is hit.
- **Preview timing:** the `< 15 ms` budget is the walk plus in-memory classification (`json_each` over the impacted ids), not a model call. `RevisionImpactPreviewer` has no model port. The sentence is the post-cutoff blast radius, so nodes behind an unchanged fingerprint are counted as untouched.
- **Debounce clock:** production uses `setTimeout` via `systemScheduler`. Tests use `ManualScheduler`. The window resets on each `submit`.
- **Task 108 / 112 / 114 / 156** can construct `ChangeClassifier`, `ReverseImpactWalker`, `EarlyCutoffReverifier`, `DebouncedRevisionPropagator`, and `RevisionImpactPreviewer` from this folder. Auto-start thresholds should read `preview`, `changeClass`, `holdTaskIds`, and `conflictCard` from `RevisionBatchRecord`. A non-null `conflictCard` must not auto-start.
