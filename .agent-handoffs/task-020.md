---
task_id: "Task-020"
branch: "task/020-task-claiming-leases-sleep-guard"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/leases/**"
  - "packages/db/tests/leases/**"
  - ".agent-handoffs/task-020.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 020 handoff

Atomic task claiming, sweep path leases, deferred-FK attempt creation, attempt checkpoints, and sleep-skew lease sweeping. Commit stays on `task/020-task-claiming-leases-sleep-guard`.

## Exports Provided

From `packages/db/src/leases/index.ts`:

- `TaskLeaseManager` — `claimTask`, `renewLease`, `sweepExpiredLeases`, `fenceAttempts`, `onPowerResume`, `registerAttemptProcess`, `registerTaskScopes`, `openSweepIntent`, `grantSweepLease`, `releaseSweepLease`, `reconcileLiveAttempts`
- `DualClock` (type), `SystemDualClock`, `ManualDualClock`, `SleepSkewGuard`, `SLEEP_SKEW_THRESHOLD_MS` (30_000)
- `AttemptCheckpointRepo`
- `globToPathPrefix`
- `LeaseFencedError`, `OsProcessProbe`, `AttemptProcessProbe`
- `LeaseDatabase` — writer port (`exec`, `prepare().all/get/run`) with bare named parameters, the same shape `schema/schema-test.js` uses for `claim_task`
- `runImmediate` — `BEGIN IMMEDIATE` with rollback on failure
- `canonicalQuery`, `loadQueryCatalog`, `LEASE_QUERY_NAMES`

`claimTask` runs canonical `claim_task` and `create_attempt` in one `BEGIN IMMEDIATE` transaction and returns `{ claimed: true, epoch, attemptId }` or `{ claimed: false, reason }` where `reason` is `not_ready | held | dependency_open | brief_stale | sweep_overlap | lost_race`.

`ACCEPTED` and `MERGED_TO_FEATURE` have `task_states.done = 1` and satisfy `depends_on`. `CANCELLED` and `SUPERSEDED` have `done = 0`, so the claim transaction retires those active `depends_on` edges (`valid_to_rev`) before `claim_task`. The retirement rolls back when the claim is refused.

`sweepExpiredLeases` runs canonical `sweep_expired_leases` then `fence_attempts` in one transaction. A wall/monotonic disagreement above 30 seconds, or `onPowerResume()`, suspends that sweeper until `reconcileLiveAttempts` extends leases whose registered process is alive and expires only dead processes. `submission_pending = 1` is never expired.

Overlapping sweep intents are granted in `(created_at, id)` order so two sweeps cannot both become `granted` on the same paths. Disjoint prefixes can be granted together. Prefix inserts share the intent transaction; a failed insert leaves no `path_leases` row.

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is outside this task's write scope. Please re-export the lease API from the package barrel. `DualClock` is a type, so it stays on the type export (`verbatimModuleSyntax` is on):

```ts
export {
  AttemptCheckpointRepo,
  LeaseFencedError,
  ManualDualClock,
  OsProcessProbe,
  SLEEP_SKEW_THRESHOLD_MS,
  SleepSkewGuard,
  SystemDualClock,
  TaskLeaseManager,
  globToPathPrefix,
  runImmediate,
} from "./leases/index.js";
export type {
  AttemptCheckpoint,
  AttemptProcessProbe,
  ClaimResult,
  ClaimTaskInput,
  DualClock,
  LeaseDatabase,
  ReconcileResult,
  SweepGrantResult,
  SweepResult,
} from "./leases/index.js";
```

`TaskLeaseManager` should be constructed with the `ProjectStateDb` writer once Task 013 is wired:

```ts
const manager = new TaskLeaseManager({
  db: projectStateDbWriter, // LeaseDatabase
  clock: new SystemDualClock(),
});
```

Task 131 should call `onPowerResume()` and `registerAttemptProcess(attemptId, pid)` for every live attempt. Task 034, Task 095, and Task 184 should import the symbols above.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None. Canonical statements `claim_task`, `create_attempt`, `sweep_expired_leases`, `fence_attempts`, `open_sweep_intent`, and `grant_sweep_lease` are loaded from `schema/queries.sql` and are not copied into TypeScript.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-020-task-claiming-leases-sleep-guard`:

- `pnpm --filter @ef-harness/db test -- leases` — pass, 5 files, 31 tests. Covers all 6 claim refusals, deferred FK rejection at COMMIT, one-winner races, cancelled/superseded dependency retirement, glob-to-prefix boundaries, intent/granted sweep lifecycle, overlapping-sweep serialization, checkpoint round-trip, a +1 hour sleep with 4 attempts (3 live leases extended, 1 dead attempt fenced), and a -10 minute backward clock jump.
- `pnpm --filter @ef-harness/db typecheck` — pass, exit 0 (`tsc -b`).
- `pnpm --filter @ef-harness/db lint` — pass, exit 0 (`eslint .`).
- `node scripts/verify-harmony.mjs --task 020` — pass, `harmony ok for Task-020` (schema 67/67, diagrams, scope, root typecheck, lint, and tests).

A local `node:sqlite` probe on Node v24.16.0 showed `StatementSync.all({})` and `all()` with no arguments return the same rows for a statement that has no parameters. Parameterless reads pass `{}`. Named statements always receive their bound object. Multi-row `RETURNING` results stayed distinct.

## Known Limitations / Follow-Ups

- Tasks 012 and 013 are not on `harness/integration`, so this branch cannot import `SqliteConnection` or `ProjectStateDb`. `LeaseDatabase` is the consumption seam. Statements must accept bare parameter names (`task`, not `:task`).
- Process identity is an in-memory map. A missing pid is treated as live during reconciliation so an unregistered attempt is not false-expired. Dead processes must be registered with a pid the probe reports as gone, or a custom `AttemptProcessProbe`.
- The db package barrel is intentionally unchanged until an integrator applies the wiring above.
