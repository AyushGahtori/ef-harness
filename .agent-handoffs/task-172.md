---
task_id: "Task-172"
branch: "task/172-safe-landing-engine"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/integrator/src/landing/**"
  - "packages/integrator/tests/landing/**"
  - ".agent-handoffs/task-172.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 172 handoff

Safe Landing Engine for moving `harness/integration` onto the developer branch with zero silent stash, four-option overlap handling, and rollback safety refs.

## Exports Provided

- `SafeLandingPreFlightAnalyzer` — classifies landing into Path A/B/C/D from live porcelain, merge-tree, and integration diff.
- `ZeroStashLandingExecutor` — executes landing with forbidden-command guard (no stash/reset --hard/checkout -f/clean -fd in developer checkout).
- `DirtyOverlapFourOptionDialog` — presents the four exact overlap choices; Option 2 creates `ef/<slug>` without touching checkout.
- `LandingRollbackSafetyPoint` — writes `refs/ef-safety/pre-land-*` and supports one-click undo onto the pre-land SHA.

Module entry: `packages/integrator/src/landing/index.ts` (not wired through package root barrel; import by path).

## Shared Wiring Needs (Root / Index Barrels)

- Wire `packages/integrator/src/landing/**` exports into `packages/integrator/src/index.ts` when Task 001 foundation allows package root edits.
- Connect consumed contracts: `MinGitRepoInspector` (035), `DirtySnapshotEngine` (037), `RefLeaseAndCasManager` (039), `LandingSummaryGenerator` (101), `BaseSyncIntegrationMerger` (171), `CombinedRegressionGate` (111).

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None.

## Exact Verification Commands & Results

```text
pnpm --filter @ef-harness/integrator typecheck
pnpm --filter @ef-harness/integrator lint
pnpm --filter @ef-harness/integrator test -- landing
node scripts/verify-harmony.mjs --task 172
```

- `pnpm --filter @ef-harness/integrator typecheck` — pass
- `pnpm --filter @ef-harness/integrator lint` — pass
- `pnpm --filter @ef-harness/integrator test -- landing` — 7/7 pass (Path A/B/C/D, case collision, undo safety, zero-stash guard)
- `node scripts/verify-harmony.mjs --task 172` — pass (run before commit)

## Known Limitations / Follow-Ups

- `DirtySnapshotEngine` restore on undo is optional injection; in-repo tests cover ref rollback without Task 037 wiring.
- Post-landing `harness/f/*` prune is best-effort via `for-each-ref` until Task 110 wiring lands.