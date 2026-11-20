---
task_id: "Task-107"
branch: "task/107-heft-scheduler-crew-presets"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/scheduler/**"
  - "packages/planner/tests/scheduler/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 107 handoff

Critical-path list scheduler for M3. HEFT upward rank, the multi-constraint wave cap, the three crew presets, and mid-build rebalancing live under `packages/planner/src/scheduler/`. This branch was created from `649773097c387ae534b686ea5825f449f843aa7c` (tag `foundation/task-001-complete`). Sibling task branches are not merged here.

## Exports Provided

Wire these from `packages/planner/src/scheduler/index.ts`:

- `HeftCriticalPathScheduler` — upward rank `rank_u(t) = avg_exec_time(t) + max_s(comm_delay(t, s) + rank_u(s))`, list scheduling, and the projected makespan `{ criticalPathMinutes, parallelSpeedupFactor, activeSlotsByTime }` plus the wall-clock summary.
- `WaveParallelismCalculator` — `W_eff = min(dag_disjoint_width, hardware_pool_cap, provider_pacing_cap, worktree_slot_cap, user_preset_cap)`. Orange forces the hardware term to at most 1. A pure chain reports `Sequential dependency chain — 1 worker active`.
- `CrewPresetProfileEngine` — `Fastest` (no preset cap, principal on the critical path, pre-warm wave N+1), `Balanced` (cap 5, senior on critical-path and complex tasks), `Cheapest` (cap 3, minimum expected cost, same-feature batching, subscription before paid).
- `DynamicScheduleRebalancer` — recomputes rank and the next dispatch on retry, hold, governor pressure, provider pacing, and preset switch. In-flight turns are never aborted.
- `ParallelWaveDispatcher` — admits disjoint ready leaves onto `harness/f/<feature-slug>` with one active task per feature worktree.

`schedule()` returns levels, the parallelism decision, the projection, and a Fastest-only `prewarmNextWave` intent (`{ waveIndex, featureIds, reason: "fastest-preset-jit" }`).

## Shared Wiring Needs (Root / Index Barrels)

`packages/planner/src/index.ts` is frozen. Add this re-export when the integrator lands the branch:

```ts
export {
  CrewPresetProfileEngine,
  DynamicScheduleRebalancer,
  HeftCriticalPathScheduler,
  ParallelWaveDispatcher,
  WaveParallelismCalculator,
} from "./scheduler/index.js";
export type {
  CrewPreset,
  DispatchAssignment,
  LiveScheduleState,
  ParallelismDecision,
  RebalanceEvent,
  ScheduleGraph,
  ScheduleProjection,
  ScheduleResult,
  ScheduleTask,
} from "./scheduler/index.js";
```

No root `package.json` or workspace change.

## Dependency Intents (New Packages Requested)

None. The scheduler uses the existing `@ef-harness/planner` toolchain only.

## Contract Change Requests

Sibling packages are not on this base. The scheduler talks to them through local ports. Replace the adapters; do not keep the local copies once the real barrels exist.

| Needed sibling | This branch | Swap |
| --- | --- | --- |
| Task 020 `TaskLeaseManager.claimTask` (the task text says `TaskClaimManager`) | `TaskClaimManagerPort` in `ports.ts` | Pass `{ task, attemptId, expectedBrief, expiresAt, rev, runtime, model, connection, baseCommit, now }`. Refusal reasons stay `not_ready \| held \| dependency_open \| brief_stale \| sweep_overlap \| lost_race`. `featureBranch` and `writeScope` are extra fields the lease manager does not store; the dispatcher already checked them. |
| Task 021 `TaskHoldAndSubmissionRepo` | `TaskHoldsManagerPort` | `placeHold` / `releaseHold` / `isTaskHeld` / `listActiveHolds`. Reasons are `user_pause \| requirement_change \| budget \| ccr \| governor`. A hold on an in-flight task yields the slot and does not abort the turn. |
| Task 092 `WriteScopeDisjointnessChecker` | `writeScopesOverlap` / `scopeHitsLease` | Windows ASCII case-fold and `**` containment. Overlap with a `path_leases` prefix (`intent` or `granted`) refuses the claim. |
| Task 095 `SequentialBuildRunner` | not edited (outside this subtree) | Call `ParallelWaveDispatcher` for M3 waves. M2 sequential dispatch stays the one-worker path. |
| Task 106 `ExpectedCostLevelSelector` | `ExpectedCostLevelSelectorPort` + `LocalExpectedCostLevelSelector` | Inject the real selector. The local one minimizes `unit_cost / P(pass)`, floors `auth` / `payments` / `destructive_migration` / `cross_feature_conflict` / `oracle-author@1` at senior, bumps Balanced critical-path and complex tasks to senior, assigns Fastest critical-path tasks to principal, and escalates one level per hint step at Hint 2+. |
| Task 118 governor | `GovernorPressure` on `LiveScheduleState` | `Green` uses the hardware cap. `Yellow` uses `min(cap, max(1, floor(cap / 2)))`. `Orange` uses `min(cap, 1)`. |
| Task 140 pacing | `ProviderConnection[]` | `provider_pacing_cap` is the sum of `pacingSlots` on authorized, unthrottled, unexhausted connections. |
| Task 141 no silent paid fallback | `paidFallbackApproved` | A `paid_api` connection is usable only when the flag is true. If every other connection is exhausted, the rebalancer parks with `Waiting for reset / Switch connection`. |

Preset caps follow the kitchen illustration in `planning-and-crew.md`: Fastest has no extra cap, Balanced is 5, Cheapest is 3. `developerMax` tightens the preset cap further.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-107-heft-scheduler-crew-presets`.

- `pnpm --filter @ef-harness/planner typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/planner lint` — pass (`eslint .`).
- `pnpm --filter @ef-harness/planner test -- scheduler` — pass, 4 files, 21 tests. Covers the HEFT formula, FIFO makespan, `>= 2×` kitchen speedup at 50 and 500 tasks, chain cap, five-way `W_eff`, three distinct presets, hold slot fill, Orange scale-down, hint-2 critical-path escalation, preset switch without abort, subscription routing, paid-fallback park, scope and feature isolation, explicit boost, aging, and Cheapest feature batching.
- `node scripts/verify-harmony.mjs --task 107` — pass (`harmony ok for Task-107`).

## Known Limitations / Follow-Ups

- Upward rank and dispatch selection are `O(V + E)` plus a ready-set sort. On a warmed 500-task kitchen graph the rebalance median and 90th percentile stay under 10 ms. A single cold or GC sample can exceed that; the test measures a warmed loop.
- DAG width is the largest set of features that can run at once: one slot per feature worktree, no dependency path either way, and disjoint write scopes. It is cached on the graph object. Exec-time overrides do not invalidate it.
- Communication delay is part of `rank_u` and of the projected timeline. A live completion event claims newly ready successors at the event timestamp.
- Cache batching never outranks the critical-path band. Same-feature affinity is a tie-break, plus a 5-minute bonus for non-critical siblings. The explicit-decision boost is 30 minutes and applies only off the critical path. Aging adds 1 minute per skipped dispatch.
- An empty connection list means pacing is not wired yet, so the scheduler does not park. A non-empty list with no usable connection does park.
- `packages/planner/src/index.ts` is intentionally untouched. The barrel block above is the integrator's wiring step.
