---
task_id: "Task-119"
branch: "task/119-three-pool-capacity-scheduler"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/governor/src/capacity-pools/**"
  - "packages/governor/tests/capacity-pools/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 119 handoff

Three-pool execution capacity scheduler for M3. Thinking stays wide, warm execution stays at 2–4 slots, foreign CLI sessions stay under a resident cap, and heavy disk writes share one lane. This branch was created from `649773097c387ae534b686ea5825f449f843aa7c` (tag `foundation/task-001-complete`). Sibling task branches are not merged here.

## Exports Provided

Wire these from `packages/governor/src/capacity-pools/index.ts`:

- `ThreePoolCapacityScheduler` — admits thinking, leases Pool 2, applies governor pressure, and exposes `snapshot()` for the Board and Office.
- `ThinkingPoolCoordinator` — Pool 1. Default width is 12 at `<= 16 GB`, 16 between 16 and 32 GB, and 20 at `>= 32 GB`. Each admitted agent accounts for `8 MB` and `0` local CPU while waiting on a provider. Admission does not provision a sandbox.
- `WarmExecutionSlotPool` — Pool 2. Warm inventory is 2 at `< 32 GB`, 3 from 32 GB up to 64 GB, and 4 at `>= 64 GB`. Grants are ordered `verifier > worker > background`. A worker's aging boost reaches `maxWaitBoost` at 60s and then outranks a fresh verifier. `deadlineAt = acquiredAt + timeoutMs`; queue wait is not subtracted.
- `SessionProcessCapGuard` — Pool 3. Cap is 4 below 32 GB and 8 at 32 GB and above. `spawn` checkpoints the longest-idle idle session before the new session is inserted. `enforceCeiling` parks until `active <= cap`.
- `SingleDiskWriteLane` — one async lane for `git_worktree_add`, `git_worktree_reset`, `pnpm_install`, `pnpm_hardlink_unpack`, `sqlite_vacuum`, `sqlite_backup`, `cas_gc`, and `brownfield_index`. New entries pause after disk active time stays at or above 80% for 10s. The in-flight op is not cancelled.
- `TierERemoteExecutionInterface` plus `ExecutionSlotBackend` — `provisionSlot`, `syncDiff`, `execCommand`, `streamOutput`, `collectArtifacts`, `releaseSlot`, `costEstimate`. Cost is `{ currency: "usd", amount }`. v1 constructs `LocalExecutionSlotBackend` and rejects `locality: "remote"` unless `allowRemoteBackend` is true.

`snapshot()` returns `thinkingCount`, `waitingForRunSlotCount`, `runningSlotCount`, `slotOwnerTaskIds`, and `waiterStatuses` whose status string is exactly `Waiting for run slot`.

`executionTargetFor` is the live lease cap: Green = warm inventory, Yellow = `max(1, warm - 1)`, Orange = 1, Red = 0. Disk under 2 GB also forces 0. Lowering the target does not cancel an in-flight lease. The forward-progress floor is that one slot while pressure is not Red and free disk is at least 2 GB.

`hardwarePoolCap()` is the warm inventory (2–4) for Task 107. It is not the pressure-reduced target.

A Pool 2 release closes the nested job and marks the slot reusable only when `activeChildCount` is 0. Otherwise the slot stays dirty until `auditExecutionSlots()`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/governor/src/index.ts` is frozen. Add this re-export when the integrator lands the branch:

```ts
export {
  LocalExecutionSlotBackend,
  SessionProcessCapGuard,
  SingleDiskWriteLane,
  ThinkingPoolCoordinator,
  ThreePoolCapacityScheduler,
  TierERemoteExecutionInterface,
  WarmExecutionSlotPool,
} from "./capacity-pools/index.js";
export type {
  CapacitySnapshot,
  ExecutionLease,
  ExecutionRequest,
  ExecutionSlotBackend,
  GovernorPressure,
  LeaseRole,
  ThinkingPermit,
} from "./capacity-pools/index.js";
```

No root `package.json`, workspace, or tsconfig change.

## Dependency Intents (New Packages Requested)

None. The scheduler uses the existing `@ef-harness/governor` toolchain only.

## Contract Change Requests

Sibling packages are not on this base. The scheduler talks to them through local ports. Replace the adapters; do not keep the local copies once the real barrels exist.

| Needed sibling | This branch | Swap |
| --- | --- | --- |
| Task 038 `WorktreeSlotPool` (`acquireSlot`, `resetSlotForAttempt`, `releaseSlot`) | `WorktreeSlotPoolPort.bindForCommand` / `unbindCommand` | Bind the attempt's already acquired slot for one command. Do not recycle the worktree on `unbindCommand`. `resetSlotForAttempt` stays with the attempt lifecycle. |
| Task 043 `SandboxTierSelector` (Task 119's text says Task 045) | `SandboxTierSelectorPort.selectTier` | Return `{ tier, hold, reason, unsandboxedOverride }`. `hold: true`, or `UNSANDBOXED` without `unsandboxedOverride`, rejects with `SandboxHoldError` and does not take a slot. |
| Task 107 `WaveParallelismCalculator` | `WaveParallelismCalculatorPort.effectiveConcurrency` | Thinking width is `min(ramThinkingCap, dagDisjointWidth, providerPacingCap)`. This branch passes `hardwarePoolCap`, `worktreeSlotCap`, and `userPresetCap` as `Number.MAX_SAFE_INTEGER` so Pool 2's width does not collapse thinking. Feed `hardwarePoolCap()` back into Task 107 as the hardware term; Task 107 still applies its own Orange reduction. |
| Task 118 `PressureHysteresisStateMachine` | `setPressure("Green" \| "Yellow" \| "Orange" \| "Red")` and `PressureHysteresisPort` | This scheduler only reads the level. It does not implement the 10s/30s debounce. |
| Task 118 `HeavyLaneSemaphore` | `HeavyLaneSemaphorePort` | Heavy classes are `tsc`, `playwright`, `build`, and `migrate`. The permit is acquired after the Pool 2 lease. The owned in-memory semaphore uses 1 permit at `<= 16 GB` or Yellow/Orange/Red, and 2 at `>= 32 GB` Green. An injected semaphore is not resized. |
| Task 041 nested Job Object | `WindowsJobObjectPort.createNestedJob` / `close` / `activeChildCount` | Close on finish, timeout, and STOP. Reuse the slot only at 0 children. |
| Task 150 `IdleWrappedAgentAutoParker` | `IdleWrappedAgentParkerPort.checkpointAndPark` | Called with `reason: "session_process_cap"` before the new foreign session becomes active. Park only sessions that are not `busy`. |
| Task 124 / Task 163 | `CapacitySnapshot` | Read `thinkingCount`, `waitingForRunSlotCount`, `runningSlotCount`, `slotOwnerTaskIds`. Queued tasks use `Waiting for run slot`. |
| Task 048 `harness.run` | `acquireExecution` / `runExecution` | Lease only around the command. Release returns the attempt to the thinking phase. STOP while queued rejects `AbortError`, drops the waiter, and releases the thinking slot. No ghost lease is created. |
| Task 188 | `hardwarePoolCap()` and `executionTarget()` | Multi-project sharing should consume the warm inventory and the live target. This branch does not merge projects. |

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-119-three-pool-capacity-scheduler`.

- `pnpm --filter @ef-harness/governor typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/governor lint` — pass (`eslint .`).
- `pnpm --filter @ef-harness/governor test -- capacity-pools` — pass, 3 files, 27 tests. Covers 12 simultaneous `pnpm test` calls on a 2-slot laptop, verifier-over-worker ordering, 75s worker aging against five verifiers, the under-60s verifier win, critical-path tie-break, STOP while queued, timeout starting at lease grant, job-object quarantine, sandbox hold, heavy-lane wait, 16 thinking workers on 2 slots, Green → Orange → Red → Green drain without killing in-flight runs, session cap parking (6 resident, cap 4, 600 MB reclaimed), disk-lane overlap of 0, the 80%/10s disk pause, and the Tier E mock cycle.
- `node scripts/verify-harmony.mjs --task 119` — pass (`harmony ok for Task-119`).

## Known Limitations / Follow-Ups

- RAM defaults inside the gaps: thinking is 16 between 16 GB and 32 GB; execution stays 2 below 32 GB, 3 from 32 GB until 64 GB, and 4 at 64 GB and above. Session cap is 4 below 32 GB and 8 at 32 GB and above (the task text, not the provisional 2/5 in `execution-capacity.md`).
- Yellow and Orange keep the priority queue. They do not hard-ban workers. Background still runs when no verifier or worker is waiting. The app-shell line "admit nothing new except verifiers" stays with the pressure state machine if that stricter rule is required later.
- Red and disk under 2 GB stop new leases. In-flight Pool 2 commands are not killed. Task 118 still owns any restartable-process kill policy.
- Heavy-lane waiting happens after the Pool 2 lease, so that wait sits inside the command timeout. Time spent queued for Pool 2 does not.
- `packages/governor/src/index.ts` is intentionally untouched. The barrel block above is the integrator's wiring step.
