---
task_id: "Task-081"
branch: "task/081-five-layer-contradiction-checker"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/spec-expansion/src/contradictions/**"
  - "packages/spec-expansion/tests/contradictions/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 081 handoff

Five-layer contradiction checker: catalog rules, minimal UNSAT core, cross-matrix invariants, integer interval checks, and grounded semantic pairs. Confirmed conflicts are `contradicts` edges plus `conflict` inbox items. Any current `contradicts` edge blocks readiness and graph compilation. Commit stays on `task/081-five-layer-contradiction-checker`.

## Exports Provided

Import from `packages/spec-expansion/src/contradictions/index.ts` (the package barrel is intentionally unchanged):

- `FiveLayerContradictionEngine` — `check()` runs layers 1–4 with zero model calls, then layer 5. `recheck(nodeId)` reruns layers 1–4 on the impacted scope and layer 5 only on pairs that touch the edited node. Resolved conflicts retire their `contradicts` edges and mark the inbox item `answered`. `blocksReadiness()` and `blocksGraphCompilation()` are true while any current `contradicts` edge exists.
- `Z3UnsatCoreSolver` — boolean / enum (exactly-one) clauses, deterministic `seed`, minimal `unsatCore`, hard cap `Z3_SOLVE_TIMEOUT_MS` (2000). A longer requested timeout is clamped. Timeout or a thrown solver error returns `status: "incomplete_timeout"` with an empty core. The engine then logs `z3_incomplete_timeout`, keeps layers 1, 3, 4, and 5, and does not drop a previous layer-2 core that this run could not re-prove.
- `CrossMatrixInvariantChecker` — visits all 12 matrix ids (`M01`–`M12`). Checks allowed M01 actions against M04 routes and M02 lifecycle handlers, M03 screen actions against M01, non-terminal M06 states for a path to a terminal state, M10 retention against M02 hard-delete / immutable-audit, and M08 triggers against M06 transitions.
- `IntervalConflictDetector` — normalizes to integer bytes, milliseconds, minutes-of-day, minor currency, and row counts before intersection. `5120 KB` equals `5 MiB` (1024-based KB/KiB). Decimal `MB`/`GB` stay powers of 1000, so `5 MB` is not `5 MiB`. Clock ordering catches `10:45` before `11:00` and prep-before-cutoff when the text says `no edits after prep`. Prose `session_ttl = 7d` versus `auto-logout after 15 min inactivity` conflicts because the two bounds were not given structured qualifiers. Structured `qualifier: "idle"` versus `qualifier: "absolute"` on the same key does not conflict.
- `SemanticPairConflictSweeper` — pairs requirements that share an entity or a `touches` tag (not the full Cartesian product), at most `MAX_SEMANTIC_PAIRS_PER_CALL` (30) per `contradiction-check@1` call. A `conflict` verdict is kept only when `cited_node_ids` are exactly that pair and `counterexample` is concrete. `compatible`, `unclear`, blocked exits, extra keys, vague `"tension"`, and wrong ids are dropped.
- `CatalogRuleChecker` — direct `conflicts_with` and unsatisfied `requires`, citing the two decision ids and the catalog rule id.
- `InMemoryContradictionStore` — test double for the graph and inbox ports. Not the production database.

Helpers: `assertionClause`, `implicationClause`, `conflictClause`, `nandClause`, `exactlyOneClauses`, `parseContradictionCheckV1`, `CONTRADICTION_EDGE_TYPE` (`"contradicts"`).

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/spec-expansion/src/index.ts` on this branch. Integration should add:

```ts
export {
  CatalogRuleChecker,
  CrossMatrixInvariantChecker,
  FiveLayerContradictionEngine,
  InMemoryContradictionStore,
  IntervalConflictDetector,
  SemanticPairConflictSweeper,
  Z3UnsatCoreSolver,
} from "./contradictions/index.js";
export type {
  ArchitecturalConstraint,
  CatalogRuleEntry,
  CatalogRuleSource,
  ConflictDraft,
  ConflictInboxPort,
  ContradictionCheckModel,
  ContradictionReport,
  FiveLayerContradictionEngineOptions,
  IntervalSource,
  KnowledgeGraphPort,
  MaterializedRequirement,
  MatrixCellPersistenceRepo,
  MatrixCellRecord,
  OrderedCellFillerPipeline,
  SemanticPair,
  Z3Problem,
  Z3SolveResult,
} from "./contradictions/index.js";
```

No root `package.json`, workspace, tsconfig, or eslint change.

Task 074 and Task 092 should treat `FiveLayerContradictionEngine.blocksReadiness()` / `blocksGraphCompilation()` (or any current `edges.type = "contradicts"`) as a hard stop. Task 087 should call `recheck(editedNodeId)` after a decision or requirement edit.

## Dependency Intents (New Packages Requested)

Add `z3-solver` to `dependencies` of `packages/spec-expansion/package.json` when the integrator wants the official Z3 WASM build. That file is frozen by Task 001, so this branch does not declare it and does not vendor the WASM binary. `Z3UnsatCoreSolver` is the in-process port: same `solve` / `unsatCore` / `seed` / `incomplete_timeout` contract, fully offline in Vitest, with the 2,000 ms cap enforced by a deadline checked before and during search. After `z3-solver` is declared, keep this class's result shape and thread Z3's timeout parameter through it. Do not let a WASM solve run longer than 2,000 ms.

No other package is required. The `contradiction-check@1` parser does not import `zod`.

## Contract Change Requests

1. `schema/state.sql` `edge_types` has no `contradicts` row, and Task 010's `EDGE_TYPES` list matches that seed. This checker writes `edges(type = 'contradicts')`. Add `('contradicts', 1)` (a change should invalidate dependents) and include it in the Task 010 vocabulary. Until that lands, `KnowledgeGraphRepo.commitChangeSet` will reject the edge on the foreign key. The in-memory port accepts it.
2. Task 009 `ContradictionCheckV1Schema` is a strict object `{ verdict, explanation, minimal_change_suggestion }` or a blocked exit. Layer 5 also requires `cited_node_ids` and `counterexample` before a conflict is stored. Extend the success schema with those two fields, required when `verdict` is `conflict`, and point `parseContradictionCheckV1` at the Zod schema. Extra keys stay rejected.
3. No other schema, root manifest, or shared-contract edit.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-081-five-layer-contradiction-checker`:

- `pnpm --filter @ef-harness/spec-expansion typecheck` — exit 0 (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/spec-expansion lint` — exit 0 (`eslint .`).
- `pnpm --filter @ef-harness/spec-expansion test -- contradictions` — exit 0. Vitest 5.1.1: 6 files, 26 tests passed. Covers layer 1 direct `conflicts_with` and unsatisfied `requires` (2,000 decisions under 5 ms), layer 2 indirect `{A,B,C}` core, the same core inside 100 constraints, the anonymous / private-billing / no-accounts core, role exactly-one and permission implications, the 2,000 ms `incomplete_timeout` path, stable seeded models, all 12 matrices plus the M03 `Delete Account` versus M01 `user:delete_account` forbid, M01 missing M04/M02, M06 trap, M10 versus immutable audit, M08 unknown trigger, `10:45` versus `11:00`, prep `10:30` versus cutoff `11:00`, `5 MB` versus `25 MB`, `5120 KB === 5 MiB`, decimal `5 MB` / `10 MB` conflicts, prose session TTL versus 15 min inactivity, structured idle versus absolute, currency and row counts, 400-requirement bucketing (3,800 pairs, not 79,800; batches of at most 30), ungrounded rejection, and engine persistence: superseding a decision clears its `contradicts` edge, an unrelated edge stays, and a solver timeout keeps layers 1, 3, 4, and 5 plus the previous layer-2 core.
- `node scripts/verify-harmony.mjs --task 081` — exit 0, printed `harmony ok for Task-081`. That command also ran repo `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

Sibling branches are not merged. These local ports must be swapped at integration. Do not import unpublished packages as if they were already on `harness/integration`.

- **Task 009 `ContradictionCheckV1Schema`:** `parseContradictionCheckV1` accepts the strict success object, the blocked exit, and the two grounding fields above. Replace it with the Zod schema once those fields are added. Until then a real model response that only matches today's strict schema cannot carry citations, and Layer 5 will reject it.
- **Task 017 `KnowledgeGraphRepo`:** `KnowledgeGraphPort` uses `currentRevision`, `getNode`, `listNodes`, `getEdgesAsOf(rev)`, and `commitChangeSet`. `listNodes` stands in for paging `getSnapshotAsOf`. `getEdgesAsOf` returns the full as-of set; the repo method is keyset-paged. `InMemoryContradictionStore` is the test double. Its content hash is SHA-256 of a stable JSON tuple, not Task 007 JCS. Inject `KnowledgeGraphRepo` only after `contradicts` is a legal edge type.
- **Task 075 catalog:** `CatalogRuleSource.listRules()` returns `{ id, optionId, groupId, conflictsWith, requires: [{ optionId, groupId }] }`. Map that from the question-pack `conflicts_with` / `requires` lists. This branch does not load `corpus/`.
- **Task 079 `MatrixCellPersistenceRepo`:** `listCells()` returns `MatrixCellRecord` rows for `M01`–`M12` (`actionId`, `allowed`, `routeOrCommand`, `lifecycleHandler`, `screenActionId`, `fromState`, `toState`, `stateId`, `terminal`, `entityId`, `immutableAudit`, `hardDelete`, `retentionAction`, `notificationTrigger`). Open and `not_applicable` cells are ignored.
- **Task 080 `OrderedCellFillerPipeline`:** `listMaterializedRequirements()` returns requirement id, text, EARS text, entities, touches, feature, pass, basis, status, optional quote, cell id, `sourceDecisionIds`, and structured claims. Layer 5 buckets on entities and touches. Superseded and retired rows are skipped.
- **Inbox:** `ConflictInboxPort` maps to `inbox_items` (`kind = 'conflict'`, `status` `open` | `answered`). Payload is `{ layer, minimalCoreNodeIds, plainEnglishConflict, concreteCounterexample, resolutionOptions, ruleId }`. `ruleId` is extra correlation beyond the required five fields. Resolving a conflict sets `answered`.
- **Edges:** one current `contradicts` edge per unordered pair in a core (a 3-node core is a triangle). An edge is retired only when no open conflict still cites that pair. Synthetic endpoints such as `missing:M04:<action>` are used when the counterpart cell does not exist; the real repo cannot store those until a node id exists, so integration should persist the missing-cell finding on the inbox item and only write edges between real node ids.
- **Layer 2 encoding:** callers pass `ArchitecturalConstraint` values (`assert`, `implies`, `conflicts`, `exactly_one`, `nand`) on `check({ constraints })` or on `fields.constraints` of an active node. The indirect core `{A,B,C}` is `A` true, `A → B`, `B → C`, `C` false. The three-title example is a `nand` of the three asserted decisions. Catalog `conflicts_with` stays on layer 1 so a direct pair is not also reported as a solver core.
- **Session TTL:** prose idle versus absolute is a conflict. Only structured qualifiers that differ suppress it. That matches the spec example that names both sentences without a structured distinction.
- **Clock compare** uses minutes-of-day. `America/New_York` and `local` are recorded on the source text and are not converted across zones.
- **Solver search** is an in-process DPLL with deletion-minimal cores. It is deterministic for a seed. It is not the Z3 WASM binary. Pathological graphs return `incomplete_timeout` when the deadline is crossed; they are not left running until the cap as a wall-clock sleep.
- **Task 074 / 083 / 087 / 092** can construct `FiveLayerContradictionEngine` with the ports above. `InMemoryContradictionStore` is for tests and for wiring before Task 017 is integrated.
