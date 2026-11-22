---
task_id: "Task-129"
branch: "task/129-planned-feature-undo-engine"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/integrator/src/undo/**"
  - "packages/integrator/tests/undo/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 129 handoff

Planned feature undo engine: 3-step inventory, cross-feature usage graph, shared ownership transfer, expand-then-contract data choice, and fast-path merge revert versus surgical removal. Commit stays on `task/129-planned-feature-undo-engine`.

## Exports Provided

From `packages/integrator/src/undo/index.ts`:

- `FeatureUndoInventoryAnalyzer` — read-only 3-step inventory. Classifies every artifact from the feature's non-ff merge into exclusive, shared, or persistent data. Refuses in-flight features (`QUEUED`, `WORKING`, `INTEGRATING`) as a cancellation, not a file delete.
- `CrossFeatureUsageGraphChecker` — usage scan over canonical edges (`consumes`, `consumes_contract`, `depends_on`, `implements`), `EF-Feature` trailers, and a live import plus SQL `REFERENCES` scan of `harness/integration`.
- `SharedOwnershipTransferPlanner` — moves a shared helper or table to the single consuming feature, or to `phase0-shared` when more than one feature still uses it. Later-edit overlaps such as an adjacent nav line are not reassigned.
- `UndoDataRetentionDialog` — plain-English preview before any worktree edit. Default data choice is `keep_dormant` (expand-then-contract). Drop is offered only as a new migration. Dependent features get `Undo F-A + F-B together` or `Cancel undo`.
- `FeatureUndoExecutor` — fast-path `git revert -m 1` when exclusive ratio is 1 and `git merge-tree` is clean (0 LLM tokens); otherwise surgical removal. Lands only by CAS `git update-ref` after `CombinedRegressionGatePort` and `STATIC_AUDIT`. Archives `node_status = 'undone'` and keeps `feature_id`. In-flight cancel archives `harness/f/F` and checkpoints without moving `harness/integration`. `revive()` restores the same `feature_id`, specs, and decisions.
- `FeatureUndoEngine` — wires the classes above to a caller-supplied state file and repo.

Local ports also exported from that barrel: `KnowledgeGraphPort`, `ReverseImpactWalkerPort`, `RefLeasePort`, `CombinedRegressionGatePort`, `ActiveTaskHaltPort`, `InboxRetirementPort`, `runStaticAudit`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/integrator/src/index.ts` on this branch. It is outside the owned subtree. The integrator barrel should later re-export from `./undo/index.js`:

- `FeatureUndoInventoryAnalyzer`
- `CrossFeatureUsageGraphChecker`
- `SharedOwnershipTransferPlanner`
- `UndoDataRetentionDialog`
- `FeatureUndoExecutor`
- `FeatureUndoEngine`
- `KnowledgeGraphPort`
- `ReverseImpactWalkerPort`
- `RefLeasePort`
- `CombinedRegressionGatePort`
- `ActiveTaskHaltPort`
- `InboxRetirementPort`

No root `package.json`, `tsconfig.json`, or workspace barrel edits.

## Dependency Intents (New Packages Requested)

None. Git is invoked as a local process. SQLite uses `node:sqlite`. No model client is called.

## Contract Change Requests

Frozen `schema/state.sql` cannot store the undo archive:

- `nodes.status` allows only `draft`, `active`, `retired`, `superseded`.
- `feature_states` has no `undone` row.

Task 129 therefore records `node_status = 'undone'` and preserves `feature_id`, specs, decisions, and the `EF-Feature` merge SHA in the caller-supplied runtime database created by `KnowledgeGraphPort.open`. A later schema change should add `undone` to `nodes.status` and `feature_states` without deleting the feature id, then swap `KnowledgeGraphPort` for Task 017.

Frozen edge vocabulary uses `consumes_contract`. This engine also accepts the task's `consumes` edge. Both count as shared usage. Only `depends_on` is a hard functional dependency (undo together or cancel).

## Sibling ports (branches not on this base)

Sibling task branches are not in this checkout. The engine calls local ports and records the swap here:

| Sibling | Real contract | Local port in `packages/integrator/src/undo/` |
|---|---|---|
| Task 017 | `KnowledgeGraphRepo` | `KnowledgeGraphPort` (runtime tables, not frozen `schema/state.sql`) |
| Task 039 | `RefLeaseAndCasManager` | `RefLeasePort` (`ref_leases` row, `git update-ref <new> <old>` only when the undo commit's parent is the old `harness/integration` tip) |
| Task 054 | `STATIC_AUDIT` | `runStaticAudit` (dead nav, dangling relative imports, orphan `definePermission` / `can()` tokens) |
| Task 087 | `ReverseImpactWalker` | `ReverseImpactWalkerPort.hardDependents` (transitive `depends_on`) |
| Task 111 | `ProjectMergeQueue` non-ff merges, `EF-Feature` trailers, `CombinedRegressionGate` | trailer parse of `harness/integration` merges; `CombinedRegressionGatePort` runs remaining `features/*/*.test.mjs` with node plus the static audit. It does not import Task 111. |
| Task 114 | halt active workers; Route 3 revival | `ActiveTaskHaltPort` records the halt. `FeatureUndoEngine.revive` returns the archived `feature_id`, specs, decisions, and merge SHA for Route 3. |
| Task 116 | retire Inbox questions for an undone feature | `InboxRetirementPort.retireExclusive` |

`git reset`, `rebase`, and forced push are rejected before they run. Landed undos are forward commits.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-129-planned-feature-undo-engine`.

- `pnpm --filter @ef-harness/integrator typecheck` — exit 0
- `pnpm --filter @ef-harness/integrator lint` — exit 0
- `pnpm --filter @ef-harness/integrator test -- undo` — exit 0. Vitest v5.1.1, 1 file, 11 tests passed (exclusive/shared/schema partition via imports, `consumes` edges, and SQL references; exclusive `git revert -m 1` at 0 LLM tokens with the old merge still reachable; `currency.ts` ownership moved to `F-CateringEmail` and its test stayed green; `merge-tree` conflict on `src/App.tsx` fell back to surgical removal that kept the email nav line; in-flight cancel of 3 workers archived `harness/f/F-Reports` and the checkpoint without moving `harness/integration` in under 2s; loyalty table stayed dormant and the historical migration bytes were unchanged; explicit drop wrote a new migration only; hard `depends_on` blocked, cancel left the ref unmoved, undo-together removed both features in one forward commit; dangling `/print` link and orphan `print.view` blocked the commit; CAS mismatch left the feature active)
- `node scripts/verify-harmony.mjs --task 129` — exit 0, printed `harmony ok for Task-129`

## Known Limitations / Follow-Ups

- The package barrel re-export above is not applied on this branch.
- `CombinedRegressionGatePort` is the Task 111 stand-in. It executes remaining feature node tests and the undo static audit. It does not run the full typecheck, lint, build, fresh-template migration, and sealed journey stack from Task 111.
- `ActiveTaskHaltPort` records worker halts. It does not signal live OS processes. Task 114 should perform the real stop when the ports are swapped.
- Archival status `undone` lives in the undo runtime database until `schema/state.sql` accepts it.
- The engine never calls a model. Fast-path revert records `llmTokens: 0`.
- A crash after a successful `update-ref` and before the archive transaction would leave the revert commit on `harness/integration` with the feature still `active`. Re-running the undo is refused only after `markUndone`.
- External effects under `effects/` are kept and named in the preview. Compensating actions are not turned into new tasks on this branch.
- `phase0-shared` is the owner when a piece has more than one consumer. A single consumer receives that feature id (for example `F-CateringEmail`).
