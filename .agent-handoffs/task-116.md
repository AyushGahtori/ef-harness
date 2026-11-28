---
task_id: "Task-116"
branch: "task/116-shared-question-queue-arbiter"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/steering/src/question-arbiter/**"
  - "packages/steering/tests/question-arbiter/**"
  - ".agent-handoffs/task-116.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 116 handoff

Shared question queue and arbiter: owner-first interception, `inbox_subscribers` dedup, `P0`–`P4` ordering, 10-minute calm batch with critical-path flush, 30-minute aging nudge, stale-reply reconciliation, and auto-retirement. Commit stays on `task/116-shared-question-queue-arbiter`.

Worktree base is `649773097c387ae534b686ea5825f449f843aa7c` (`node scripts/agent-worktree.mjs create 116 shared-question-queue-arbiter --base 649773097c387ae534b686ea5825f449f843aa7c`). `harness/integration` currently points at `30f2e9cb41169e3cea11f1a9946db74a5b32cfde`, where a frozen install does not match the lockfile. The foundation commit is the base this task was asked to use.

## Exports Provided

Import from `packages/steering/src/question-arbiter/index.ts` until the package barrel is wired:

- `SharedQuestionArbiter` — `submit`, `answer`, `choose`, `unsubscribe`, `cancelTask`, `reviseOptions`, `retireFeature`, `retireByEdit`, `noteCriticalPath`, `setFocusMode`, `activeQueue`, `ranked`, `surfaced`, `assessments`, `digest`, `interruptionTotals`, `card`.
- `OwnerFirstQuestionFilter` — `intercept`. Order is settled record, then internal owner mailbox, then the human queue. `userInterrupted` is false for auto-replies, owner routes, duplicate joins, and `P4` digest cards.
- `QuestionDedupSubscriberStore` — `admit`, `unsubscribe`, `cancelTask`, `settleOpen`, `applyExplicitChange`, `reviseOptions`, `retireFeature`, `retireQuestion`, `retireMany`, `noteCriticalPath`. One open card per `(scope_id, criterion_id)` or normalized topic hash. Subscriber rows are `(question_id, waiting_task_id, waiting_role)`.
- `StaleReplyReconciler` — `receive`, `choose`. A late reply that matches the settled answer returns `Already saved via your edit — nothing changed` and does not write. A contradiction or a retired/undone target stores the reply and returns the keep/change card. A VS Code / markdown retirement uses `Keep VS Code edit or apply this reply?`.
- `openQuestionArbiter` / `QuestionArbiterRuntime` — opens `state.db` and `telemetry.db`.
- `InterruptionAudit` — `owner_first_intercepted`, `duplicates_collapsed`, `human_interruption` rows in `telemetry`.
- `SqliteSettledDecisionPort`, `MemoryOwnerDirectory`, `MemoryRoleMailbox`, `MemoryCriticalPath`.
- `QuestionQueueStore`, `QUESTION_ARBITER_DDL`.
- Helpers: `classifyPriority`, `compareCards`, `assessDelivery`, `blockingLabel`, `whyThisMatters`, `questionKey`, `normalizeTopic`.
- Constants: `CALM_BATCH_MS` (10 minutes), `AGING_NUDGE_MS` (30 minutes), `INBOX_HOLD_REASON` (`inbox_question`), `ALREADY_SAVED_MESSAGE`, `VS_CODE_STALE_PROMPT`.
- Errors: `QuestionArbiterError`, `InvalidQuestionError`, `QuestionNotFoundError`, `HoldClearFailedError`, `QuestionTransactionError`.

`blockingLabel` is `Blocking 1 task` or `Blocking N tasks`. `whyThisMatters` is `Why this matters (blocks N task|tasks)`. Options are numbered from 1 with a monotonic `optionsVersion` and a recommended default. Answering, retiring, and subscriber updates run in one `BEGIN IMMEDIATE` transaction: decision row, hold clears, wakes, settled-fact write, canonical projection, and outbox append commit together or roll back together.

Priority: `P0` interrupt-now (stop, security, auth expiry, budget cap, critical blocker), `P1` critical path or at least two waiters, `P2` breaking CCR / conflict / `DisputeTest` / ambiguous steering, `P3` single non-critical question, `P4` advisory digest. `P4` is not promoted and does not place a hold. Focus mode surfaces only `P0`. Aging assessments set `sound: false` and `modal: false`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/steering/src/index.ts` is frozen. Re-export the arbiter from the package barrel:

```ts
export {
  ALREADY_SAVED_MESSAGE,
  HoldClearFailedError,
  InvalidQuestionError,
  MemoryCriticalPath,
  MemoryOwnerDirectory,
  MemoryRoleMailbox,
  OwnerFirstQuestionFilter,
  QuestionArbiterError,
  QuestionArbiterRuntime,
  QuestionDedupSubscriberStore,
  QuestionNotFoundError,
  QuestionQueueStore,
  QuestionTransactionError,
  SharedQuestionArbiter,
  SqliteSettledDecisionPort,
  StaleReplyReconciler,
  VS_CODE_STALE_PROMPT,
  assessDelivery,
  blockingLabel,
  classifyPriority,
  compareCards,
  normalizeTopic,
  openQuestionArbiter,
  questionKey,
  whyThisMatters,
} from "./question-arbiter/index.js";
export type {
  AnswerResult,
  ChoiceResult,
  CriticalPathPort,
  DeliveryAssessment,
  FilterDisposition,
  HoldReason,
  HumanReason,
  InterruptionTotals,
  OwnerMailboxPort,
  OwnerResolutionPort,
  PriorityTier,
  QuestionCard,
  QuestionKind,
  QuestionReply,
  QuestionStatus,
  SettledDecisionPort,
  SettledFact,
  SettledSource,
  WorkerQuestionRequest,
} from "./question-arbiter/index.js";
```

No root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig*.json`, or `eslint.config.mjs` edits. `packages/steering/package.json` stays unchanged. No new dependency.

Task 127 should read `SharedQuestionArbiter.ranked`, `surfaced`, `assessments`, and `digest`. Task 130 should read answered and retired cards plus `StaleReplyReconciler`. Task 155 should pass the captured `optionsVersion` into `answer`. Task 129 / 087 / 086 / 156 should call `retireFeature` or `retireByEdit`.

## Dependency Intents (New Packages Requested)

None. Persistence uses `node:sqlite` (`DatabaseSync`) and `node:crypto` `sha256`.

## Contract Change Requests

`schema/state.sql` was not edited. The frozen `inbox_items.status` check is `open|answered|superseded|dismissed` and `inbox_subscribers` is `(item, task)` without `waiting_role`. This package keeps the task's model in the same database file:

- `qa_inbox_items` includes `retired`, `retired_reason`, `options_version`, `blocked_worker_count`, `scope_id`, `criterion_id`, `question_key`, and `settled_*`.
- `qa_inbox_subscribers(question_id, waiting_task_id, waiting_role)`.
- A partial unique index allows one `open` row per question key.
- Canonical `inbox_items` / `inbox_subscribers` are a projection. `retired` is stored as canonical `dismissed` with `payload.domainStatus = "retired"` until the check constraint can accept `retired`.
- `QUESTION_ARBITER_DDL` also creates `qa_wakes`, `qa_pending_replies`, `qa_holds`, `qa_settled_facts`, `qa_settled_fts`, `outbox`, and `outbox_deliveries` with `CREATE TABLE IF NOT EXISTS`.

Please fold `retired` and `waiting_role` into `schema/state.sql` when schema edits are allowed. Until then, open any database and let `QuestionQueueStore` create the tables.

Outbox types written inside the answer/retire transaction are `InboxItemCreated`, `QuestionSettled`, and `QuestionRetired`, each with `exporter` and `ui_projection` delivery rows. `QuestionSettled` and `QuestionRetired` are not in Task 026 `DEFAULT_EVENT_CONSUMERS` yet; register them when that map is wired.

Sibling branches are not on this base. Swap these local ports at integration:

- **Task 017 / Task 018.** `SqliteSettledDecisionPort.lookup` is exact scope+criterion, exact normalized text, topic key, entity-column tokens, then local FTS5. Replace it with `KnowledgeGraphRepo` settled decisions, contracts, and rules plus Task 018 FTS. Do not deep-import `packages/db`.
- **Task 026.** `QuestionQueueStore.appendOutbox` is the stand-in for `OutboxRepo.appendEventInTx`. It already runs on the open `BEGIN IMMEDIATE` transaction. The sibling method is synchronous-incompatible if it requires a different connection object; pass the same `DatabaseSync` or call it before `COMMIT`.
- **Task 109.** `MemoryOwnerDirectory.ownerOf` stands in for `OwnerResolutionCoordinator.ownerOf`. `MemoryRoleMailbox.submit` stands in for `DurableRoleMailbox.submit`. The payload is a `ContractClarificationRequest` with only `requestingTaskId`, `contractId`, and `question`. Roles `developer`, `user`, `user-inbox`, and `human` are not treated as internal owners. Do not deep-import `packages/integrator/src/handoffs/**`.
- **Task 113.** No router import. `answer` compares the caller's `optionsVersion` with the card before any decision write. Task 113 should keep sending the version captured at input start.
- **Task 115.** Holds are rows in `qa_holds` (`reason_type = inbox_question`, `reason_ref_id = question id`). `clearHold` removes only that triple, so a `user_paused` hold survives an answer. Swap `placeHold` / `clearHold` for `HoldReasonStackCoordinator` and invoke them inside `QuestionQueueStore.transaction` so a throw still rolls the decision back. `HoldClearFailedError` is the rollback signal covered by tests.
- **Task 127 / 130 / 155.** Use the exports above. This package does not render inbox cards.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-116-shared-question-queue-arbiter`:

- `pnpm --filter @ef-harness/steering typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/steering lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/steering test -- question-arbiter` — pass. Vitest v5.1.1: 4 files, 22 tests. Covers owner-first schema lookup under 5 ms (`users.email`), paraphrase column match, owner mailbox for the auth export question, settled-record precedence, human-only promotion for secret / approval / human step / breaking CCR / ambiguous steering / `DisputeTest` / escalation, advisory `P4` with zero interruption, post-answer auto-reply, five-way dedup with `Blocking 5 tasks` and one atomic wake, scope/criterion collapse, last-subscriber `no_active_waiters`, hold-clear rollback that leaves `user_paused` intact, monotonic options, `P0>P1>P2>P3>P4`, focus mode hiding two `P3` cards while a four-worker OAuth `P0` interrupts, 10-minute batch, early flush at two waiters and on critical path, 30-minute nudge with sound and modal false, agreeing and contradicting stale replies including the VS Code prompt, superseded `optionsVersion`, feature undo plus revision supersede, canvas criterion retirement, and eight concurrent duplicate / owner-answerable / stale operations with one card and a four-task wake.
- `node scripts/verify-harmony.mjs --task 116` — pass (exit 0, `harmony ok for Task-116`, about 42s). Schema tests, diagram check, owned-path scope, and workspace typecheck, lint, and tests succeeded.

## Known Limitations / Follow-Ups

- Canonical `inbox_items.status` cannot be `retired` until `schema/state.sql` changes. Readers that need the domain status must use `QuestionCard.status` or `payload.domainStatus`.
- `waiting_role` is on `qa_inbox_subscribers` only. The frozen subscriber table stores `(item, task)` for active waiters.
- Telemetry rows are written after the state transaction commits, in a separate `telemetry.db`, matching the telemetry database rule that metrics are not part of the state transaction. A crash between commit and the metric insert can under-count.
- `MemoryOwnerDirectory`, `MemoryRoleMailbox`, and `MemoryCriticalPath` are process memory. Question rows, holds, wakes, and settled facts survive in the opened database; owner routes and the critical-path set do not.
- Advisory cards collapse duplicates but do not place `inbox_question` holds and never enter the interrupt or early-flush lanes.
- Admit calls are serialized on one `DatabaseSync` connection. The partial unique index rejects a second open row for the same key if a future multi-connection writer races.
- A direct edit that agrees with the later click does not insert a pending-reply row. Contradictions do, so the words are still in `qa_pending_replies` until Keep or Change.
- Explicit Change on a retired card stores the new decision as `answered` and does not put the card back to `open`. Inactive subscribers are not woken.
- There is no inbox renderer, sound, or modal. Task 127 owns delivery chrome. Assessments already force `sound` and `modal` to false.
