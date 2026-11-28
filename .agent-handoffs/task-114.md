---
task_id: "Task-114"
branch: "task/114-four-route-steering-dispatcher"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/steering/src/dispatcher/**"
  - "packages/steering/tests/dispatcher/**"
  - ".agent-handoffs/task-114.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 114 handoff

Four-route mid-build steering dispatcher: read-only evidence queries, existing-feature revisions, duplicate-id new features, and the immediate kernel Stop path. Commit stays on `task/114-four-route-steering-dispatcher`.

## Exports Provided

Import from `packages/steering/src/dispatcher/index.ts`. The package barrel is intentionally unchanged.

- `FourRouteSteeringDispatcher` — `dispatchReadOnlyQuery`, `dispatchExistingFeatureChange`, `dispatchNewFeatureAddition`, `dispatchExecutionControl`, `dispatchClauses`, `overrideWrongRoute`.
- `ImmediateKernelStopController` — `stop`, `applyStop`, `pauseBuild`, `pauseFeature`, `resume`, `resumeFeature`, `cancelTask`, `retryTask`, `switchPreset`, `skipOptionalTask`, `acceptCandidate`, `execute`.
- `NewFeatureDedupSpawner` — `spawn`. Revives deferred or undone features by canonical `feature_id` and refuses a `-2` suffix.
- `MidBuildRouteReceipt` — confirmation pill plus `wrongRoute(targetId)` (`"Wrong route?"`).
- `createFourRouteSteeringDispatcher(seed)` — wires the local ports and returns a `SteeringAssembly`.
- `StoppedEpochMismatchError` (`STOPPED_EPOCH_MISMATCH`), `ReadOnlyViolationError`, `JobLeakError`, `RouteLatencyError`, `TaskControlError`.
- Constants: `STOP_STATE_DEADLINE_MS` (100), `QUERY_DEADLINE_MS` (2000), `JOB_KILL_DEADLINE_MS` (500), `PAUSE_GRACE_MS` (15000), `DELTA_TASK_CEILING` (5), `DELTA_COST_CEILING_MICRO_USD` (1000000), `DELTA_WINDOW_CEILING_PPM` (20000), `USER_PAUSED_REASON` (`user_paused`), `REQUIREMENT_CHANGE_REASON` (`requirement_change`).

`acceptCandidate` quarantines the verified artifact in `submission_pending` and throws `StoppedEpochMismatchError` when `project_runtime.state` is `STOPPED` or `control_epoch` is stale. It does not move `refs/harness/integration` or `refs/harness/f/*` on that path.

## Shared Wiring Needs (Root / Index Barrels)

`packages/steering/src/index.ts` is outside this task's owned subtree. Integration should re-export the dispatcher beside the existing package identity:

```ts
export {
  FourRouteSteeringDispatcher,
  ImmediateKernelStopController,
  JobLeakError,
  MidBuildRouteReceipt,
  NewFeatureDedupSpawner,
  ReadOnlyViolationError,
  RouteLatencyError,
  SteeringError,
  StoppedEpochMismatchError,
  TaskControlError,
  createFourRouteSteeringDispatcher,
} from "./dispatcher/index.js";
export type {
  ExecutionControlInput,
  ExistingFeatureChangeInput,
  NewFeatureAdditionInput,
  ReadOnlyQueryInput,
  RouteDispatchResult,
  SteeringAssembly,
  WrongRouteChoice,
} from "./dispatcher/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or `packages/steering/package.json` change. This package stays on `@ef-harness/shared-contracts` only. Do not deep-import sibling packages.

Task 115 should call `TaskHoldsManagerPort.placeHold` / `releaseHold` (local class `LocalTaskHoldsManager`) and then swap to Task 021. Task 122 should call `ImmediateKernelStopController.stop` from the fixed Stop button. Task 128 should read `submissionPending()`, preserved `checkpointRef`s, and the stop pill. Task 155 should call `FourRouteSteeringDispatcher.dispatchClauses` / the four route methods and `MidBuildRouteReceipt.wrongRoute`.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None for frozen root manifests. These vocabulary additions are required for a later integration pass. This task does not edit `schema/` or package barrels.

1. `project_runtime` has no `STOPPED` value and no `control_epoch`. `ImmediateKernelStopController` keeps `state = 'STOPPED'`, `paused`, and monotonic `control_epoch` in the in-memory control plane. Add `control_epoch INTEGER NOT NULL DEFAULT 0` and a `STOPPED` control state (or a sibling column) before this can be a real `state.db` row. `project_states` today is the phase list (`WAVES` and the rest), which this task preserves as `phase`.
2. Task 021 `HOLD_REASONS` is `user_pause | requirement_change | budget | ccr | governor`. Route 4 writes `user_paused` because the task text names that reason. Map `user_paused` → `user_pause` at the adapter, or extend the vocabulary, before `TaskHoldAndSubmissionRepo.placeHold` will accept it. Route 2 already uses `requirement_change`.
3. Route telemetry is an in-memory stand-in for `telemetry.db` (`RouteTelemetry`). Add a route-latency / wrong-route correction table when Task 191's store exists. This task does not create that table in `schema/`.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-114-four-route-steering-dispatcher`:

- `pnpm --filter @ef-harness/steering typecheck` — exit 0 (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/steering lint` — exit 0 (`eslint .`).
- `pnpm --filter @ef-harness/steering test -- dispatcher` — exit 0. Vitest 5.1.1: 2 files, 11 tests passed. Covers Route 1 (worker A0014, auth-token storage, budget left, Orders page; 0 holds; 0 graph mutations; citations; `< 2 s`), Route 2 (surgical `requirement_change` hold, tiny auto-start with undoable pill, 6-task and breaking plan-delta preview, unrelated workers still running), Route 3 (`F-PdfExport` / `F-CsvExport` revival with settled answers kept, Analytics Dashboard mini-discovery while 4 workers keep running, disjoint dark-mode active wave, spend-cap warning with no discovery), Route 4 (`Paused only 'Orders' (1 worker held; 3 others still running)`, 15 s pause grace, resume leaving `user_paused`, cancel, retry, preset, skip, `< 100 ms` zero-LLM STOP), `STOPPED_EPOCH_MISMATCH` race plus a 50 ms late merge with `harness/integration` and `harness/f/F-Orders` unmoved, `"Wrong route?"` archiving the empty stub and re-dispatching `msg-print` to Route 2, compound order Stop → Answer → Edit → Add → Query, and a stubborn child killed via the job supervisor with 0 surviving PIDs in `< 500 ms` while the rehearsal worktree resets and the production/demo stamps stay intact.
- `node scripts/verify-harmony.mjs --task 114` — exit 0, `harmony ok for Task-114` (schema 67/67, diagram check, then workspace typecheck, lint, and test).

## Known Limitations / Follow-Ups

Sibling branches are not on this base. These local ports must be swapped at integration. Do not import the unpublished packages as if they were already on `harness/integration`.

- **Task 017 `KnowledgeGraphRepo`:** `LocalKnowledgeGraphRepo` is the port. Feature search is token overlap over slug, title, and a camel-case split of `feature_id` (the local stand-in for FTS5). `readEvidence` / `getEvidence` are read-only. Swap `searchFeatures`, `getFeature`, and `upsertFeature` to the db repo when its barrel exports them. Route 1 never calls `upsertFeature`.
- **Task 021 `TaskHoldAndSubmissionRepo`:** the task text names `TaskHoldsManager`. `LocalTaskHoldsManager.placeHold` / `releaseHold` / `listActiveHolds` write the in-memory hold list. Swap those three methods. Map `user_paused` as noted above.
- **Task 041 `WindowsJobManager`:** `LocalWindowsJobSupervisor` is the port (`createJob`, `assignProcess`, `spawnInJob`, `terminateJob`, `terminateAll`). `spawnInJob` starts a Node child that ignores an IPC `SIGINT`. `terminateJob` sends that interrupt, waits the grace window, then `SIGKILL` (the local stand-in for `TerminateJobObject`) and polls until the pid is gone. Swap to `WindowsJobManager.terminateJob` / `spawnInJob`. There is no Win32 helper on this branch.
- **Task 053 `NativeWorkerLoop` and Task 142 foreign adapters:** `LocalNativeWorkerLoop.interrupt` and `LocalForeignRuntimeAdapter.interrupt` record worker ids. STOP calls native for `kind: "native"` and foreign for `kind: "foreign"`. Rehearsal subprocesses are job-object children, not a second signal path.
- **Task 069 `DiscoverySessionManager`:** the task text names `DiscoverySessionCoordinator`. `LocalDiscoverySessionCoordinator.openMiniDiscovery` requires `haltUnrelatedWorkers: false` and does not touch workers. Swap the method onto `DiscoverySessionManager` when that barrel is wired.
- **Task 087 `ChangeClassifier`, `ReverseImpactWalker`, `DebouncedRevisionPropagator`:** `LocalChangeClassifier.classify`, `LocalReverseImpactWalker.walkCombined`, and `LocalDebouncedRevisionPropagator.apply` are the ports. The walker reads the seeded `impact` map (active tasks of the feature only when that map is empty). `apply` returns immediately, matching the real `apply()` flush. Swap the three classes. A breaking floor still wins over a cosmetic request when the text drops a column or moves `11:00` to `10:00`.
- **Task 102 `AskOwnerResponderEngine`:** `LocalAskOwnerResponderEngine.answerQuestion` answers from worker rows, evidence nodes, and the budget snapshot. `llmCalls` is always 0. Citations use `ef://node|task|file|receipt/<id>`. Task 102's `ClickableCitation` has no `task` kind; map `task` to `node` if that union stays closed. Swap `answerQuestion` and keep Route 1 from calling any writer.
- **Task 108 `RevisionAutoStartPolicy`:** `LocalRevisionAutoStartPolicy.evaluate` uses the same ceilings (5 tasks, $1, 2%) and the same hard stops (`must_ask`, `conflict`, `breaking_contract`, `destructive_migration`, `new_dependency`, `external_effect`). It does not implement the rolling 24 h cap. Swap `evaluate` for the real policy.
- **Task 113 `OrderedMultiClauseExecutor`:** `LocalOrderedMultiClauseExecutor.execute` sorts Stop/control → Answer → Edit → Add → Query. Swap the class. Clauses that would mutate after `STOPPED` return `Ignored after STOP · build is stopped` and do not open discovery or place holds.
- **Task 023 budget:** `LocalProjectBudget.snapshot` / `estimate` is the remaining spend and window. A new or revived feature that would pass the cap is not started. Swap to the budget ledger.
- **Task 129 undone features:** status `undone` is revived with the same `feature_id` and settled answers, using the pill `Reviving undone feature <id>`.
- **Epoch store:** the optimistic `control_epoch` check is an in-memory compare-and-swap around `acceptCandidate`, not a `BEGIN IMMEDIATE` transaction on `state.db`. The race hook `armCommitBarrier` is the test seam for the STOP versus `CandidateAcceptanceTx` interleaving. Integration should do the same check inside the real acceptance transaction.
- **Package barrel re-export above is not applied in this commit.**
