---
task_id: "Task-110"
branch: "task/110-parallel-feature-branches-migrations"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/integrator/src/feature-branches/**"
  - "packages/integrator/tests/feature-branches/**"
  - ".agent-handoffs/task-110.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 110 handoff

Parallel feature branches, serialized dependency intents, timestamp+hash migration lint, and smart freshness sync. Commit stays on `task/110-parallel-feature-branches-migrations`.

## Exports Provided

Import from `packages/integrator/src/feature-branches/index.ts` until the package barrel is wired:

- `ParallelFeatureBranchManager` — opens `refs/heads/harness/f/<slug>` from verified `refs/heads/harness/integration`, tracks `{ baseIntegrationSha, headSha, verifiedHeadSha, pinnedBaseCommitSha, activeLeafSlots, behindIntegrationCount, status }` in SQLite, commits feature files, fast-forwards or merge-commits from integration, refuses rebase, and prunes the ref only after `markMergeQueueLanded` (Task 111) plus reachability.
- `DependencyIntentAggregator` — `aggregate(intents)` is the only writer of root `package.json` and `pnpm-lock.yaml`. Compatible ranges become one compare-and-swap commit. Conflicts and supply-chain denials are returned without moving the ref.
- `reconcileIntents` — pure range merge used by the aggregator.
- `MigrationIntentAndConflictLinter` and alias `MigrationConflictLinter` — names `migrations/YYYYMMDDHHMMSS_<6char>_<slug>.sql`, lints duplicate table/index/enum, drop-versus-index, foreign-key order, locked destructive DDL, sequential filenames, and Drizzle sequence collisions. `lint` also returns `restamped` and `ordered`.
- `SmartBranchFreshnessSync` — `plan` / `applyDue`. Disjoint clean branches skip. Lockfile, read-set, and shared-contract overlap schedule one sync at the next leaf boundary. A running turn is deferred. A textual conflict is attempted in a detached worktree and held when the merge does not apply, without rewriting the feature SHA.
- `SharedFileDriftMonitor` — `git diff --name-only` plus untracked files across active `harness/f/*` branches.
- `MigrationRehearsalChecker` — copies a template SQLite file and applies additive migrations in caller order. `createTemplateDatabase` builds that template.
- `PnpmLockfileOnlyInstaller` — `pnpm install --lockfile-only --ignore-scripts`.
- `LocalRefLeaseManager`, `LocalWorktreeSlotPool`, `LocalMergeTreeScanner`, `LocalSupplyChainGate`, `LocalSkeletonLock` — sibling ports described below.
- Errors: `IntegrationUnverifiedError`, `ActiveTurnSyncError`, `HistoryRewriteRefusedError`, `PruneRefusedError`, `CasMismatchError`, `DirtyWorktreeSyncError`, `LockfileIntegrityError`, `LockfileInstallError`, `RefLeaseHeldError`, `StaleRefLeaseError`, `FeatureBranchError` (`direct_lockfile_edit` when a worker writes `package.json` or `pnpm-lock.yaml`).

## Shared Wiring Needs (Root / Index Barrels)

`packages/integrator/src/index.ts` is outside this task's write scope. Re-export the feature-branch API from that barrel:

```ts
export {
  DependencyIntentAggregator,
  MigrationConflictLinter,
  MigrationIntentAndConflictLinter,
  MigrationRehearsalChecker,
  ParallelFeatureBranchManager,
  SharedFileDriftMonitor,
  SmartBranchFreshnessSync,
} from "./feature-branches/index.js";
export type {
  DependencyAggregateResult,
  DependencyIntent,
  FreshnessPlan,
  MigrationFile,
  MigrationFinding,
  SyncOutcome,
} from "./feature-branches/index.js";
```

No root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig*.json`, or `eslint.config.mjs` edits.

## Dependency Intents (New Packages Requested)

None. Git and `pnpm` are spawned from `PATH` (`shell: false`). SQLite rehearsal uses `node:sqlite`, which ships with the Node 22 engine. Tests inject a lockfile writer so they do not download packages. `PnpmLockfileOnlyInstaller` is the production installer.

## Contract Change Requests

None. No schema, `.opencode`, or `.githooks` edits. `feature_branch_runtime` and the read-set, write-scope, turn, and slot tables live in the task database passed to `openFeatureBranchStateDb`. They are not new rows in `schema/state.sql`.

Sibling branches are not on this base. These local ports should be swapped at integration:

- **Task 038.** `LocalWorktreeSlotPool` stands in for `WorktreeSlotPool` (`WorktreeSlotManager`). Feature slots use `git worktree add`. Sync and lockfile commits use `git worktree add --detach` so a running feature worktree is not the merge target. Swap the pool without checking out `harness/integration` into a worker slot.
- **Task 039.** The task text names `RefLeaseAndCasManager`. The published export is `RefLeaseManager.advanceRefCas`, which returns `{ ok: false, reason: "cas_mismatch", actualSha }`. `LocalRefLeaseManager.advance` runs `git update-ref <ref> <new> <old>` and throws `CasMismatchError` with `actualSha`. Lease rows use the same `ref_leases` columns (`ref`, `holder`, `epoch`, `expected_sha`, `expires_at`). Point feature-branch and integration updates at `RefLeaseManager` and map the mismatch result onto `CasMismatchError`, or teach callers to read `{ ok: false }`.
- **Task 046, named as Task 048 in this task's text.** Task 048 exports `AttemptMcpServer`, not a package installer. The allowlist, typosquat check, and lockfile integrity live on Task 046 `KernelPackageInstaller` (`vetDependencyIntent`, `checkTyposquat`, `verifyLockfileIntegrity`, `reconcileDependencyIntents`). `LocalSupplyChainGate` is a small allowlist plus Damerau-Levenshtein distance 1–2. `reconcileIntents` matches the Task 046 intersection, with this task's intent shape `{ featureId, packageName, versionRange, devOnly, rationale, taskId? }`. Task 046 uses `{ taskId, packageName, range, reason }`. Map `versionRange` to `range`, `rationale` to `reason`, and `featureId` alongside `taskId` when both packages are on the branch. Keep `devOnly`. Replace `assertLockfileHasNoRemoteTarball` with `verifyLockfileIntegrity`.
- **Task 052.** `MigrationRehearsalChecker.rehearse` copies the template with `fs.copyFileSync` and applies SQL on the clone. Swap the copy for `TemplateDatabaseManager.cloneFromTemplate`. SQLite has no `ALTER TABLE ... ADD CONSTRAINT`, so an `add_foreign_key` statement is rehearsed as `CREATE INDEX` after the missing-target check. `CREATE TYPE ... AS ENUM` is rehearsed as a one-column table. Keep that translation only for the sqlite clone.
- **Task 083.** `LocalSkeletonLock` stands in for `SkeletonLockEnforcer`. Destructive DDL on a locked table or column is `destructive_skeleton` unless the migration carries `CCR-<digits>`. Swap `isLocked` / `destructiveAllowed` for `SkeletonLockEnforcer.evaluate` without letting a worker self-label a drop as additive.
- **Task 092.** Write scopes are stored per feature and passed into `SharedFileDriftMonitor`. This package does not compile the graph. Two features that both change a path outside a single scope raise a drift warning. `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml` are excluded because the aggregator owns the root manifest and lockfile.
- **Task 096.** `LocalMergeTreeScanner` runs the same `git merge-tree --write-tree --name-only --messages` command as `MergeTreePreflightScanner` and returns `{ clean, treeOid, paths, command }`. It does not read conflict hunks. Swap in `MergeTreePreflightScanner` and keep the zero-checkout rule.
- **Task 111.** `markMergeQueueLanded(featureId, integrationSha)` records `landedByTask: 111` only when that SHA is `harness/integration` and the feature head is an ancestor. `pruneLanded` then deletes `refs/heads/harness/f/<slug>` after leaf slots are gone. This package does not run the merge queue. The only commit it puts on `harness/integration` is the serialized lockfile commit. After that commit, `SmartBranchFreshnessSync.applyDue` updates active feature branches at a leaf boundary.

A shared contract or migration schedules a sync only when it intersects the feature read set, or when `merge-tree` reports a textual conflict, or when the landed commit touches `package.json` or `pnpm-lock.yaml`. An unrelated migration does not churn a disjoint branch.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-110-parallel-feature-branches-migrations`:

- `pnpm --filter @ef-harness/integrator typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/integrator lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/integrator test -- feature-branches` — pass. Vitest v5.1.1: 4 files, 33 tests passed, about 66s. Covers three simultaneous `harness/f/*` branches, same-second timestamp+hash names with zero collisions, duplicate table/index/enum, drop-versus-index, foreign-key restamp and `depends_on`, skeleton DDL without a CCR, Prisma and Drizzle sequence serialization, combined rehearsal on a cloned template database including an `ALTER` foreign key, one lockfile commit for `zod` and `date-fns`, incompatible ranges left uncommitted, typosquat and allowlist denial, disjoint skip, read-set and lockfile boundary sync, no SHA rewrite under a running turn, held textual conflicts, shared-file drift, ref-lease compare-and-swap, missing-ref recovery, and prune-after-landing.
- `node scripts/verify-harmony.mjs --task 110` — pass (exit 0, `harmony ok for Task-110`, about 57s). Schema tests, diagram check, owned-path scope, and workspace typecheck, lint, and tests succeeded.

## Known Limitations / Follow-Ups

- `PnpmLockfileOnlyInstaller` is not invoked by the tests. They pass an installer that writes a lockfile with `lockfileVersion` and `integrity` so the suite stays offline. The aggregator still refuses a missing lockfile, a missing integrity hash, and a non-registry tarball URL.
- `LocalSupplyChainGate` does not check package age, advisories, SPDX licenses, or install-script approval. Those stay on Task 046.
- Freshness sync merge conflicts are held. The feature ref and the feature worktree stay as they were. Resolving the hunk belongs to Task 096 / Task 111, not to a rebase of the running worktree.
- `markMergeQueueLanded` does not perform the merge. Task 111 must move `harness/integration` first. Prune releases an idle feature worktree, and it refuses while a leaf turn or a detached slot is still recorded.
- Recovery recreates `harness/f/<slug>` from `verifiedHeadSha` when that object is still a commit. If the object is gone, the status becomes `missing_ref` and the caller gets a recovery card. The lease row is left in place so the recreate compare-and-swap still has a holder.
- SQLite rehearsal withholds destructive statements and does not boot Postgres. A foreign-key `ALTER` becomes an index so the clone can still fail when the target table or source column is missing.
