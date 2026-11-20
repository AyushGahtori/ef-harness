---
task_id: "Task-039"
branch: "task/039-branch-ref-leases-cas"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/git-engine/src/refs/**"
  - "packages/git-engine/tests/refs/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 039 handoff

Epoch-fenced `ref_leases`, atomic compare-and-swap `git update-ref`, squash and no-fast-forward merge commit builders, and the harness trailer recovery scanner. Commit stays on `task/039-branch-ref-leases-cas`.

## Exports Provided

Import from `packages/git-engine/src/refs/index.ts` until the package barrel is wired:

- `RefLeaseManager` — `acquireRefLease`, `renewRefLease`, `releaseRefLease`, `readRefLease`, `advanceRefCas`, `createSquashCommit`, `createMergeCommit`, `parseHarnessTrailers`, `findAcceptedCommitsSince`, `reconcileRefLeases`, `deleteMergedAttemptBranch`
- `HarnessCommitTrailers` — `feature`, `task`, `attempt`, `checks` (`Harness-Feature`, `Harness-Task`, `Harness-Attempt`, `Harness-Checks`)
- `findAcceptedCommitsSince` — commits in `<sinceSha>..refs/heads/harness/integration` (or another harness ref) that carry `Harness-Task` and `Harness-Checks`, oldest first, for Task 016 replay
- `parseHarnessTrailers`, `ParsedHarnessTrailers`, `AcceptedHarnessCommit`
- `CasAdvanceResult` — success, or `{ ok: false, reason: "cas_mismatch", actualSha }`
- `RefReconciliation` — `in_sync`, `caught_up` (`alreadyApplied: true` so the same commit is not merged again), `external_advance`, `missing_ref`
- `MissingGitIdentityError` — `code: "missing_git_identity"`, `missing`, `prompt` for the one-time setup form
- `StaleRefLeaseError`, `LeaseExpiredError`, `RefLeaseHeldError`, `RefLeaseNotHeldError`, `NamespaceViolationError`, `ProtectedBranchError`
- `issueLandingAuthorization` / `LandingAuthorization` — explicit user-consent token for Task 172 landing onto `refs/heads/main` or the configured developer base branch
- `openRefLeaseStateDb`, `RefLeaseStateDb`, `REF_LEASES_DDL` — `state.db.ref_leases(ref, holder, epoch, expected_sha, expires_at)`
- `createDirectGitRunner`, `GitRunner` — synchronous stand-in for Task 035 (`execGit` → `{ exitCode, stdout, stderr, durationMs }`, `resolveGitBinary`)

`createSquashCommit` publishes exactly one parent onto `refs/heads/harness/f/<feature>`. `createMergeCommit` publishes a two-parent commit onto `refs/heads/harness/integration` (first parent integration, second parent feature) and never fast-forwards. Both pass the message through `git interpret-trailers` and `git commit-tree -F -` with `shell: false`. Agent author is `<role> <agent-id> <agent-id@harness.local>`; committer is `user.name` / `user.email`. Human author uses `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` when both are set.

Shared refs (`harness/integration`, `harness/f/*`, `harness/s/*`) advance only while `(ref, holder, epoch)` is current and unexpired. Every such update is `git update-ref <ref> <new> <expectedOld>`. A zero old OID creates a missing ref and fails when the ref already exists. `reconcileRefLeases` copies Git's actual SHA back into `expected_sha` after a crash between `update-ref` and the SQLite write, using trailers to mark that commit already applied.

## Shared Wiring Needs (Root / Index Barrels)

`packages/git-engine/src/index.ts` is outside this task's write scope. The integrator should re-export the refs barrel:

```ts
export {
  RefLeaseManager,
  findAcceptedCommitsSince,
  parseHarnessTrailers,
  createDirectGitRunner,
  openRefLeaseStateDb,
  issueLandingAuthorization,
  MissingGitIdentityError,
  ZERO_OID,
} from "./refs/index.js";
export type {
  HarnessCommitTrailers,
  GitRunner,
  RefLeaseStateDb,
  LandingAuthorization,
  AcceptedHarnessCommit,
  CasAdvanceResult,
  RefReconciliation,
} from "./refs/index.js";
```

Adapt Task 013 `ProjectStateDb` to `RefLeaseStateDb` (`transaction`, `get`, `all`, `run`, `close`) on the existing `ref_leases` table. Adapt Task 035 `GitRunner.execGit` if it is asynchronous: await it and return `{ exitCode, stdout, stderr, durationMs }`. `createDirectGitRunner` is the local implementation used until that adapter is connected. It always passes `-c core.longpaths=true`, `GIT_TERMINAL_PROMPT=0`, `shell: false`, and `windowsHide: true`.

## Dependency Intents (New Packages Requested)

None. SQLite access uses Node's built-in `node:sqlite`. Git is spawned from `PATH`.

## Contract Change Requests

None.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-039-branch-ref-leases-cas`.

- `pnpm --filter @ef-harness/git-engine test -- refs` — pass. Vitest v5.1.1, 2 files, 17 tests passed (`tests/refs/trailers.test.ts`, `tests/refs/ref-lease-manager.test.ts`). Covers lease acquire/renew/release, epoch fencing with no `update-ref` for a stale or expired holder, concurrent `cas_mismatch` plus `actualSha`, zero-OID create and reject, namespace refusal of `refs/heads/main` / `MAIN` / the developer base without `LandingAuthorization`, consented landing, one-parent squash and two-parent merge with `Worker A0014 <A0014@harness.local>` author and configured committer, stdin commit messages containing `"`, `$`, and `%`, human `GIT_AUTHOR_*` preservation with trailers, `MissingGitIdentityError` before `commit-tree`, `findAcceptedCommitsSince` task ids and check receipts, crash catch-up without a second commit, external advance retry, and attempt deletion only after `MERGED_TO_FEATURE` plus retention, including refusal of `wip/*`.
- `pnpm --filter @ef-harness/git-engine typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/git-engine lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 039` — pass (`harmony ok for Task-039`), including schema 67/67, diagram integrity, owned-path scope, and workspace `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- `ref_leases` fences `refs/heads/harness/integration`, `refs/heads/harness/f/*`, and `refs/heads/harness/s/*` only, matching `schema/state.sql`. Attempt, snapshot, checkpoint, and `harness-state` refs stay inside the namespace guard and still use 3-argument `git update-ref`, but they have no lease row.
- Attempt deletion is authorized by the live feature-ref lease. `wip/*` is always rejected. Deletion is `git update-ref -d <ref> <oldsha>`, not `git branch -D`.
- Git itself strips leading and trailing identity crud (`"`, `'`, `<`, `>`). The manager passes `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL` through unchanged; a quote at either end of a name will not survive `git commit-tree`.
- Task 016 should treat `reconcileRefLeases` status `caught_up` (`alreadyApplied: true`) as the commit already on the ref. A later `in_sync` report does not create another merge.
- Task 172 is the production caller of `issueLandingAuthorization`. The token is an in-process brand, not a persisted credential.
