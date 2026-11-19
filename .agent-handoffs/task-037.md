---
task_id: "Task-037"
branch: "task/037-temp-index-snapshots"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/git-engine/src/snapshots/**"
  - "packages/git-engine/tests/snapshots/**"
  - ".agent-handoffs/task-037.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 037 handoff

Temporary-index dirty-work snapshotter and step-checkpoint WIP committer. Commit stays on `task/037-temp-index-snapshots`.

## Exports Provided

- `SnapshotManager` — `createDirtyWorkSnapshot`, `createCheckpointWipCommit`, `listSnapshots`, `pruneSnapshots`, `sweepTempIndexes`
- `SnapshotResult` — dirty-work snapshot outcome (`noChanges`, `commitSha`, `treeSha`, `ref`, `headSha`, `unborn`, `parentSha`, `excludedPaths`)
- `CheckpointCommitResult` — step WIP outcome (`reused`, `noChanges`, `commitSha`, `treeSha`, `ref`, `parentSha`, `wipRef`, `excludedPaths`)
- `SnapshotSafetyBlockedError` — thrown with the `SafetyScanReport` before `git add` / `git write-tree` when the uncommitted delta has secrets or a file over 50 MB
- `createProcessSnapshotGitRunner` — Task 035-shaped `execGit({ args, cwd, env, developerCheckout, userExplicitConsentToken })` adapter (`shell: false`, `core.longpaths=true`, no `core.autocrlf` override)
- `createDeltaSafetyScanner` / `adaptWorkingTreeScanner` — Task 036 `SafetyScanReport` port. `adaptWorkingTreeScanner` filters `scanWorkingTreeForBaseline()` down to the uncommitted delta
- `defaultHarnessTmp` — `%LOCALAPPDATA%\EFHarness\tmp` (or `os.tmpdir()/EFHarness/tmp` when `LOCALAPPDATA` is unset)

Snapshot commits use subject `harness: snapshot of uncommitted work`. Checkpoint commits use subject `harness: checkpoint of attempt work`. Both use author and committer `Harness Kernel <kernel@harness.local>` and trailers `Harness-Task`, `Harness-Attempt`, `Harness-Step`. Refs are `refs/harness/snapshots/<project>/<n>` and `refs/harness/checkpoints/<attempt>/<step>`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/git-engine/src/index.ts` is outside this task's owned write scope. Please re-export `SnapshotManager`, `SnapshotResult`, `CheckpointCommitResult`, and `SnapshotSafetyBlockedError` from that barrel during integration.

Construct `SnapshotManager` with:

- Task 035 `GitRunner.execGit` (options-object form). The local `createProcessSnapshotGitRunner` matches that call shape and is the default until the runner barrel is wired.
- Task 036 `GitSafetyScanner` via `safetyScannerForRepo: adaptWorkingTreeScanner((repoPath) => new GitSafetyScanner({ root: repoPath }))`. The default `createDeltaSafetyScanner` scans only the uncommitted delta (env files, private-key names, live-key / vault / high-entropy hits, and `> 50 MB` files) and is what the tests exercise on this branch.

`GIT_INDEX_FILE` is passed on the `execGit` `env` for `read-tree`, `add`, `rm --cached`, and `write-tree` only. Read-only fingerprint commands omit it and set `GIT_OPTIONAL_LOCKS=0`.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None.

## Exact Verification Commands & Results

- `pnpm --filter @ef-harness/git-engine test -- snapshots` — pass, 16/16 tests (vitest, 56.08s). Coverage includes the four-way dirty tree (staged, unstaged, deleted, untracked, plus a spaced/bracketed/Unicode path) with an unchanged `.git/index` SHA-256, `git diff --cached`, `git diff`, untracked list, and `HEAD`; secret and `> 50 MB` blocks before any new object; secret exclusion via temp-index `git rm --cached` without deleting the file or storing the secret blob; unborn HEAD; an absent submodule checkout keeping the HEAD gitlink, and a checked-out dirty gitlink recorded without changing the superproject index; `.gitattributes` / `core.autocrlf` blob parity with a normal `git add`; checkpoint reuse when the tree is unchanged; prune refusal for parked and unlanded checkpoints; `git gc --prune=now` ref survival; and a clean `git merge-tree --write-tree` after the same dirty edits are committed on top of the original `HEAD`.
- `pnpm --filter @ef-harness/git-engine typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/git-engine lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 037` — pass (`harmony ok for Task-037`).

## Known Limitations / Follow-Ups

- Task 035 and Task 036 are not on this branch, so the snapshotter ships injection ports plus a process Git adapter and a delta scanner. Integration should pass the real `GitRunner` and `GitSafetyScanner`.
- A submodule's own uncommitted file contents are not copied into the superproject tree. A checked-out submodule's dirty gitlink is recorded by `git add -A`. An absent checkout is excluded from that add so the HEAD gitlink stays in the temporary index instead of being staged as a deletion. Superproject file changes are still snapshotted.
- `git for-each-ref` on the installed Git rejects `%(parents)`. `listSnapshots` reads every parent SHA with `git log -1 --format=%P`.
- `pruneSnapshots` deletes a checkpoint only when the caller supplies that attempt as landed and not parked. Missing disposition refuses the delete.
