---
task_id: "Task-035"
branch: "task/035-mingit-wrapper-folder-states"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/git-engine/src/runner/**"
  - "packages/git-engine/tests/runner/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 035 handoff

Safe MinGit wrapper, 11-state folder inspector, in-memory merge-tree predictor, and developer-checkout guard. Commit stays on `task/035-mingit-wrapper-folder-states`.

## Exports Provided

Import from `packages/git-engine/src/runner/index.ts` until the package barrel is wired.

- `GitRunner.execGit(options: ExecGitOptions): Promise<ExecGitResult>`
- `GitRunner.resolveGitBinary(options?: ResolveGitBinaryOptions): Promise<ResolvedGitBinary>`
- `GitRunner.assertNeverMutatesDeveloperCheckout(input): void`
- `FolderStateInspector.inspectWorkspaceFolder(folder: string, options?: InspectWorkspaceFolderOptions): Promise<FolderStateResult>`
- `FolderStateInspector.initializeNewRepo(options: InitializeNewRepoOptions): Promise<InitializeNewRepoResult>`
- `FolderStateInspector.workOnACopy(options: WorkOnCopyOptions): Promise<WorkOnCopyResult>`
- `FolderStateInspector.predictMergeTree(options: PredictMergeTreeOptions): Promise<MergeTreePrediction>`
- `FolderStateInspector.detectCaseCollisions(options: DetectCaseCollisionsOptions): Promise<CaseCollisionReport>`
- Named exports of the same functions: `execGit`, `resolveGitBinary`, `inspectWorkspaceFolder`, `initializeNewRepo`, `predictMergeTree`, `detectCaseCollisions`, `workOnACopy`, `assertNeverMutatesDeveloperCheckout`
- `StructuredLogger` is a structural consumer of the Task 011 logger (`debug` / `info` / `warn` / `error`). Callers pass it in; this package does not import telemetry.

`execGit` returns `{ exitCode, stdout, stderr, durationMs }` plus `timedOut`, `busyMessage`, `gitPath`, and `argv`. Every invocation is `spawn(gitBin, args, { shell: false, windowsHide: true })` with `-c core.longpaths=true` and `-c core.quotepath=false`, `GIT_TERMINAL_PROMPT=0`, and no `core.autocrlf` override.

## Shared Wiring Needs (Root / Index Barrels)

`packages/git-engine/src/index.ts` is outside this task's owned write scope. The integrator should re-export the runner barrel from that file:

```ts
export {
  GitRunner,
  FolderStateInspector,
  execGit,
  resolveGitBinary,
  inspectWorkspaceFolder,
  initializeNewRepo,
  workOnACopy,
  predictMergeTree,
  detectCaseCollisions,
  assertNeverMutatesDeveloperCheckout,
} from "./runner/index.js";
```

No root `package.json` or `packages/shared-contracts` edit is required.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-035-mingit-wrapper-folder-states`.

- `pnpm --filter @ef-harness/git-engine test -- runner` — pass. Vitest v5.1.1: 8 files, 47 tests passed in 23.23s. Covers all 11 folder states on temporary directories (empty, files without Git, OS junk, clean, dirty, unborn plus dirty, mid-merge in a linked worktree, mid-rebase, cherry-pick, revert and rebase-apply markers, detached HEAD, Mercurial, Perforce, simulated OneDrive/Dropbox/iCloud/UNC, missing identity, shallow clone), the checkout-mutation guard, merge-tree clean and conflict predictions with an unchanged worktree and index, case collisions (`src/Foo.ts` vs `src/foo.ts`), UTF-8 filenames, and a path longer than 400 characters. Git integration suites use a 30s Vitest timeout so real `git.exe` spawns still finish when the suite runs in parallel.
- `pnpm --filter @ef-harness/git-engine typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/git-engine lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 035` — pass (`harmony ok for Task-035`, exit 0). The commit command runs it again with `--require-ready`.

## Known Limitations / Follow-Ups

- This task does not vendor the MinGit zip. `resolveGitBinary` prefers `<resources>/mingit/cmd/git.exe` and accepts a Settings path only at Git >= 2.38, falling back to bundled MinGit with `Requires Git 2.38+ for in-memory merge-tree` when the override is older. Integration tests drive the installed Git 2.54 because the installer payload is outside the owned subtree. Resolver tests use an on-disk placeholder plus the `runVersion` probe.
- While `.git/index.lock` is held, read-only `status` retries briefly and then returns `Git busy in another process`. The lock file is never deleted. `statusReliable` is false. `primary` may stay `git_clean` only so the folder is not reported as empty; callers must honor `gitBusy` before treating the tree as clean.
- A UNC path is probed in a short-lived child (3s) so a missing share does not stall the main thread. A share that does not answer in time is returned as the non-blocking sync warning.
- `symbolic-ref -q HEAD` is read-only. Assigning or deleting a ref with `symbolic-ref` requires `userExplicitConsentToken` in the developer checkout.
- Command timeouts are enforced in `runProcess`, which `execGit` calls with `timeoutMs`. The timeout test drives `runProcess` directly.
