---
task_id: "Task-027"
branch: "task/027-read-models-rollups-drift"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - packages/db/src/read-models/**
  - packages/db/tests/read-models/**
  - .agent-handoffs/task-027.md
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 027 handoff

`ReadModelRepo` serves Board and feature progress from trigger-maintained `rollup_feature_tasks` and `rollup_feature_requirements`, recomputes `requirement_status` in the same transaction as check, waiver, and requirement changes, and heals drift inside `BEGIN IMMEDIATE`. Commit stays on `task/027-read-models-rollups-drift`.

## Exports Provided

`packages/db/src/read-models/index.ts`:

- `ReadModelRepo` with `getBoardSummary`, `getFeatureProgress`, `syncRequirementStatusInTx`, `syncRequirementStatusForChecks`, `recomputeAllRequirementStatuses`, `runDriftCheckAndHeal`, `getTraceabilityGaps`, `getRequirementStatus`, `listWaivers`, `canonicalQuery`, `transaction`, `close`
- `openReadModelRepo` opens `schema/state.sql` on `node:sqlite`, registers `ef_search_text`, and loads `schema/queries.sql`
- `createReadModelRepo` binds an already opened `ReadModelConnection`
- `openReadModelDatabase`, `ReadModelConnection`
- `BoardSummary`, `FeatureProgress`, `DriftReport`, `DriftBugAlert`, `TraceabilityGaps`, `RequirementStatusRow`, `RequirementStatusSyncRequest`, `RequirementStatusSyncResult`, `RequirementStatusName`, `WaiverExposure`, `TaskRollupDriftRow`, `RequirementRollupDriftRow`, `RequirementStatusDriftRow`
- `RollupWriteForbiddenError`, `WaiverApprovalRequiredError`, `ReadModelTransactionError`, `ReadModelHealError`, `ReadModelQueryError`, `InvalidSyncRequestError`, `ReadModelError`
- `createReadModelLogger`, `createMemoryLogger`, `ReadModelLogger`

`getBoardSummary` returns `{ features, readRows }`. Each feature includes `featureState` from `feature_runtime`, task lane counts, and requirement counts. The empty feature id `""` is the trigger's `coalesce(feature, '')` bucket for project-wide rules. `DriftReport` rows use the canonical diff shape `{ feature, state, rollup_n, actual_n }` for tasks and `{ requirement, stored_status, recomputed_status, ... }` for requirement status. `runDriftCheckAndHeal` logs `kernel_bug.read_model_drift` at severity `error` before rebuilding.

`rollup_drift`, `requirement_status_recompute`, `requirements_without_task`, `requirements_without_check`, and `tasks_without_requirement` are executed from `schema/queries.sql` with no copied SQL. Requirement-rollup drift uses the same full-outer-join shape against `coalesce(feature, '')`.

## Shared Wiring Needs (Root / Index Barrels)

wiring_needs:

- `packages/db/src/index.ts` is frozen by Task 001. Add this barrel export so Tasks 032, 066, 092, and 124 import the read models from `@ef-harness/db`:

```ts
export {
  InvalidSyncRequestError,
  ReadModelError,
  ReadModelHealError,
  ReadModelQueryError,
  ReadModelRepo,
  ReadModelTransactionError,
  RollupWriteForbiddenError,
  WaiverApprovalRequiredError,
  createReadModelLogger,
  createReadModelRepo,
  openReadModelDatabase,
  openReadModelRepo,
} from "./read-models/index.js";
export type {
  BoardSummary,
  DriftBugAlert,
  DriftReport,
  FeatureProgress,
  ReadModelLogger,
  RequirementStatusName,
  RequirementStatusRow,
  RequirementStatusSyncRequest,
  RequirementStatusSyncResult,
  TraceabilityGaps,
  WaiverExposure,
} from "./read-models/index.js";
```

Do not re-export `loadQueryCatalog` or `ProjectStateDb` from this barrel. Those names belong to Tasks 012 and 013. `packages/db/package.json` stays unchanged.

## Dependency Intents (New Packages Requested)

None. The implementation uses built-in `node:sqlite` (`DatabaseSync`, `setAuthorizer`) and the existing `@ef-harness/shared-contracts` barrel (`canonicalAssetAbsolute` for `schema/state.sql` and `schema/queries.sql`).

## Contract Change Requests

None. No schema, root manifest, or shared-contract edits.

Upstream binding, used because Task 013 is not on `harness/integration`:

- `openReadModelRepo` / `openReadModelDatabase` stand in for `ProjectStateDb`. `ReadModelRepo` takes a connection with `exec`, `prepare` (positional arrays or bare `:name` parameters), `isTransaction`, and `close`.
- After Task 013 exports the writer session, construct `ReadModelConnection` around that `DatabaseSync` (foreign keys, `ef_search_text`, and the rollup authorizer already applied) and pass it to `createReadModelRepo`. Do not open a second writer.

`requirement_status` has no `DELETE` trigger. Retiring a requirement deletes its status row and then rebuilds `rollup_feature_requirements` from the remaining rows inside the same transaction. That rebuild is the only application write to either rollup table. `task_runtime` transitions and requirement status inserts/updates leave the counters to `task_runtime_ai` / `task_runtime_au` and `requirement_status_ai` / `requirement_status_au`. Direct `INSERT`, `UPDATE`, and `DELETE` against the rollup tables throw `RollupWriteForbiddenError` unless the drift rebuild latch is held. SQLite triggers still update the counters because the authorizer allows writes whose `triggerOrView` is set.

`requirement_status_recompute` orders by `recorded_at DESC` only. Before that query runs, tied timestamps on one check are made strictly increasing. Ties break by attempt id, then `check_version`, and the last row becomes the newest result. The canonical statement is not edited.

`syncRequirementStatusInTx` must run inside `BEGIN IMMEDIATE` (`repo.transaction` or `syncRequirementStatusForChecks`, which opens that transaction). It upserts only the requirements named by `requirementIds` or linked from `checkIds`. `recomputeAllRequirementStatuses` upserts every active requirement and removes status rows the recompute no longer returns. A non-low requirement becomes `waived` only when an active waiver has a non-empty `approved_by` and, when `risk_max` is set, that ceiling covers `fields.risk`. Otherwise the sync throws `WaiverApprovalRequiredError` and rolls back. Low-risk requirements may be waived without `approved_by`. `listWaivers` reads the `waivers` view (`reason`, `approved_by`, `risk_max`) and reports `coversRequirement`.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-027-read-models-rollups-drift`:

- `pnpm --filter @ef-harness/db test -- read-models` — pass. Vitest 5.1.1: 2 files, 14 tests passed (trigger task rollups across create, state change, and feature move with no negative counts; fail-then-pass and check version bump back to pending; skip and missing counted as failing; monotonic `recorded_at` tie-break; approved, low-risk, unapproved, and risk-ceiling waivers; null-feature `X-01`/`X-02` bucket; retirement; traceability gaps; rollup authorizer; tampered task rollup, requirement rollup, and `requirement_status` detected, logged, and healed to 0 drift; 20 features, 500 tasks, 5,000 requirements, and 5,000 checks with `getBoardSummary()` under 10 ms and 0 drift rows).
- `pnpm --filter @ef-harness/db typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/db lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 027` — pass (`harmony ok for Task-027`).

## Known Limitations / Follow-Ups

- `runDriftCheckAndHeal` writes the canonical `requirement_status_recompute` result, so any active `waives` edge becomes `waived` even when `coversRequirement` is false. The sync API refuses that write. Board and audit callers must read `listWaivers()` and treat `coversRequirement: false` as not approved. A later integration can log that set on every drift pass if the periodic job should raise it without a count mismatch.
- `openReadModelRepo` applies `schema/state.sql` itself. Swap that opener for the Task 013 writer when `ProjectStateDb` is integrated, and swap the local `-- name:` catalog for the Task 012 driver catalog without changing the query names.
- `getBoardSummary` counts rollup rows and `feature_runtime` rows only. It does not scan `nodes`, `task_runtime`, or `requirement_status`.
