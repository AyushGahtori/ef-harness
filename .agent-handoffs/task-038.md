---
task_id: "Task-038"
branch: "task/038-worktree-slot-manager"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/git-engine/src/worktrees/**"
  - "packages/git-engine/tests/worktrees/**"
  - ".agent-handoffs/task-038.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 038 handoff

Reusable worktree slot manager, persistent integration worktree, sparse-checkout / submodule / LFS handling, and `git worktree repair`. Commit stays on `task/038-worktree-slot-manager`.

## Exports Provided

Import from `packages/git-engine/src/worktrees/index.ts` (package barrel wiring is listed below):

- `WorktreeSlotManager` (`acquireSlot`, `resetSlotForAttempt`, `releaseSlot`, `acquireMergeWorktree`, `ensureIntegrationWorktree`, `fastForwardIntegrationWorktree`, `repairWorktreesAfterMove`, `pruneStaleWorktrees`, `reconcileMissingWorktrees`, `setIntegrationLease`, `assertExecutionAllowed`, `removeOwnedSlot`)
- `WorktreeSlotPool` (alias of `WorktreeSlotManager`)
- `IntegrationWorktreeController`
- `SlotHandle`
- `DiskLane` (1-wide cold-create / heavy-clean mutex)
- `defaultWorktreeRoot()` → `%LOCALAPPDATA%\EFHarness\wt` (or the user-profile equivalent)
- `readSlotOwnerMarker` / `.ef-harness-slot-owner`
- `GitRunner`, `GitExecResult`, `GitRunOptions`, `createProcessGitRunner`
- `onEmptySlotCreated`, `onIntegrationAdvanced`, `onDependencySyncRequested`, and caller `beforeSlotReset` hooks
- Errors: `BeforeSlotResetRequiredError`, `SecretConfigCopyRejectedError`, `SlotOwnershipError`, `SlotBusyError`, `IntegrationLeaseRejectedError`, `IntegrationWorktreeExclusivityError`, `IntegrationRefMissingError`, `IntegrationRefMismatchError`, `GitLfsFetchError`, `WorktreeSlotError`

`onEmptySlotCreated(slotPath)` runs while the new slot directory is empty and strictly before `git worktree add`. The hook must not create files in that directory. The ownership marker is written immediately after add.

Attempt slots are created with `git worktree add --detach` plus a `harness/t/<task>/<attempt>` ref that is not checked out when that branch is already owned or checked out elsewhere. Merge worktrees are fresh detached checkouts and are never the integration worktree.

`git clean -fd` always excludes `.ef-harness-slot-owner` (along with `node_modules` and `.pnpm-store`). The marker is rewritten after checkout features, warm reset, integration fast-forward, and checkpoint recreate so Disk Cleanup can still recognize the slot.

`repairWorktreesAfterMove` runs `git worktree repair` after a main-repo move. If the harness data folder (`wtRoot`) moved but the `<project-short-id>/<slot-id>` layout is intact, registered slots are rebound to that layout and `git worktree repair` is run from the moved slot and from the main repo. Directories that lack this project's marker and a worktree `.git` file are not adopted.

## Shared Wiring Needs (Root / Index Barrels)

`packages/git-engine/src/index.ts` is outside this task's write scope. Please re-export the worktree public API from that barrel:

- `WorktreeSlotManager`, `WorktreeSlotPool`, `IntegrationWorktreeController`, `SlotHandle`, `DiskLane`, `defaultWorktreeRoot`
- `GitRunner` injection point: construct `WorktreeSlotManager` with Task 035's `GitRunner` once `packages/git-engine/src/runner` exists. Until then `createProcessGitRunner()` is the default (`spawn`, `shell: false`, `windowsHide: true`, `-c core.longpaths=true`, `-c core.quotepath=false`, `GIT_TERMINAL_PROMPT=0`).

Pass `userExplicitConsentToken` through when Task 035's developer-checkout guard is wired, so `worktree add`, `worktree repair`, and `worktree prune` against the main repo are authorized harness administration.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None. `GitRunner.execGit` / `resolveGitBinary` is consumed as a constructor port matching Task 035. Integration lease epochs are held in the slot registry via `setIntegrationLease` until Task 039's `ref_leases` table is available. `onDependencySyncRequested` is the signal Task 046 should handle when a warm slot's lockfile hash changes. `onEmptySlotCreated` is the signal Task 042 should use for the inheritable ACL. `onIntegrationAdvanced` (`restartPreview: true`) is the signal Task 160 should use to restart App Preview.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-038-worktree-slot-manager`:

- `pnpm --filter @ef-harness/git-engine typecheck` — passed (exit 0).
- `pnpm --filter @ef-harness/git-engine lint` — passed (exit 0).
- `pnpm --filter @ef-harness/git-engine test -- worktrees` — passed, 4 files, 17 tests (exit 0). Covers slot creation, `onEmptySlotCreated` before `git worktree add`, warm `node_modules` reuse, lockfile-change wipe plus dependency-sync hook, ownership marker surviving `git clean -fd`, `beforeSlotReset`, EBUSY backoff, disk-lane serialization, detached branch-collision avoidance, ownership-marker refusal, allowlist copy / secret refusal, sparse-checkout recommendation, 24h failed-slot retention, integration fast-forward, stale-epoch and unauthorized rejection, dirty-integration reset warning, worker/merge-candidate exclusivity, fresh merge worktrees, cone-mode sparse checkout, submodule `update --init --reference`, LFS `--include` limited to task paths, checkpoint recreate after manual deletion, `git worktree repair` after `fs.rename` of the main repo, and `git worktree repair` after `fs.rename` of the harness data folder.
- `node scripts/verify-harmony.mjs --task 038` — passed (`harmony ok for Task-038`, exit 0).

## Known Limitations / Follow-Ups

- `git submodule update` is invoked as `git -c protocol.file.allow=always submodule update --init --reference <mainRepo>`. Git ignores `protocol.file.allow` when it is set inside repository config, so the per-invocation `-c` is required for path-based submodules and does not write git config.
- `onDependencySyncRequested` does not install dependencies. Task 046 owns that sync.
- `setIntegrationLease` is the local epoch fence. Task 039 should replace it with `ref_leases` without changing `fastForwardIntegrationWorktree`'s proof checks (`project-merge-queue`, holder, epoch).
- The root package barrel re-export is a wiring follow-up, not done in this commit.
- `onEmptySlotCreated` must leave the new directory empty. Task 042 should apply one inheritable ACE to the directory itself and not create files before checkout.
- Moving the main repo and the worktree data folder in the same step is not repaired when neither side can still resolve the other. Move one side, call `repairWorktreesAfterMove`, then move the other.
