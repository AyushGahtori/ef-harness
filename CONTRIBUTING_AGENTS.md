# Working on an EF Harness task

Task 001 freezes this repository. Tasks 002 through 200 each commit on their own branch and never merge.

## Six steps

1. Create an isolated worktree from `harness/integration`:

   ```text
   node scripts/agent-worktree.mjs create 017 knowledge-graph
   ```

   That creates branch `task/017-knowledge-graph` at `../ef-wt/task-017-knowledge-graph` (override the parent with `EF_WT_ROOT` when Desktop is synced by a cloud folder).

2. Read the task's mandatory reference files and the types already exported from `@ef-harness/shared-contracts`.

3. Change only the task's owned write scope plus `.agent-handoffs/task-017.md`.

4. Fill in that handoff. Set `status` to `ready_for_integration`, list `owned_paths`, and record the commands you ran. New dependencies, barrel exports, and schema changes go in the handoff sections, not in the root manifest or `packages/shared-contracts/src/index.ts`.

5. From the worktree, run:

   ```text
   node scripts/verify-harmony.mjs --task 017
   ```

6. Commit on the task branch:

   ```text
   node scripts/agent-worktree.mjs commit 017 "describe why this change exists"
   ```

   The commit carries `EF-Task-ID`, `EF-Commit-Only: true`, and `EF-Never-Merge: true`. Do not merge, rebase, push, or check out `main` or `harness/integration`.

`node scripts/agent-worktree.mjs commit` refuses those branches. The `pre-commit` hook does too, unless the integration maintainer sets `EF_HARNESS_MAINTAINER=1`.

## Layout

There are 28 library packages under `packages/`, plus `apps/daemon`, `apps/desktop`, `apps/renderer`, `spikes`, `corpus`, `benchmarks`, and `tests/e2e`. Imports may only point at a strictly lower layer, and only through each package's `src/index.ts` barrel.

`packages/shared-contracts` is the canonical home for schema and spec paths. Later tasks add hashing, packets, prompts, and vocabularies under their own subfolders and request barrel wiring in the handoff. `packages/db`, `packages/ipc`, and `packages/sim` split the kernel. `packages/worker-loop` is the native worker. `packages/shared-observability` is the logger and secret redactor.

## Checks

`pnpm verify:env` checks Node, `node:sqlite`, the 67 schema scenarios, pnpm 10, git long paths, OpenCode, and free disk space. `pnpm typecheck`, `pnpm lint`, and `pnpm test` cover the workspace. `pnpm verify:diagrams` reruns `tools/merge-diagrams.js` and fails if the merged diagram changes.
