---
task_id: "Task-079"
branch: "task/079-spec-matrix-generators"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/spec-expansion/src/generators/**"
  - "packages/spec-expansion/tests/generators/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 079 handoff

Deterministic generators for all 12 spec-expansion matrices, lossless scoped-rule collapse, and `state.db` persistence. No LLM calls. Commit stays on `task/079-spec-matrix-generators`.

## Exports Provided

Import from `packages/spec-expansion/src/generators/index.ts` until the package barrel is wired.

- `MatrixGeneratorRegistry` — `generate(graph)` returns a `GenerationRun` (`llmCalls` is always `0`, `applicability` for `M01`–`M12`, `rawCells`, `domains`).
- `ScopedRuleCollapser` — `collapse(run)` returns `{ rules, exceptions }`; `expand(collapsed, rawCells)` rebuilds every raw pair signature. Exception cells override the universal rule for the same scope.
- `MatrixCellPersistenceRepo` — `openMemory()`, `persist(graph, run, collapsed)`, `markFilled(cellId, fill, graph)`, `readRecord(id)`, `expandEdges(src)`.
- Matrix catalog: `MATRIX_IDS`, `MATRIX_CATALOG`, `MatrixId`, `RawMatrixCell`, `GenerationRun`, `ApplicabilityDecision`, `SettledProjectGraph`, `AxisNode`.
- Closed axis vocabularies: `M01_ACTIONS`, `M02_OPS`, `M03_UI_STATES`, `M03_PRINT_STATE`, `M04_STATUSES` (`200/201` plus `400`,`401`,`403`,`404`,`409`,`422`,`429`,`500`), `M05_CHECKS`, `M07_FAILURES`, `M08_AXES`, `M09_RACES`, `M09_FILE_LOCK`, `M10_AXES`, `M11_AXES`, `M12_AXES`.
- Cell identity: `cellKey(matrixId, axisA, axisB)` is `cell:<matrixId>:<axisA>:<axisB>`. `cellIdentityJcs` / `jcs` are the RFC 8785 payload. Axis tokens are NFC and must not contain `:`.
- Reference graphs: `kitchenMealOrderingGraph`, `backendApiGraph`, `headlessCliGraph`, `stressGraph`, plus `addAxisNode`, `renameAxisNode`, `kitchenManagerRole`, `withProposedRole`.

Cell rows bind to settled `nodeId`s, never display titles. `M01` also emits the role × entity × endpoint permission product (`ep/<entity>/<endpoint>`) that becomes the 8 × 25 × 60 = 12,000 raw cells on the stress graph. Structural outcomes are skeletons (`allow`, `deny_unauthenticated`, `return_401`, `409_INVALID_TRANSITION`, `not_applicable`, …). Fill text is not invented here.

`not_applicable` reasons used by later tasks include `anonymous_cannot_edit_own_profile`, `immutable_audit_no_update`, `immutable_audit_no_mutation`, `unauthenticated_private_is_401_not_<status>`, `authenticated_is_not_401`, `public_endpoint_not_401`, `terminal_no_outgoing`, `audit_not_user_deletable`, `no_cross_field_rule`, `no_cutoff`, `no_stock_quota`.

Skipped applicability reasons: `single_user_no_role_matrix`, `no_roles`, `no_entities`, `headless_no_ui`, `no_screens`, `no_endpoints`, `no_form_fields`, `no_state_machines`, `no_external_integrations`, `no_notifications`, `no_shared_resources`, `no_retention_scope`, `headless_no_viewport`, `no_persistence`. `M09` on a single-user CLI is active with `narrowed: "single_process_file_lock"`.

Universal rule text pinned for downstream checkers:

- `ALL unauthenticated requests to /api/private/* return 401`
- `ALL invalid state transitions return 409 INVALID_TRANSITION`
- `No outgoing transitions permitted from terminal states {delivered, cancelled}` when those two terminal titles are the whole terminal set.

Persistence writes `rule` nodes (`record_type` `matrix_group` | `universal_rule` | `matrix_manifest`) and `spec_item` nodes (`record_type` `matrix_cell`). Origin axes are stored as `decision` nodes (`fields.axis_kind`) or `feature` nodes. Traceability edges use type `expands` (see contract request). Regeneration inserts only new cell ids and does not update an existing cell row, so a `markFilled` payload survives. The manifest id is `matrix-manifest`.

## Shared Wiring Needs (Root / Index Barrels)

Re-export the generators barrel from `packages/spec-expansion/src/index.ts` (frozen; not edited here):

```ts
export {
  MatrixGeneratorRegistry,
  ScopedRuleCollapser,
  MatrixCellPersistenceRepo,
  MATRIX_IDS,
  MATRIX_CATALOG,
  cellKey,
  kitchenMealOrderingGraph,
  backendApiGraph,
  headlessCliGraph,
  stressGraph,
} from "./generators/index.js";
```

Also export the types `MatrixId`, `RawMatrixCell`, `GenerationRun`, `SettledProjectGraph`, `UniversalRule`, `CollapsedMatrices`, `ApplicabilityDecision`.

No root `package.json`, workspace, tsconfig, or eslint change.

## Dependency Intents (New Packages Requested)

None. No new package and no new dependency. SQLite access uses the Node 22 built-in `node:sqlite` `DatabaseSync` against `schema/state.sql`.

## Contract Change Requests

- Seed `INSERT INTO edge_types VALUES ('expands', 1);` in `schema/state.sql`. The table is a lookup, and this task inserts that row at runtime so edges can be written without editing the frozen schema. Task 010 SQL-parity should pick up the seed once it exists. `expands.invalidates = 1` because an origin change invalidates generated cells.
- Task 017 `KnowledgeGraphRepo` is not on this base. `LocalKnowledgeGraphPort` (`getNode`, `listSettledAxes`) is the read port. Swap it for `KnowledgeGraphRepo` when Task 017 lands. `MatrixCellPersistenceRepo` writes change sets, nodes, `node_changes`, and edges itself and registers `ef_search_text` for the node triggers. It does not call `commitChangeSet`.
- Task 074 `ReadinessCalculator` is not on this base. `LocalReadinessCalculator.calculate(counts)` applies the same `isReadyToPlan` gate (all of `openMustAsk`, `conflict`, `pendingVerification`, `openStandard`, `partial`, and `missing` are 0, and `transitivePrereqsMet` is true). It does not run `schema/queries.sql`. Generators still emit cells from settled nodes when the gate is false, and they record `readinessReady`. Proposed-basis nodes (`basis: "proposed"`) are excluded from axes.
- Task 010 touches vocabulary is not on the shared-contracts barrel. `TOUCHES_TAGS` in `generators/touches.ts` is the closed 28-tag list from `v1-knowledge-corpus.md`. Unknown tags throw. Swap imports to `@ef-harness/shared-contracts` when that barrel exports the registry.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-079-spec-matrix-generators`.

- `pnpm --filter @ef-harness/spec-expansion typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/spec-expansion lint` — pass (`eslint .`).
- `pnpm --filter @ef-harness/spec-expansion test -- generators` — pass, 2 files, 12 tests. Covers Kitchen web, backend API, and headless CLI exact cells; anonymous × profile update and immutable-audit update `not_applicable`; `401` vs `403`/`404`; terminal and cutoff state cells; email notification axes; print only on the tagged screen; CLI skips and the single file-lock cell; zero-integration `M07`; Kitchen Manager delta only on `M01`/`M03`/`M04`; title rename keeps every cell id; filled-cell preservation and `expands` edges. The 25-entity / 8-role / 60-endpoint run asserts `rawCells >= 12000`, collapsed rules + exceptions `< 200`, and lossless expansion. The `< 50 ms` sample is the best of 3 warmed `generate` + `collapse` runs so one GC pause does not fail the budget.
- `node scripts/verify-harmony.mjs --task 079` — pass (`harmony ok for Task-079`).

## Known Limitations / Follow-Ups

- Package barrel `packages/spec-expansion/src/index.ts` does not re-export these symbols yet.
- `expands` is not in the committed `edge_types` seed; the repo inserts it on open.
- Readiness counts are not computed from `discovery_scopes` / `scope_criteria`. The local port only evaluates the boolean gate and filters unsettled nodes.
- Large universal rules keep full origin id sets in `GenerationRun.domains` (role, entity, and endpoint ids for each `ep|` and `http|` scope). Cell objects for that product do not repeat those arrays.
- Collapse stores a universal rule once a scope has at least two cells with the same signature. Size-1 groups and `forceException` cells (valid transitions, cutoff transitions) stay explicit exception/open cells.
- Pass 1–3 cell filling, EARS text, and contradiction checks are Task 080 and Task 081. This task only emits structural skeletons.
