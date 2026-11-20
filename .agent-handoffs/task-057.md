---
task_id: "Task-057"
branch: "task/057-worker-loop-executor-checkpoints"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/worker-loop/src/executor/**"
  - "packages/worker-loop/tests/executor/**"
  - ".agent-handoffs/task-057.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 057 handoff

Native worker loop: sequential step executor, per-step `turn_log` + WIP checkpoint, four-point crash recovery, spiral and stall guards, prose and premature-done nudges, boundary hold/steer/pause, code-generated handoff notes, and formatter-at-submit. Commit stays on `task/057-worker-loop-executor-checkpoints`.

Import from `packages/worker-loop/src/executor/index.ts` until the package barrel is wired. Sibling tasks 020, 021, 023, 034, 037, 048, and 053–056 are not on this base. Their contracts are local ports below.

## Exports Provided

Required by Task 068, Task 095, Task 128, and Task 150:

- `NativeWorkerLoop` — `runAttempt(attemptId)`, `resumeAttemptFromCheckpoint(attemptId)`, `pauseAtBoundary(attemptId)`, `stopImmediately(attemptId)`, `deliverSteer(attemptId, steer)`
- `AttemptExecutionResult` — `outcome` is `submitted | parked | waiting_input | stuck | budget_exhausted | fenced | blocked`; `state` is the attempt row state (`submitted`, `fenced`, or `parked`); `countsAsFailedAttempt` and `countsAsWorkerFailure` stay false for budget, usage-limit, stall, rate-limit, blocked, stuck, and pause exits
- `generateHandoffNote` — deterministic JSON from brief version, working-memory plan/done items, changed files, and last check results. `generatedBy` is `"code"` and `llmTokens` is `0`

Also exported from the same module for tests and the integrator: `LocalSixZoneContextBuilder`, `MemoryAttemptCoordinator`, `reconstructProviderItems`, `collectModelTurn`, `CrashInjectedError`, `LocalTurnFailure`, `STREAM_STALL_MS` (`60000`), `JUNIOR_MAX_STEPS` (`40`), `SENIOR_MAX_STEPS` (`80`), `REPEAT_TOOL_LIMIT` (`3`), `NO_PROGRESS_STEP_LIMIT` (`8`), `NATIVE_TOOL_CATALOG`, and the port types.

`NATIVE_TOOL_CATALOG` is read, edit (`apply_patch`, `str_replace`, `search_replace`, `write_new_file`, `replace_lines`), `harness.run`, `harness.read_log`, `notes.update`, `harness.ask_owner`, `harness.flag_blocked`, `harness.dispute_test`, `harness.submit_candidate`, and `kb.search|get|neighbors|contract|why|code`. Subagent names are rejected even if a packet lists them.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/worker-loop/src/index.ts` on this branch. When integration wires the barrel, add:

```ts
export {
  CrashInjectedError,
  JUNIOR_MAX_STEPS,
  LocalSixZoneContextBuilder,
  LocalTurnFailure,
  MemoryAttemptCoordinator,
  MODEL_CALL_RESERVE_UNITS,
  NATIVE_TOOL_CATALOG,
  NO_PROGRESS_STEP_LIMIT,
  NativeWorkerLoop,
  REPEAT_TOOL_LIMIT,
  SENIOR_MAX_STEPS,
  STREAM_STALL_MS,
  SUBAGENT_TOOL_NAMES,
  collectModelTurn,
  emptyWorkingMemory,
  generateHandoffNote,
  reconstructProviderItems,
} from "./executor/index.js";
export type {
  AttemptExecutionResult,
  AttemptRecord,
  BudgetLedgerPort,
  CheckpointRow,
  CheckpointSnapshotPort,
  ContextBuilderPort,
  CrashInjectorPort,
  CrashPoint,
  EditToolDispatcherPort,
  HandoffNote,
  ModelProfileView,
  ModelStreamPort,
  ModelTurnRequest,
  NativeWorkerLoopDependencies,
  PendingEffect,
  ProviderItem,
  SteerNotice,
  TaskPacketView,
  TerminalOutcome,
  ToolCall,
  TurnLogRow,
  WorkingMemory,
} from "./executor/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, schema, or `packages/shared-contracts/src/index.ts` edit. This task adds no dependency.

Construct `NativeWorkerLoop` with the ports in `NativeWorkerLoopDependencies`. Every model request is sent with `store: false`. Reserve `MODEL_CALL_RESERVE_UNITS` (1000) across scopes with `purpose: "model_call"` before `stream`, settle `tokensIn + tokensOut` immediately after a completed turn, and pass `stallTimeoutMs: 60000`. After each tool, call `createCheckpointWipCommit` (it reuses the previous WIP ref when the tree is unchanged) and write the `turn_log` row plus `attempt_checkpoints` (`step`, `wip_ref`, `contract_versions`, `pending_effects`, `handoff_artifact`, `session_ref: null`) in one `AttemptCoordinator.transaction`. Provider items, including encrypted reasoning blobs, go to CAS under `cas:<attempt>:<requestDigest>` and are what `reconstructProviderItems` replays. `session_ref` stays null because the conversation is rebuilt from `turn_log` + CAS.

Formatter `format(inScopePaths)` runs only inside the `harness.submit_candidate` path, after edits and before the submit snapshot. Paths outside `write_scope` are not passed to the formatter.

Terminal mapping: `submitted` keeps state `submitted`; a mismatched `liveEpoch` returns `fenced`; budget exhaustion returns outcome `budget_exhausted` and state `parked`; usage limit, stream stall, hard steer, hold, user pause, and immediate stop return outcome `parked`; spiral guards (`max_steps`, `repeat_tool`, `no_progress`, `malformed_tool`, `prose_only`, `premature_done`, `edit_recovery`) return outcome `stuck` and state `parked`; `harness.flag_blocked` returns outcome `blocked`, `routedTo: "AskOwner"`, and does not count as a failed attempt. `harness.ask_owner` and `harness.dispute_test` return `waiting_input`.

Crash cursor lives in `attempt_checkpoints.pending_effects`:

- `model_in_flight` — crash during the model call. The reservation is `unknown`. Resume reconciles it, rebuilds the same request from `turn_log`, and calls the model.
- `response_recorded` — response and tool calls are durable, tools have not run. Resume executes those calls and does not call the model again.
- `tool_in_flight` / `tool_done_unlogged` — reset the worktree to the last `wip_ref` (base tree when the ref is null) and redo that tool index.

Parallel tool calls in one assistant message run strictly in order. The cursor stores `nextToolIndex`, and epoch, holds, pause, and steers are checked before every tool. A crash on tool 2 resumes at that index.

`deliverSteer` with `kind: "hard"` or `compatible: false` checkpoints and yields. An additive compatible steer is injected into the next request and an edit is refused until the assistant text acknowledges it (`acknowledged` or `ack:<id>`). `pauseAtBoundary` yields at the next model-call or tool boundary. `stopImmediately` aborts the in-flight model call and releases the reservation when no tokens were settled.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None. `schema/state.sql` was not edited.

`turn_log` columns match the schema (`attempt`, `step`, `request_digest`, `items_artifact`, `tool_call`, `result_summary`, `result_artifact`, `checkpoint_commit`, `tokens_in`, `tokens_out`). `attempt_checkpoints` columns match too. Repeat, malformed, prose, and premature-done counts are derived from `result_summary` prefixes (`malformed:`, `prose_reminder:`, `done_reminder:`). The no-progress streak and per-digest stall count sit on the in-memory attempt (`progressStreak`, `progressTree`, `progressFingerprint`, `stallsByDigest`) because the frozen schema has no guard columns. Persist that `LoopGuardState` beside the checkpoint when wiring SQLite. Rate-limit and stall rows are not written, so they do not consume a step or a stuck counter.

Replace the local ports when the sibling branches land. Do not import those packages on this base.

| Local port | Replace with |
|---|---|
| `ModelStreamPort.stream` + `collectModelTurn` | Task 053 `ModelProtocolAdapter.stream`. Map `StreamEvent` into the local event union. `stream_stall` / `StreamStallError` is the 60s no-token watchdog. `unknown_timeout` / `UnknownOutcomeTimeoutError` marks the reservation unknown. `rate_limit` uses `retryAfterMs` and `isProviderSchedulingError`. `usage_limit` parks. Duck-typing reads `kind` and `partialUsage.inputTokens` / `outputTokens`, so Task 053 `NormalizedModelError` can be thrown through without this package importing it. |
| `LocalSixZoneContextBuilder` | Task 054 `WorkerContextBuilder.buildRequest`. On `task_too_large_for_model` or `park_after_context_overflow`, park and do not call the model. On provider `context_overflow`, the loop sets `overflowRetried` and builds once more, then parks. A contradictory brief (`briefChangedContradiction`) rebuilds from the new brief plus a labeled WIP diff and does not replay older `turn_log` items. |
| `NotesUpdatePort` | Task 054 `WorkingMemoryStore` (`notes.update`). The loop stores the returned snapshot on the attempt and feeds it to `generateHandoffNote`. |
| `WindowedFileReaderPort` | Task 055 `WindowedFileReader.readFile` / `listFiles` / `grepFiles`. |
| `ReadLogPort` | Task 055 `ReadLogTool.readLog` (`harness.read_log`). |
| `EditToolDispatcherPort` | Task 056 `EditToolDispatcher.applyPatch` / `strReplace` / `searchReplace` / `writeNewFile` / `replaceLines`. An `EditStuckEscalation` (`error.name`) checkpoints and returns `stuck` / `edit_recovery`. The loop does not format inside the edit path. |
| `BudgetLedgerPort` | Task 023 `BudgetLedgerRepo.reserveAcrossScopes`, `settleReservation`, `releaseReservation`, `markReservationUnknown`, `reconcileUnknownReservation`. `listUnknownReservations` and `getSpentUnits` are the small queries the loop needs around those methods. |
| `CheckpointSnapshotPort.createCheckpointWipCommit` | Task 037 `SnapshotManager.createCheckpointWipCommit`. Ref shape `refs/harness/checkpoints/<attempt>/<step>`. Unchanged trees reuse `previousWipRef`. |
| `CheckpointSnapshotPort.resetWorktreeToRef` | Not on `SnapshotManager`. Reset the attempt worktree to that commit with Task 035 `GitRunner` (or Task 038 slot reset) before redoing a crashed tool. `null` restores the attempt base tree. |
| `HarnessRunPort` | Task 047 `HarnessRunEngine`. The loop reads `failingCheckFingerprint` and `checkResults` from the tool body for the no-progress guard and the handoff. |
| `KnowledgeToolPort`, `AskOwnerPort`, `FlagBlockedPort`, `DisputeTestPort`, `SubmitCandidatePort` | Task 048 `AttemptMcpServer` tool handlers (`kb.*`, `harness.ask_owner`, `harness.flag_blocked`, `harness.dispute_test`, `harness.submit_candidate`). Submit still runs only after the formatter and the WIP snapshot. |
| Test `ScriptedModel` | Stand-in for Task 034 `FakeModelAdapter`. The simulator class is not on this base and its script API is the M0 kernel, so tests drive `ModelStreamPort` directly with zero network calls. |

`MemoryAttemptCoordinator` is the in-process stand-in for the state.db transaction. Swap it for one coordinator transaction that inserts `turn_log` and upserts `attempt_checkpoints` together, with CAS writes for `items_artifact` visible to that transaction.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-057-worker-loop-executor-checkpoints`:

- `pnpm --filter @ef-harness/worker-loop typecheck` — exit 0.
- `pnpm --filter @ef-harness/worker-loop lint` — exit 0.
- `pnpm --filter @ef-harness/worker-loop test -- executor` — exit 0. 4 files, 32 tests passed. Covers read → edit → run → submit, per-step `turn_log` and `wip_ref`, code handoff (`llmTokens` 0), formatter only at submit and only on in-scope paths, all 4 crash points plus a crash on parallel tool 2, junior 40 / senior 80 / configured caps, 3× repeat (normalized arguments), 8-step no-progress, 60s stall retry-once-then-park, 429 non-failure backoff, usage-limit park, malformed tool repair then stuck, budget park at step 12 with ref `.../12` and exact settled units, prose reminder, premature-done reminder, `flag_blocked` → `AskOwner`, hold plus contradictory-brief rebuild, pause, additive and hard steer, epoch fence between tools, immediate stop, and atomic coordinator rollback.
- `node scripts/verify-harmony.mjs --task 057` — exit 0, `harmony ok for Task-057`.

## Known Limitations / Follow-Ups

- A second "I'm done" without `harness.submit_candidate` or `harness.flag_blocked` ends as `stuck` / `premature_done` after the single required reminder, so the one-shot prompt cannot spin.
- Guard streak fields are process memory until an integrator persists `LoopGuardState`. Repeat and malformed counts already survive restart because they are counted from `turn_log`.
- The 60s idle timer is Task 053's watchdog. This loop passes `stallTimeoutMs: 60000` and treats `kind: "stream_stall"` as that timeout. Tests do not sleep 60 seconds.
- Worktree reset and Git temp-index commits are ports. Tests use an in-memory tree with the same ref names and reuse rules. They do not invoke `git`.
- `MemoryAttemptCoordinator` is not SQLite. Wiring must keep the turn row, checkpoint, handoff, and pending cursor in one transaction so a failed commit leaves no partial step number.
