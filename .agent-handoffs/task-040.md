---
task_id: "Task-040"
branch: "task/040-windows-job-objects"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/sandbox/src/job-objects/**"
  - "packages/sandbox/tests/job-objects/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 040 handoff

Nested Windows Job Object manager, per-job resource accounting, wall-clock timeouts, `env_processes` registration, and the positive-identity startup orphan sweep. Commit stays on `task/040-windows-job-objects`.

## Exports Provided

Import from `packages/sandbox/src/job-objects/index.ts` until the sandbox barrel is wired:

- `WindowsJobManager` — `createJob`, `assignProcess`, `spawnInJob` (suspended, then assigned, then optionally resumed), `queryJobAccounting`, `terminateJob`, `closeJob`, `runCommand`, `reconcileOrphanedProcesses`, `dispose`
- `JobHandle` — id, name, kind (`project` | `environment` | `attempt` | `command`), parent, effective and requested limits
- `JobLimits` — `memoryBytes`, `activeProcessLimit`, optional `cpuRatePercent`
- `JobAccounting` — integer byte and CPU-millisecond counters from `JobObjectBasicAccountingInformation`, `JobObjectExtendedLimitInformation`, and memory usage, plus kill-on-close, UI-handle restriction, memory-limit, and active-process-limit flags
- `reconcileOrphanedProcesses` — kills a row only when live `(pid, start_time)` matches; pid reuse drops the stale row and logs a warning; unverified ownership is left intact and logged
- `ProcessIdentityVerifier` — `GetProcessTimes` / image / command-line comparison used by the sweep
- `ProcessSupervisor` — shared contract also implemented by `PosixProcessGroupSupervisor` (`detached: true`, kill by negative process-group id)
- `JobObjectError`, `CommandRequest`, `CommandResult`, `EnvProcessRow`, `OrphanSweepReport`

`runCommand` opens a nested `command` job and closes it when the main process exits (`TerminateJobObject` plus `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`), so detached grandchildren die with the command. Long-running servers stay on the environment job.

## Shared Wiring Needs (Root / Index Barrels)

`packages/sandbox/src/index.ts` is outside this task's owned scope. When integrating, re-export `WindowsJobManager`, `JobHandle`, `JobLimits`, `JobAccounting`, `reconcileOrphanedProcesses`, `ProcessIdentityVerifier`, and `ProcessSupervisor` from that barrel for Tasks 041–043, 047, 049–050, and 117.

No root `package.json` change. The Win32 helper is compiled on first use with `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` and cached under `%TEMP%\ef-harness-win32-job-helper` by source hash.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None.

`WindowsJobManager` consumes a structural `ProjectStateDb` port (`insertEnvProcess`, `insertEnvProcesses`, `deleteEnvProcess`, `listEnvProcesses`, `close`) over `state.db.env_processes` columns `(pid, start_time, environment, role, port, job_name)` from `schema/state.sql`. Pass Task 013's database through an adapter, or pass `stateDbPath` and the included `SqliteProjectStateDb` will create that table.

`StructuredLogger` is the Task 011 port (`debug`, `info`, `warn`, `error`). The default `JsonLineLogger` writes one JSON line per event. Pass Task 011's logger when it is available; `CapturingLogger` is for tests.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-040-windows-job-objects`.

`pnpm --filter @ef-harness/sandbox test -- job-objects`

```
Test Files  2 passed (2)
     Tests  17 passed (17)
Duration  12.87s
```

Covers nested kill-on-close, UI handle restrictions, CPU rate, clamped nested limits, suspended assign-before-resume, detached and `start /b` grandchildren, environment service survival across command-job close, active-process cap 8, `memory_limit_exceeded`, wall-clock `timeout` with partial stdout and integer accounting, pid+start_time orphan kill, pid-reuse refusal, flat native handle count across 200 spawn/close cycles, helper death, and parent-process exit. Contract tests cover the POSIX process-group fallback and the documented pid 4812 reboot case.

`pnpm --filter @ef-harness/sandbox typecheck`

Exit 0. `tsc -b --pretty false` completed with no diagnostics.

`pnpm --filter @ef-harness/sandbox lint`

Exit 0. `eslint .` completed with no diagnostics.

`node scripts/verify-harmony.mjs --task 040`

Exit 0. `harmony ok for Task-040` (includes schema, diagrams, owned-path scope, repo `typecheck`, `lint`, and `test`).

## Known Limitations / Follow-Ups

Windows returns `ERROR_NOT_SUPPORTED` (50) if a nested job tries to store `JobObjectBasicUIRestrictions` after an ancestor already has them, and those ancestor limits cannot be cleared. Nesting assigns a suspended bootstrap process from the outermost job inward and does not clear UI limits. Every process in a child job remains a member of its ancestors, so the ancestor's `JOB_OBJECT_UILIMIT_HANDLES` and `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` still apply. `queryJobAccounting` reports that effective UI restriction.

The POSIX adapter satisfies `ProcessSupervisor` for unit tests and future Linux/macOS hosts. It does not invent Win32 accounting, and its orphan sweep will not kill a pid when start time cannot be verified.

Live kernel tests run only when `process.platform === "win32"`. On other hosts they are skipped and the contract tests still run.
