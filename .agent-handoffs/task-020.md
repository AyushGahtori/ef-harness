---
task_id: "Task-020"
branch: "task/020-task-claiming-leases-sleep-guard"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/leases/**"
  - "packages/db/tests/leases/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 020 handoff

Atomic task claiming, deferred-FK attempt creation, sweep path leases, checkpoint storage, and sleep-skew lease sweeping. Commit stays on `task/020-task-claiming-leases-sleep-guard`.

## Exports Provided

Import from `packages/db/src/leases/index.ts`.

- `TaskLeaseManager` — `claimTask`, `renewLease`, `sweepExpiredLeases`, `fenceAttempts`, `onPowerResume`, `registerTaskScopes`, `openSweepIntent`, `grantSweepLease`, `releaseSweepLease`, `reconcileLiveAttempts`, `registerAttemptProcess`
- `DualClock`, `SystemDualClock`, `ManualDualClock`
- `SleepSkewGuard` and `SLEEP_SKEW_THRESHOLD_MS` (30_000)
- `AttemptCheckpointRepo`
- `globToPathPrefix`
- `LeaseFencedError`
- `LeaseDatabase` / `runImmediate` — writer port expected from `ProjectStateDb` (Task 013); named parameters use bare keys

`claimTask` returns `{ claimed: true, epoch, attemptId }` or `{ claimed: false, reason }` where `reason` is `not_ready | held | dependency_open | brief_stale | sweep_overlap | lost_race`. `claim_task` and `create_attempt` run in one `BEGIN IMMEDIATE` transaction. `sweepExpiredLeases` runs `sweep_expired_leases` then `fence_attempts` in one transaction and returns `{ suspended: true, expired: [], fenced: 0 }` while the sleep-skew guard is suspended. `renewLease` throws `LeaseFencedError` when zero rows change.

Canonical statements executed verbatim from `schema/queries.sql`: `claim_task`, `create_attempt`, `sweep_expired_leases`, `fence_attempts`, `open_sweep_intent`, `grant_sweep_lease`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is outside this task's write scope and still exports only `packageIdentity`. Tasks 034, 095, 131, and 184 should import the lease API from `packages/db/src/leases/index.ts` until a later wiring change re-exports it from `@ef-harness/db`.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None. No edits to `schema/queries.sql`, `schema/state.sql`, or shared contracts.

## Exact Verification Commands & Results

- `pnpm --filter @ef-harness/db test -- leases` — passed, 5 files, 31 tests. Covers all 6 claim refusals, deferred FK rejection at COMMIT, one-winner races, cancelled/superseded dependency retirement, glob-to-prefix boundaries, intent/granted sweep lifecycle, overlapping-sweep serialization, checkpoint round-trip, +1 hour sleep with 4 attempts (3 live extended, 1 dead fenced), and a -10 minute backward clock jump.
- `pnpm --filter @ef-harness/db typecheck` — passed (`tsc -b`).
- `pnpm --filter @ef-harness/db lint` — passed (`eslint .`).
- `node scripts/verify-harmony.mjs --task 020` — passed (`harmony ok for Task-020`). Schema 67/67, diagrams, scope, root typecheck, lint, and tests were included.

A local `node:sqlite` probe on Node v24.16.0 showed `StatementSync.all({})` and `all()` with no arguments return the same rows for a statement that has no parameters. Parameterless reads in this task pass `{}`. Named statements always receive their bound object. Multi-row `RETURNING` results stayed distinct (`sweepExpiredLeases` fenced three separate tasks after wake).

## Known Limitations / Follow-Ups

- An attempt with no registered pid is treated as live (`OsProcessProbe` returns true for `pid === null`) so a missing process id cannot false-expire a lease. Callers that know the OS pid should `registerAttemptProcess` before `reconcileLiveAttempts`.
- The public package barrel does not re-export this module yet. See Shared Wiring Needs.
