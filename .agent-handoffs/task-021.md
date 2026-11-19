---
task_id: "Task-021"
branch: "task/021-holds-submissions-fencing"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/holds/**"
  - "packages/db/tests/holds/**"
  - ".agent-handoffs/task-021.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 021 handoff

Holds are rows, not a task state. Submission acceptance and lease protection run in one `BEGIN IMMEDIATE` transaction. Epoch fencing and the 15-state graph reject stale workers and verification bypasses. Commit stays on `task/021-holds-submissions-fencing`.

## Exports Provided

From `packages/db/src/holds/index.ts`:

- `TaskHoldAndSubmissionRepo` and `createTaskHoldAndSubmissionRepo(connection, queriesSql?)`
- Methods: `placeHold`, `releaseHold`, `listActiveHolds`, `isTaskHeld`, `submitAndAcceptCandidate`, `finishSubmission`, `transitionTaskState`, `parkTask`, `resumeParkedTask`, `assertCurrentEpoch`
- `TASK_STATE_TRANSITIONS` (canonical directed graph for all 15 states), `TASK_STATES`, `TASK_STATE_FLAGS`, `TERMINAL_TASK_STATES`
- `HOLD_REASONS`, `HOLD_EVENT_TYPES`, `HOLD_EVENT_CONSUMERS` (`scheduler`, `exporter`, `ui_projection`)
- `FINISH_SUBMISSION_STATES` (`ACCEPTED`, `CODING`, `ESCALATED`, `EXHAUSTED`)
- `RESUMPTION_TRIGGERS` (`user`, `resumption_policy`)
- Errors: `StaleEpochError`, `IllegalTaskTransitionError`, `DuplicateCandidateError`, `TaskHeldError`, plus `SubmissionAlreadyFinishedError`, `ResumptionPolicyError`, `TaskNotFoundError`, `InvalidHoldReasonError`, `InvalidCandidatePayloadError`
- `StateConnection` port, `CandidateReceipt`, `TaskHold`, and the input/result types next to those methods
- `loadCanonicalQueries` / `parseNamedQueries` for `submit_candidate`, `accept_submission`, `finish_submission`, `op_lookup`, and `register_delivery` read from `schema/queries.sql`

`TASK_STATE_TRANSITIONS` edges:

- `DRAFTED` → `READY`, `CANCELLED`
- `READY` → `LEASED`, `CANCELLED`
- `LEASED` → `CODING`, `PARKED`, `CANCELLED`
- `CODING` → `STATIC_AUDIT`, `WAITING_INPUT`, `PARKED`, `HUMAN_OWNED`, `CANCELLED`
- `STATIC_AUDIT` → `CLEAN_VERIFY`, `CODING`, `EXHAUSTED`, `PARKED`, `CANCELLED`
- `CLEAN_VERIFY` → `ACCEPTED`, `CODING`, `ESCALATED`, `EXHAUSTED`, `PARKED`, `CANCELLED`
- `ACCEPTED` → `MERGED_TO_FEATURE`, `SUPERSEDED`, `CANCELLED`
- `WAITING_INPUT` → `CODING`, `PARKED`, `HUMAN_OWNED`, `CANCELLED`
- `PARKED` → `READY`, `HUMAN_OWNED`, `CANCELLED`
- `ESCALATED` → `READY`, `HUMAN_OWNED`, `CANCELLED`
- `EXHAUSTED` → `READY`, `HUMAN_OWNED`, `CANCELLED`
- `HUMAN_OWNED` → `STATIC_AUDIT`, `CANCELLED`
- `MERGED_TO_FEATURE`, `SUPERSEDED`, `CANCELLED` → none

`CLEAN_VERIFY` is additionally refused unless the current state is `STATIC_AUDIT`, `submission_pending = 1`, and `epoch` matches. `ACCEPTED` is refused unless the current state is `CLEAN_VERIFY` with `submission_pending = 1`. `MERGED_TO_FEATURE` is refused unless the current state is `ACCEPTED`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is outside this task's owned subtree. Wire it to re-export the holds barrel:

```ts
export {
  DuplicateCandidateError,
  FINISH_SUBMISSION_STATES,
  HOLD_EVENT_CONSUMERS,
  HOLD_REASONS,
  IllegalTaskTransitionError,
  RESUMPTION_TRIGGERS,
  StaleEpochError,
  TASK_STATE_FLAGS,
  TASK_STATE_TRANSITIONS,
  TASK_STATES,
  TaskHeldError,
  TaskHoldAndSubmissionRepo,
  createTaskHoldAndSubmissionRepo,
} from "./holds/index.js";
```

Pass the Task 013 `ProjectStateDb` writer connection (Task 012 `SqliteConnection`) into `createTaskHoldAndSubmissionRepo`. Do not open a second writer. `assertCurrentEpoch` must be called inside the caller's existing `BEGIN IMMEDIATE` transaction by later worker tools (`ask_owner`, `flag_blocked`, `dispute_test`).

Task 010's `HOLD_REASONS` and `TASK_STATES` are not on this base commit, and package barrels cannot be deep-imported. The constants in `packages/db/src/holds/states.ts` are schema-parity copies checked against `schema/state.sql`. After Task 010 is exported from `@ef-harness/shared-contracts`, replace those local copies with that barrel and keep `TASK_STATE_TRANSITIONS` here.

Task 026 should adopt `HOLD_EVENT_CONSUMERS` for `TaskHoldPlaced`, `TaskHoldReleased`, and `TaskUnheld` (or replace this list with its default routing table). Every hold event already calls canonical `register_delivery` for those three consumers in the same transaction as the `outbox` insert.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-021-holds-submissions-fencing`:

- `pnpm --filter @ef-harness/db test -- holds` — pass. Vitest v5.1.1: 3 files, 23 tests passed (duration 1.04s). Covers user pause plus requirement hold, release of only the requirement hold, `claim_task` still refusing until `user_pause` is released, idempotent place/release, `submission_pending = 1` surviving `sweep_expired_leases` at `now = 999999999`, duplicate `(task, attempt, commit_sha)` replay, `DuplicateCandidateError`, fenced and stale-epoch submission leaving `candidates` empty, `STATIC_AUDIT` refusing `ACCEPTED`, the second `finishSubmission` throwing `SubmissionAlreadyFinishedError`, and the full 15×15 transition matrix (41 legal edges, every other pair `IllegalTaskTransitionError`, including `CODING → ACCEPTED`, `STATIC_AUDIT → ACCEPTED`, and `MERGED_TO_FEATURE → READY`).
- `pnpm --filter @ef-harness/db typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/db lint` — pass (`eslint .`, exit 0).
- `node scripts/verify-harmony.mjs --task 021` — pass (exit 0, `harmony ok for Task-021`, about 76s). Schema tests, diagram check, full typecheck, lint, and the workspace test run all succeeded.

## Known Limitations / Follow-Ups

- Task 010, Task 012, and Task 013 are not in the base commit, so this package cannot import `ProjectStateDb`, `SqliteConnection`, or the vocabulary barrel. `StateConnection` is the structural port those writers must satisfy.
- `finish_submission` itself will store any `:next_state` while `submission_pending = 1`. This repository checks `TASK_STATE_TRANSITIONS` and the no-bypass gates before it executes that statement.
- `BEGIN IMMEDIATE` serializes two `finishSubmission` calls. The unit test invokes them one after the other; the second observes `submission_pending = 0` and throws `SubmissionAlreadyFinishedError`.
- `parkTask` records `attempt_checkpoints`, sets the attempt to `parked`, and clears `holder_attempt` so that attempt cannot submit. Holds are left in place. `resumeParkedTask` moves `PARKED → READY` for a new claim; it does not revive the parked attempt. Resume requires trigger `user` or `resumption_policy` and zero hold rows.
- `HOLD_REASONS` is exactly `user_pause`, `requirement_change`, `budget`, `ccr`, and `governor`. Later names such as `editor_overlap` need a vocabulary extension before `placeHold` will accept them.
- `ask_owner`, `flag_blocked`, and `dispute_test` are not implemented in this task. Their writers must call `assertCurrentEpoch` inside the mutation transaction.
