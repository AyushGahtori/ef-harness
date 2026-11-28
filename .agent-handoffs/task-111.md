---
task_id: "Task-111"
branch: "task/111-project-merge-queue-integrator"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/integrator/src/merge-queue/**"
  - "packages/integrator/tests/merge-queue/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 111 handoff

Serialized project merge queue for `harness/f/<feature>` onto `harness/integration`. Commit stays on `task/111-project-merge-queue-integrator`.

## Exports Provided

From `packages/integrator/src/merge-queue/index.ts`:

- `ProjectMergeQueue` — durable FIFO plus priority queue, exclusive integration ref lease, fresh merge worktree, `--no-ff` landing, CAS `update-ref`, 7-condition `DONE`, crash recovery
- `ProjectIntegratorEngine` — `project-integrator@1` prompt and candidate check (conflicting hunks, canonical specs, migration AST only; no dropped sides; no test weakening)
- `CombinedRegressionGate` — typecheck, lint, build, fresh-template migrations, journey plus sealed step 3b plus already-landed regressions, `STATIC_AUDIT` and gitleaks
- `MergeBatchBisector` — deterministic split of a failing batch, immediate landing of innocent subsets, interaction handoff when each half passes alone

Local ports also exported from that barrel: `verifyFeatureDoneConditions`, `parseProjectIntegratorV1`, `RefLeasePort`, `MergeWorktreePort`, `openMergeQueueStateDb`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/integrator/src/index.ts` on this branch. It is outside the owned subtree. The integrator barrel should later re-export:

- `ProjectMergeQueue`
- `ProjectIntegratorEngine`
- `CombinedRegressionGate`
- `MergeBatchBisector`

from `./merge-queue/index.js`.

No root `package.json`, `tsconfig.json`, or workspace barrel edits.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None.

## Sibling ports (branches not on this base)

Sibling task branches are not in this checkout. The queue calls local ports and records the swap here:

| Sibling | Real contract | Local port in `packages/integrator/src/merge-queue/` |
|---|---|---|
| Task 009 | `ProjectIntegratorV1Schema` | `parseProjectIntegratorV1` |
| Task 022 | `verifyFeatureDoneConditions` / `FeatureLifecycleManager` | `verifyFeatureDoneConditions`; feature state in `feature_queue_runtime` (not frozen `schema/state.sql`) |
| Task 038 | `WorktreeSlotPool` merge slot | `MergeWorktreePort` (detached ephemeral worktree; optional fast-forward of a caller-supplied integration worktree after CAS) |
| Task 039 | `RefLeaseAndCasManager` | `RefLeasePort` (`ref_leases` row, `git update-ref <new> <old>`) |
| Task 052 | fresh template database | `applyMigrationsFromScratch` |
| Task 055 | `CleanVerifierHarness` | `CombinedRegressionGate` typecheck, lint, and build steps |
| Task 058 | static audit | `auditDiff` / secret scan inside the gate |
| Task 110 | migration ordering linter and feature refs | `lintMigrations` / `orderMigrations`; feature refs `refs/heads/harness/f/<id>` |
| Task 112 | CCR escalation | escalation payload `to: "task-112"` with both features' specs, after the second contract-clash eviction |
| Task 129 | feature undo | `--no-ff` merge commits with `EF-Feature`, `EF-Tasks`, `EF-Requirements`, `EF-Checks-Passed`, `EF-Harness-Version` |
| Task 160 | live preview reload | `preview-reload` event with `restartPreview: true` after CAS, plus `FeatureCompleted` |
| Task 171 | base sync moving integration during verification | CAS mismatch restages the same feature onto the new head |

`state.sql` has no `merge_queue_items` table and is frozen. Queue rows live in the caller-supplied state database created by `openMergeQueueStateDb`.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-111-project-merge-queue-integrator`.

- `pnpm --filter @ef-harness/integrator typecheck` — exit 0
- `pnpm --filter @ef-harness/integrator lint` — exit 0
- `pnpm --filter @ef-harness/integrator test -- merge-queue` — exit 0. Vitest v5.1.1, 2 files, 20 tests passed (serialized drain, `--no-ff` trailers, 7-condition DONE accept and refuse, 3-feature bisection evicting only F-Orders, duplicate `/settings` resolved without test weakening, weakening candidate escalated to the developer with the ref unmoved, nav union plus migration order, CAS stale-head restage, crash before `update-ref`, crash after CAS reconciled to DONE, lease held by another holder, second contract-clash eviction escalates to task 112, secret diff rejected)
- `node scripts/verify-harmony.mjs --task 111` — exit 0, printed `harmony ok for Task-111`

## Known Limitations / Follow-Ups

- `project-integrator@1` is a deterministic local resolver plus a caller-supplied model. It does not call a live LLM. The prompt text is limited to conflicting hunks, specs, the migration AST, failing checks, and offending commits.
- The package barrel re-export above is not applied on this branch.
- When gitleaks is not on `PATH`, the gate uses the builtin secret scan and records that mode.
- A semantic fix is an extra commit on top of the `--no-ff` merges. `update-ref` runs only after the tip passes `CombinedRegressionGate`, so the branch ref is not moved to a red tree.
- Combined journey scripts are started together with `Promise.all`. The suite target remains under 2 minutes (`REGRESSION_BUDGET_MS`).
