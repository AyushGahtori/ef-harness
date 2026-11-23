---
task_id: "Task-171"
branch: "task/171-editor-coexistence-watcher"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/integrator/src/coexistence-watcher/**"
  - "packages/integrator/tests/coexistence-watcher/**"
  - ".agent-handoffs/task-171.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 171 handoff

Editor coexistence file & git watcher: `@parcel/watcher` on the developer checkout, active-scope overlap holds/cards, manual lockfile include card, and base-sync integration merger. Commit stays on `task/171-editor-coexistence-watcher`.

## Exports Provided

Import from `packages/integrator/src/coexistence-watcher/index.ts` (not the frozen package barrel):

- `EditorCoexistenceWatcher` — debounced checkout + `.git/HEAD` watcher; zero-touch developer checkout invariant
- `ActiveScopeOverlapDetector` — surgical `editor_overlap` hold + `Take Over` / `Keep Both` / `Ignore` card with repeat suppression
- `ManualLockfileIncludeHandler` — `Commit & include` vs `Keep separate` card without `git add`/`commit` in the developer tree
- `BaseSyncIntegrationMerger` — serialized merge-queue base sync into `harness/integration`, force-push/amend rewrite detection, deleted-file alerts
- `createParcelWatchBackend`, `createMinGitRepoInspector` — `@parcel/watcher` loader (root-hoisted) and read-only git port
- In-memory ports: `InMemoryActiveTasks`, `InMemoryTaskHoldsManager`, `RecordingCoexistenceUi`, `InMemoryCoexistenceEventStore`, `InMemoryProjectMergeQueue`, etc.
- Types: `OverlapCardPayload`, `CoexistenceEventRecord`, `MinGitRepoInspectorPort`, `ProjectMergeQueuePort`, …

## Shared Wiring Needs (Root / Index Barrels)

`packages/integrator/src/index.ts` is not frozen on this base but out of owned scope. Integration should re-export the coexistence barrel when allowed:

```ts
export {
  EditorCoexistenceWatcher,
  ActiveScopeOverlapDetector,
  ManualLockfileIncludeHandler,
  BaseSyncIntegrationMerger,
} from "./coexistence-watcher/index.js";
```

## Dependency Intents (New Packages Requested)

None. `@parcel/watcher` resolves from the root workspace lockfile (same pattern as Task 085).

## Contract Change Requests

None. Local ports stand in for upstream tasks until wired:

- Task 021 `TaskHoldsManager` → `TaskHoldsManagerPort` / `InMemoryTaskHoldsManager` (`editor_overlap` hold reason)
- Task 035 `MinGitRepoInspector` → `MinGitRepoInspectorPort` / `createMinGitRepoInspector`
- Task 039 `RefLeaseAndCasManager` → `RefLeaseAndCasManagerPort` / `InMemoryRefLease` in tests
- Task 110 `SmartBranchFreshnessSync` → `SmartBranchFreshnessSyncPort` / `NoopSmartBranchFreshnessSync`
- Task 111 `ProjectMergeQueue` → `ProjectMergeQueuePort` / `InMemoryProjectMergeQueue`
- Task 173 human takeover → `HumanOwnedTransitionPort`
- Task 172 landing → `LandingOverlapFlagPort`
- `state.db.coexistence_events` → `CoexistenceEventStorePort` / `InMemoryCoexistenceEventStore`

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-171-editor-coexistence-watcher`:

- `pnpm --filter @ef-harness/integrator typecheck` — pass
- `pnpm --filter @ef-harness/integrator lint` — pass
- `pnpm --filter @ef-harness/integrator test -- coexistence-watcher` — pass, 6 tests (non-overlap silence, overlap hold+card+suppression, lockfile card w/o index mutation, base-sync merge+rewrite block, watcher teardown, case-insensitive scope)
- `node scripts/verify-harmony.mjs --task 171` — pass at commit via `agent-worktree commit 171`

## Known Limitations / Follow-Ups

- `InMemory*` ports and audit log are stand-ins until `packages/db` exposes `coexistence_events` and Task 021 exports `placeHold` with `editor_overlap`.
- Real `@parcel/watcher` integration is covered via injectable `WatchBackend`; production wiring should pass `createParcelWatchBackend()`.
- Base sync uses merge-result SHA supplied by the merge queue port; full ephemeral worktree + `CombinedRegressionGate` belongs to Task 111 integration.
- `Take Over` emits `HumanOwnedTransitionPort` only; Task 173 owns the full `HUMAN_OWNED` lifecycle.