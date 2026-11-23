---
task_id: "Task-184"
branch: "task/184-sweep-ownership-engine"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/investigations/src/sweeps/**"
  - "packages/investigations/tests/sweeps/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 184 handoff

Repo-wide sweep ownership engine: two-phase `path_leases` coordination, maintenance-window draining, isolated `harness/s/<slug>` orchestration, deterministic codemod runner ports, and crash-safe stale-lease recovery.

## Exports Provided

Import from `packages/investigations/src/sweeps/index.ts` until the package barrel is wired.

- `SweepLeaseCoordinator` — deadlock-free `intent → granted` acquisition with repo-wide singleton guard and overlap claim barrier helpers
- `MaintenanceWindowDrainer` — overlapping-task drain progress, cancel-safe lease release, grant polling
- `DeterministicCodemodRunner` — sandboxed `ts-morph` / `ast-grep` / `jscodeshift` step runner with dry-run previews and hard timeouts
- `SweepOrchestrator` — planner/worker hybrid flow: approval preview, drain window, `harness/s/<slug>` branch, codemod pass, `<= 8` tail shards, optional CAS land via `EF-Sweep` trailer
- `StaleSweepLeaseRecovery` — cold-open orphan lease detection and resume/discard handling
- `buildSweepPlanPreview`, `requiresApproval`, `partitionTailShards`, `globToPathPrefix`, `normalizePrefixes`, `pathOverlapsLease`, `scopeToGlobs`

Structural ports for Tasks 020, 038, 039, 045/048, 111, 167, 185:

- `SweepLeasePort` — `openSweepIntent`, `grantSweepLease`, `releaseSweepLease`, optional `listActiveRepoWideLeases`
- `TaskRuntimePort` — `listActiveTasks`, `requestDrain`
- `WorktreeSlotPoolPort` — `ensureSweepBranch`, `discardSweepBranch`
- `RefLeaseAndCasManagerPort` — `casUpdateRef`
- `SandboxedRunnerPort`, `CodemodBackendPort`, `SweepSafetyPort`

## Shared Wiring Needs (Root / Index Barrels)

`packages/investigations/src/index.ts` is outside this task's owned write scope. Integrator should re-export:

```ts
export * from "./sweeps/index.js";
```

`packages/investigations/package.json` may add optional `ts-morph` workspace dependency for production codemod backends; tests currently resolve `ts-morph` from the repo root devDependency.

## Dependency Intents (New Packages Requested)

None (reuse root-pinned `ts-morph` and `@ast-grep/cli`).

## Contract Change Requests

None.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-184-sweep-ownership-engine`.

- `pnpm --filter @ef-harness/investigations test -- sweeps` — pass (Vitest v5.1.1: 10 tests).
- `pnpm --filter @ef-harness/investigations typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/investigations lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 184` — pending final commit gate (`--require-ready`).

## Known Limitations / Follow-Ups

- Production wiring expects Task 020 `TaskLeaseManager` as the `SweepLeasePort` implementation; unit tests use an in-memory lease port that mirrors `open_sweep_intent` / `grant_sweep_lease` ordering rules.
- `DeterministicCodemodRunner` delegates AST work to `CodemodBackendPort`; Task 185 supplies inventory/gates before/after sweeps.
- Live `ast-grep` CLI transforms are not exercised in unit tests (port hook only); ts-morph rename uses a 50-file fixture when the root workspace provides `ts-morph`.