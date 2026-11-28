---
task_id: "Task-150"
branch: "task/150-foreign-runtime-checkpoint-resume"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/runtime-adapters/src/resume/**"
  - "packages/runtime-adapters/tests/resume/**"
  - ".agent-handoffs/task-150.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 150 handoff

Foreign runtime checkpoint and session-resume coordinator. Native resume is used only when the adapter supports it, the delta is none or strictly additive, the CLI version is compatible, and `resume()` succeeds. Every other case rebuilds a fresh session with an explicitly labeled unverified WIP diff. Idle wrapped CLI processes checkpoint and terminate at 90 seconds, or immediately when the session-process cap needs a slot. Commit stays on `task/150-foreign-runtime-checkpoint-resume`.

## Exports Provided

Public module: `packages/runtime-adapters/src/resume/index.ts`.

Required by Task 119, Task 128, and Task 151:

- `ForeignRuntimeResumeCoordinator` — persist, resume, `switchConnection`, idle sweep, cap eviction, wake, and `onChildCrash`
- `LabeledWipFreshSessionRebuilder` — fresh session, `[PRIOR UNVERIFIED WIP]` handoff (`<= 1,500` tokens), contradictory wipe versus labeled keep
- `IdleWrappedAgentAutoParker` — `checkpointAndPark` matches Task 119 `IdleWrappedAgentParkerPort`

Also exported from the same module:

- `createForeignRuntimeResumeCoordinator`
- `SqliteAttemptCheckpointStore`, `FOREIGN_RUNTIME_CHECKPOINT_KEY`
- `LocalDirtySnapshotEngine`, `LocalGitTreeSafety`
- `LocalAdditiveVsContradictoryResumer`, `classifyDelta`
- `AttemptMutex`, `ManualClock`, `OsChildProcesses`, `ScriptedChildProcesses`
- `PRIOR_UNVERIFIED_WIP`, `PRIOR_UNVERIFIED_WIP_HEADER`, `IDLE_PARK_AFTER_MS` (`90_000`), `WIP_HANDOFF_TOKEN_LIMIT` (`1_500`), `CONTEXT_FRESH_SESSION_ABOVE` (`0.8`), `LARGE_WIP_FILE_BYTES` (`2_097_152`)
- `autoParkTimeline`, `nativeResumeTimeline`, `freshSessionTimeline`, `estimateTokens`

Native Codex success records `Resumed cleanly via native thread/resume`. A Claude Code switch records `Switched to fresh Claude Code session with labeled WIP diff`. Idle park records `Auto-parked idle Codex process (freed <ram> MB RAM)`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/runtime-adapters/src/index.ts` is outside this task's owned write scope. Re-export the resume surface from that barrel during integration:

```ts
export {
  ForeignRuntimeResumeCoordinator,
  IdleWrappedAgentAutoParker,
  LabeledWipFreshSessionRebuilder,
  LocalAdditiveVsContradictoryResumer,
  LocalDirtySnapshotEngine,
  LocalGitTreeSafety,
  SqliteAttemptCheckpointStore,
  createForeignRuntimeResumeCoordinator,
  IDLE_PARK_AFTER_MS,
  PRIOR_UNVERIFIED_WIP,
  WIP_HANDOFF_TOKEN_LIMIT,
} from "./resume/index.js";
export type {
  AttemptCheckpointStore,
  CompiledBrief,
  ForeignRuntimeCheckpoint,
  ParkRequest,
  ParkResult,
  ResumeOutcome,
} from "./resume/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or `schema/state.sql` edits.

Sibling branches are not on this base (`649773097c387ae534b686ea5825f449f843aa7c`). Swap these local ports at integration. Do not import the unpublished packages as if they were already on `harness/integration`.

- `LocalDirtySnapshotEngine.capture` swaps for Task 037 `SnapshotManager.createDirtyWorkSnapshot` / `createCheckpointWipCommit`. It already uses a temporary `GIT_INDEX_FILE` outside the repo and checks that `.git/index` is unchanged. Map `treeSha` to `SnapshotResult.treeSha` and `modifiedFiles` to the dirty path list.
- `LocalGitTreeSafety` swaps for the Task 037 / Task 038 git helpers that `cat-file` a tree, `merge-tree --write-tree` when `harness/integration` has moved, and materialize into a fresh slot. A missing object or a conflict starts from the integration tree and records a diff note.
- `SqliteAttemptCheckpointStore` swaps for Task 053 `AttemptCheckpointStore` on the real `state.db`. This branch writes the frozen `attempt_checkpoints` columns and stores the rich row in `contract_versions.foreignRuntimeCheckpoint`. `wip_ref` is `wipTreeSha`. `session_ref` is `nativeSessionId`. `handoff_artifact` is the labeled WIP text. `pending_effects` stays `[]`. A stub `attempts(id)` row is inserted only when `ensureAttemptRow` is true (the default for the local database).
- `LocalAdditiveVsContradictoryResumer` swaps for Task 115 `AdditiveVsContradictoryResumer`. `classifyDelta` uses the same slice, requirement-removal, and REST/GraphQL, SQLite/Postgres, and 11:00/10:00 swap rules. An explicit `deltaType` on `resume()` still wins.
- `IdleWrappedAgentAutoParker.checkpointAndPark({ sessionId, runtime, residentRamMb, idleMs, reason: "session_process_cap" })` is the Task 119 `IdleWrappedAgentParkerPort` callback. `sessionId` may be the attempt id or the native session id passed to `observe`. The guard should call `ForeignRuntimeResumeCoordinator.evictForCapacity` when a wake can race the park; the synchronous `checkpointAndPark` is the direct port.
- `ForeignAdapterPort.resume` / `startSession` swap for Task 142 `AgentRuntimeAdapter` (`resume(sessionId, checkpointRef)`, `startSession`) and the Task 144–149 adapters. Codex `thread/resume`, Claude `--resume`, ACP `session/load`, and Copilot/Cursor session resume are the native path. `native-worker-loop` is the Task 053/057 worker loop on a switch. `IdentityBriefCompiler` swaps for Task 088. `WorktreeSlotPort.reset` swaps for Task 038 and runs only after the crash snapshot is stored.

## Dependency Intents (New Packages Requested)

None. Checkpoints use `node:sqlite`. Git uses the system `git` binary through `spawnSync` (`shell: false`).

## Contract Change Requests

None. `schema/state.sql` is frozen. The logical checkpoint (`attemptId`, `adapterId`, `adapterVersion`, `nativeSessionId`, `pinnedBaseCommitSha`, `pinnedSliceSha256`, `wipTreeSha`, `modifiedFiles`, `lastStepSummary`, `lastVerificationError`, `parkedAt`, `parkReason`, plus resume-failure and timeline fields) is stored in `attempt_checkpoints.contract_versions` under `foreignRuntimeCheckpoint`. Add first-class columns later only if Task 014 wants them; readers can keep using the JSON key until then.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-150-foreign-runtime-checkpoint-resume`:

- `pnpm --filter @ef-harness/runtime-adapters typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/runtime-adapters lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/runtime-adapters test -- resume` — pass. Vitest v5.1.1, 1 file, 9 tests, exit 0, about 55s. Covers identical and additive native `thread/resume`, an unchanged `.git/index` SHA-256 across a temp-index snapshot, contradictory REST-to-GraphQL rebuild (native resume not called, contradicted file wiped, non-conflicting file labeled), CLI `1.2.3` to `2.0.0` skipping native resume, one `Session format incompatible` failure then fresh-session rebuild with `disableNativeResumeForAttempt` so attempts 2 and 3 do not call `resume()`, context at `0.8` staying native and `0.81` going fresh, Codex to Claude Code / OpenCode / Copilot / Cursor / Native Worker Loop carrying the same `wipTreeSha` and `[PRIOR UNVERIFIED WIP]`, a 2 MB file summarized by path and line count inside 1,500 tokens, real OS process termination at 90,000 ms and immediate cap eviction with `Auto-parked idle Codex process (freed 280 MB RAM)`, park-versus-wake serialization in both orders, `SIGKILL` / exit 137 salvage of three files before slot reset, a clean `merge-tree` when integration advanced, a conflict falling back to the fresh base, a missing tree object, atomic rollback of a failed checkpoint transaction, and a 30 ms hung `resume()` timeout.
- `node scripts/verify-harmony.mjs --task 150` — pass (`harmony ok for Task-150`, exit 0). The script also ran root `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- Consumers cannot import the coordinator from `@ef-harness/runtime-adapters` until the barrel lines above are applied. Until then import `packages/runtime-adapters/src/resume/index.ts` only inside this package.
- Task 037, Task 053, Task 088, Task 115, Task 119, Task 142, and Tasks 144–149 are not in this foundation base. The local ports above are the integration swap.
- `SqliteAttemptCheckpointStore` creates `attempts(id)` and the frozen `attempt_checkpoints` shape if they are missing. On a real `state.db`, construct it with `ensureAttemptRow: false` so the existing attempt row satisfies the foreign key.
- A contradictory delta does not set `disableNativeResumeForAttempt`. Only a failed native call, a resume timeout, or a known-incompatible CLI version does. Unsupported adapters skip the call without counting a failure.
- Same-adapter fresh fallbacks say `Rebuilt a fresh <runtime> session with labeled WIP diff`. The `Switched to fresh ...` sentence is reserved for a real adapter change.
- The synchronous `checkpointAndPark` does not wait on the async attempt mutex. `sweepIdle`, `wake`, and `evictForCapacity` do. Wire Task 119's spawn path to `evictForCapacity` when a user answer can arrive on the same turn.
