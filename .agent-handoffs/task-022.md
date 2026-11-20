---
task_id: "Task-022"
branch: "task/022-feature-project-lifecycles"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/lifecycles/**"
  - "packages/db/tests/lifecycles/**"
  - ".agent-handoffs/task-022.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 022 handoff

Feature and project lifecycles live in `feature_runtime` and `project_runtime`. `LEAVES_MERGED` is written only by canonical `advance_feature_leaves_merged`. `DONE` is the only finished feature state, and `FeatureCompleted` is emitted only after the 7-condition gate returns ok inside the same transaction. `paused` is a flag, not a project state. Commit stays on `task/022-feature-project-lifecycles`.

## Exports Provided

From `packages/db/src/lifecycles/index.ts`:

- `LifecycleRepo` and `createLifecycleRepo(connection, queries?)`
- Methods: `initFeature`, `advanceFeatureLeavesMerged`, `transitionFeatureState`, `verifyFeatureDoneConditions`, `transferIntegrationHolder`, `transitionProjectState`, `setProjectPaused`, `listUnlockableFeatures`
- `FeatureDoneEvidenceInput` and `FeatureDoneCheckResult` (`ok`, `failedConditions` of `"1"`–`"7"`, `blockingCcrIds`, `failingRequirements`)
- `DONE_GATE_CONDITIONS` (ids `"1"` through `"7"`)
- `FEATURE_STATES` (13 rows with `terminal`) and `PROJECT_STATES` (10 states)
- `FEATURE_STATE_TRANSITIONS` and `PROJECT_STATE_TRANSITIONS`
- `LIFECYCLE_EVENT_TYPES`: `FeatureStateChanged`, `FeatureCompleted`, `ProjectStateChanged`, `ProjectPausedChanged`
- `LIFECYCLE_EVENT_CONSUMERS`: `scheduler`, `exporter`, `ui_projection`
- `FOUNDATION_GATE_META_KEY` (`foundation_gate`) and `FOUNDATION_GATE_PASSED_VALUE` (`passed`)
- `INTEGRATION_REF` (`refs/heads/harness/integration`)
- `StateConnection` port
- Errors: `StaleEpochError`, `IllegalFeatureTransitionError`, `IllegalProjectTransitionError`, `FeatureDoneRefusedError`, `FeatureCoupledError`, `ApprovalRequiredError`, `ProjectCompletionBlockedError`, `ChangeSetNotFoundError`, `SameIntegrationHolderError`, `FeatureNotFoundError`, `FeatureAlreadyInitializedError`, `ProjectRuntimeMissingError`, `InvalidLifecycleInputError`

`FEATURE_STATE_TRANSITIONS` edges:

- `PLANNED` → `JIT_READY`, `BLOCKED`, `DEFERRED`, `ABANDONED`
- `JIT_READY` → `IN_WAVE`, `BLOCKED`, `DEFERRED`, `ABANDONED`
- `IN_WAVE` → `BLOCKED`, `DEFERRED`, `ABANDONED` (`LEAVES_MERGED` is not an edge; only `advanceFeatureLeavesMerged` writes it)
- `LEAVES_MERGED` → `WIRED`, `BLOCKED`, `DEFERRED`, `ABANDONED`
- `WIRED` → `JOURNEY_PASSED`, `BLOCKED`, `DEFERRED`, `ABANDONED`
- `JOURNEY_PASSED` → `QUEUED_FOR_MERGE`, `BLOCKED`, `DEFERRED`, `ABANDONED`
- `QUEUED_FOR_MERGE` → `MERGED`, `BLOCKED`, `DEFERRED`, `ABANDONED`
- `MERGED` → `DONE`, `REOPENED`, `BLOCKED`, `DEFERRED`, `ABANDONED`
- `DONE` → `REOPENED`
- `BLOCKED` → the non-terminal mainline states except `DONE`, plus `DEFERRED` and `ABANDONED`
- `REOPENED` → `IN_WAVE`, `BLOCKED`, `DEFERRED`, `ABANDONED`
- `DEFERRED` → `PLANNED`, `JIT_READY`, `ABANDONED`
- `ABANDONED` → none

`MERGED → DONE` still runs `verifyFeatureDoneConditions` and throws `FeatureDoneRefusedError` unless `ok` is true. `REOPENED` requires an existing `changeSetId`, increments `epoch`, and holds downstream features. `DEFERRED` and `ABANDONED` require `approved: true` and no current `depends_on` edge to a feature outside `DONE`, `DEFERRED`, and `ABANDONED`.

Project edges are the single forward chain `DISCOVERY → SPEC_COMPLETE → UPFRONT_DOCS → PREVIEW → PHASE0 → WAVES → COMPLETION → READY_TO_LAND → LANDED → SHIPPING`. Entering `WAVES` requires `currentWave >= 1`. Entering `COMPLETION` refuses features that are not `DONE` and not an approved, decoupled `DEFERRED` or `ABANDONED` feature.

Upstream feature dependencies are current `depends_on` edges from the dependent feature node to the upstream feature node. `listUnlockableFeatures` returns `PLANNED` and `JIT_READY` features whose upstream features are all `DONE`, and only when `meta.foundation_gate = passed` or `project_runtime.state` is already `WAVES` or later.

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is outside this task's owned subtree. Wire it to re-export the lifecycles barrel:

```ts
export {
  DONE_GATE_CONDITIONS,
  FEATURE_STATES,
  FEATURE_STATE_TRANSITIONS,
  FeatureDoneRefusedError,
  LifecycleRepo,
  PROJECT_STATES,
  PROJECT_STATE_TRANSITIONS,
  StaleEpochError,
  createLifecycleRepo,
} from "./lifecycles/index.js";
export type {
  FeatureDoneCheckResult,
  FeatureDoneEvidenceInput,
  FeatureState,
  ProjectState,
} from "./lifecycles/index.js";
```

Pass the Task 013 `ProjectStateDb` writer connection (Task 012 `SqliteConnection`) into `createLifecycleRepo`. Do not open a second writer. `advance_feature_leaves_merged`, `requirement_status_recompute`, and `register_delivery` are already read from `schema/queries.sql`.

Task 010's `FEATURE_STATES` and `PROJECT_STATES` are not on this base commit, and package barrels cannot be deep-imported. The constants in `packages/db/src/lifecycles/states.ts` are schema-parity copies checked against `schema/state.sql`. After Task 010 is exported from `@ef-harness/shared-contracts`, replace those copies with that barrel and keep the transition graphs here.

Task 026 should keep `LIFECYCLE_EVENT_CONSUMERS` for `FeatureStateChanged`, `FeatureCompleted`, `ProjectStateChanged`, and `ProjectPausedChanged` (or replace this list with its default routing table). Every lifecycle event already calls canonical `register_delivery` for those three consumers in the same transaction as the `outbox` insert.

Task 093, Task 096, Task 101, and Task 111 should call `LifecycleRepo` rather than updating `feature_runtime` or `project_runtime` directly. `FeatureCompleted` is the unlock signal for dependent features.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-022-feature-project-lifecycles`:

- `pnpm --filter @ef-harness/db test -- lifecycles` — pass. Vitest v5.1.1: 5 files, 25 tests passed. Covers all 13 feature states, all 10 project states, `paused` orthogonality in `PHASE0` and `WAVES` (state and `current_wave` preserved), `advance_feature_leaves_merged` refusing zero tasks, zero leaves, and an `ACCEPTED` leaf while succeeding for merged leaves plus a `DRAFTED` wiring task, seven negative `DONE` checks with condition ids `"1"` through `"7"`, stale brief and contract versions, `fail`/`skip`/`missing` checks, a stale `check_version`, open CCR ids, waiver acceptance, epoch takeover fencing, downstream holds on `REOPENED`, and wave unlock only after upstream `DONE` plus the foundation gate.
- `pnpm --filter @ef-harness/db typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/db lint` — pass (`eslint .`, exit 0).
- `node scripts/verify-harmony.mjs --task 022` — pass (exit 0, `harmony ok for Task-022`, about 114s). Schema tests, diagram check, full workspace typecheck, lint, and tests succeeded.

## Known Limitations / Follow-Ups

- Task 010, Task 012, and Task 013 are not in the base commit, so this package cannot import `ProjectStateDb`, `SqliteConnection`, or the vocabulary barrel. `StateConnection` is the structural port those writers must satisfy. `FEATURE_STATES` and `PROJECT_STATES` are parity copies.
- A feature with tasks but zero leaf rows is refused before `advance_feature_leaves_merged` (`reason: "no_leaves"`). The canonical statement still performs the update whenever at least one leaf exists, including the unmerged-`ACCEPTED` refusal and the all-settled success.
- Conditions 1, 2, and 7 are pure SQL. Conditions 3–6 also require `FeatureDoneEvidenceInput` because schema version 1 has no tables for feature-level static-audit receipts, clean-environment journey runs, the `harness/integration` merge, or accessibility findings. The gate still checks stored journey checks (`fields.gate = "feature_journey"` at the check's current version), `task_scopes` coverage, `page_route` / `screen_bearing` / `screens`, and every other `DONE` feature id.
- Feature dependencies use `depends_on` from the dependent feature to the upstream feature. `REOPENED` places `task_holds` (`requirement_change`, source = change set id) on downstream tasks, moves `DONE`/`MERGED` dependents to `REOPENED` (epoch + 1), and moves other in-progress dependents to `BLOCKED`. `PLANNED` and `JIT_READY` dependents keep their state and simply stop unlocking.
- `DEFERRED` and `ABANDONED` drop out of the `COMPLETION` blocker list only when the entering `FeatureStateChanged` payload has `approved: true` and they are decoupled from features outside `DONE`, `DEFERRED`, and `ABANDONED`. A raw SQL state write without that event stays a blocker.
- `setProjectPaused` does not block later phase transitions. Callers that must freeze dispatch should read `paused` themselves.
- `COMPLETION` trusts `feature_runtime.state`. It does not re-run the 7-condition gate for a row already in `DONE`.
