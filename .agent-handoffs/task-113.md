---
task_id: "Task-113"
branch: "task/113-message-sequencing-intent-router"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/steering/src/router/**"
  - "packages/steering/tests/router/**"
  - ".agent-handoffs/task-113.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 113 handoff

Unified message sequencer, input-start focus capture, `router@1` shortlist, and ordered multi-clause execution. Commit stays on `task/113-message-sequencing-intent-router`.

Import from `packages/steering/src/router/index.ts` until the package barrel is wired.

## Exports Provided

- `UnifiedMessageSequencer` — assigns `user_messages.msg_seq` (`INTEGER PRIMARY KEY AUTOINCREMENT`) and drains messages in that order. A later `accept` during an in-flight message stays queued until the earlier message reaches `DONE` or `AWAITING_CLARIFICATION`. The same `message_id` with the same text returns the existing row. A different body throws `DuplicateMessageConflictError`.
- `InputStartFocusSnapshotter` — `begin` freezes `{ activeTab, selectedCanvasNodeIds, openQuestionCardId, openQuestionOptionsVersion, focusedFeatureId, inspectedTaskId, previewSelectedElement? }` at input start. `observeUi({ explicit: false })` does not rebind. `observeUi({ explicit: true })` sets `confirmationRequired` when the captured focus changed.
- `RouterShortlistRetriever` — hybrid rank of dual FTS5 (`kb_words` BM25 title weight 2.0 / body 1.0, `kb_ident` trigram or `LIKE`), input-start focus boost, active working features/tasks, open questions, and the last 3 turns. Returns at most 15 cards. The rendered `router@1` prompt stays under 1500 estimated tokens (`ceil(chars/4)`).
- `OrderedMultiClauseExecutor` — safety order is stop/pause, answers, edits and removals, new-feature additions, then read-only queries. Each clause commits on its own (`PENDING → DISPATCHED → DONE | AWAITING_CLARIFICATION`). Add clauses are reserved before edits. Ambiguous mutations call the Task 115 hold port and do not edit. Resume skips `DONE` clauses.
- `SteeringMessageRouter` / `openSteeringRouter` — composition root used by tests. `submit` accepts then drains. `resume` continues a crashed `state.db`.
- `DeterministicRouterModel` — offline `router@1` stand-in (`usesProvider: false`). Output is checked with `parseRouterV1`.
- `parseRouterV1` / `assertRouterV1` — local port of `RouterV1Schema`.
- `classifyFastPath` — Stop/Pause/Approve/Reject, box target, matching question target, exact `stop` / `stop everything` / `pause build` / `abort`. Quoted `"stop"` is ordinary text.
- `LocalCandidateCatalog`, `LocalDualFtsSearch`, `LocalOutboxPort`, `RecordingKernel`, `RecordingDispatch`, `RecordingHolds`.
- Constants: `ROUTER_SHORTLIST_CAP` (15), `ROUTER_PROMPT_TOKEN_BUDGET` (1500), `FAST_PATH_BUDGET_MS` (2), `EMERGENCY_STOP_BUDGET_MS` (10), `SAFETY_PHASE`, `ROUTER_V1_INSTRUCTION`, `ROUTER_DDL`, `STEERING_OUTBOX_CONSUMERS`.

Kernel clause shape is `{ clauseText, span, intentType, targetCandidateIds, confidence: "high" | "ambiguous", alternateReadings?, optionsVersion, control, cardDecision }`. `intentType` is `stop_control | read_only_query | answer_question | edit_existing | add_new_feature | undo_feature`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/steering/src/index.ts` is frozen. Re-export the router from the package barrel:

```ts
export {
  InputStartFocusSnapshotter,
  OrderedMultiClauseExecutor,
  RouterShortlistRetriever,
  SteeringMessageRouter,
  UnifiedMessageSequencer,
  openSteeringRouter,
} from "./router/index.js";
export type {
  ClarificationCard,
  ExplicitUiAction,
  InputStartFocus,
  MessageReceipt,
  PlannedClause,
  SubmitMessageInput,
} from "./router/index.js";
```

No root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig*.json`, or `eslint.config.mjs` edits.

Sibling wiring, when those branches are integrated:

- Task 114 calls `OrderedMultiClauseExecutor` and should replace `KernelControlPort` with `ImmediateKernelStopController` (`stop` / `pause`) and `ClauseDispatchPort` with the four route handlers.
- Task 115 should replace `AmbiguityHoldPort.place` with `MultiInterpretationHoldEngine`. The card's `pipeline` is `"Task 115"` and `alternateReadings` lists every tied canonical id. No feature edit runs for that clause.
- Task 155 should call `InputStartFocusSnapshotter.begin` on the first keystroke or mic press and `SteeringMessageRouter.submit` on send. Pass `explicitAction` `{ type: "box_target" | "question_target", ... }` from the composer target. A question tag is a fast path only when `targetId` and `optionsVersion` match the input-start snapshot.
- Task 116 / Task 102 can read `read_only_query` outcomes. Spend text is `spent_micro_usd=<integer>` when a `BudgetReadPort` is injected.

## Dependency Intents (New Packages Requested)

None. Persistence uses `node:sqlite` (`DatabaseSync`). No package was added to `@ef-harness/steering`.

## Contract Change Requests

None filed against another task's files. `schema/state.sql` was not edited.

Sibling branches are not on this base (`649773097c387ae534b686ea5825f449f843aa7c`). These local ports should be swapped at integration:

- **Task 009 `RouterV1Schema`.** `parseRouterV1` is the local closed parser: eight canvas intents, `{ span, intent, target_id, confidence, needs_clarification }`, honest `{ blocked: true, reason, missing_ids? }`, unknown keys rejected, mutating `change | correct_evidence | remove` need a target or `needs_clarification`. Swap for the Zod schema. Do not deep-import `packages/shared-contracts/src/prompts/**`. `renderRouterPrompt` is the local envelope (`<instruction>`, `<user>`, `<data source="...">`) and escapes `</data>`, `<instruction>`, and `</instruction>` inside user text. Swap the renderer for `buildPromptEnvelope` when that barrel export exists.
- **Task 017 `KnowledgeGraphRepo`.** `KnowledgeGraphPort.getNode` / `listActiveNodes` and `LocalCandidateCatalog` stand in for `getNode` plus a current-snapshot list of active feature, decision, rule, question, and task nodes. Map `NodeRecord` onto `GraphNodeView` (`text` ← `text`, `featureId` ← `feature`, `working` from task/feature runtime). Do not deep-import `packages/db/src/knowledge/**`.
- **Task 018 search.** The task text says `FtsSearchRepo`. The published sibling export is `KnowledgeSearchService` (`searchNodes`, `searchByIdSubstring`). `FtsSearchPort.searchNodes` / `searchIdentifiers` and `LocalDualFtsSearch` are the stand-in. Local tables are standalone `kb_words` (BM25 2.0/1.0) and trigram `kb_ident`, keyed by `router_catalog.nid`. When `kb_words` already has an external-content `CREATE` statement, the port does not rewrite it. Swap to `KnowledgeSearchService` and stop calling `upsert` from this package; Task 018 triggers own the index.
- **Task 026 `OutboxRepo.appendEventInTx`.** `LocalOutboxPort` writes `outbox` + `outbox_deliveries` inside the caller's transaction, rejects an empty consumer list, and rejects `telemetry.*`, `worker.heartbeat`, and `token.delta`. Events are `SteeringMessageSequenced` and `SteeringClauseDispatched` for consumers `scheduler` and `ui_projection`. Swap the port for `OutboxRepo` on the same `state.db` connection (`conn.isTransaction === true`).
- **Task 023 budget read.** `BudgetReadPort.spentMicroUsd` supplies the read-only spend clause. There is no ledger on this base.
- **Task 114 / Task 115 / Task 155.** See Shared Wiring Needs. `RecordingKernel`, `RecordingDispatch`, and `RecordingHolds` are test doubles, not the production controllers.

`ROUTER_DDL` creates `user_messages`, `message_clauses`, `input_focus_snapshots`, `router_catalog`, and (if missing) `outbox` / `outbox_deliveries` with `CREATE TABLE IF NOT EXISTS`. Fold `user_messages`, `message_clauses`, `input_focus_snapshots`, and `router_catalog` into `schema/state.sql` when schema edits are allowed. Opening a Task 013 database that does not yet contain them is safe.

`router@1` has no `alternateReadings` field. The kernel sets `needs_clarification` on the schema object and stores `alternateReadings` on the clause from the shortlist tie. A target id that is not on the shortlist is rejected, retried once with the allowed ids, then turned into a clarification card. It is not replaced with a guessed id.

After that gate, the kernel planner is authoritative: an explicit name, the input-start focus, or a unique lexical match wins, and two tied readings stay ambiguous even if a model names only one of them.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-113-message-sequencing-intent-router`:

- `pnpm --filter @ef-harness/steering typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/steering lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/steering test` — pass. Vitest v5.1.1: 2 files, 23 tests passed (router suite plus the package smoke test).
- `pnpm --filter @ef-harness/steering test -- router` — pass. Vitest v5.1.1: 1 file, 22 tests passed. Covers monotonic `msg_seq`, in-flight queueing, idempotent replay, conflicting replay, all five origins, late-popup focus (`Q-Auth` options version 1 vs a later `Q-Budget`), explicit focus-change confirmation, question-tag version mismatch, offline `stop` / `pause build` / `stop everything` / `abort` with a throwing provider (`fastPathMs < 2`, submit `< 10ms`, zero provider calls), quoted `"stop"` not stopping, approve/reject/box fast path, shortlist cap 15, prompt tokens `< 1500`, `kb_words` and `kb_ident` hits, focus boost, fabricated `F-999` rejected after one retry, repaired in-shortlist id accepted, closed-schema extra key rejection, stop → edit → query order including a lead query, six-sentence span split, reserve-then-link-then-add, ambiguous `F-Orders` / `F-Reports` and `F-Inventory` / `F-Orders` with no edit, focused CSV export, and crash resume from clause 2 without repeating the stop.
- `node scripts/verify-harmony.mjs --task 113` — pass (exit 0, `harmony ok for Task-113`, about 114s). Schema tests, diagram check, owned-path scope, and workspace typecheck, lint, and tests succeeded.

## Known Limitations / Follow-Ups

- `DeterministicRouterModel` does not call a provider. A free-form message uses it only when the caller does not inject a provider port. An injected provider that throws is not caught; exact emergency phrases never call it.
- Ambiguous and unresolved mutations checkpoint the message as `AWAITING_CLARIFICATION` and leave later clauses in that message `PENDING`. The next `msg_seq` may run. Task 115 owns the answer that clears the hold. This package does not resume a held clause.
- `alternateReadings` are sorted by id. The kernel, not the model JSON, fills them.
- New-feature reservation runs before the edit phase so "add menu uploads and show them on the kitchen list" can name the kitchen link. The add route itself still runs after edits. Reservation is not a second `DONE` transition; a crash before the add clause is `DONE` reserves again.
- `LocalDualFtsSearch` on a fresh database creates standalone FTS tables. It does not run Task 018's contentless `kb_words` triggers or `search_reads`.
- `router_catalog` is the local node list. It is not `nodes`. Swap it for `KnowledgeGraphRepo` before production reads.
- Focus confirmation and invalid-target cards use `pipeline: "router"`. Only a 2-reading mutation uses `pipeline: "Task 115"`.
- Timing budgets were measured with `node:sqlite` memory databases. The stop fast path does not query FTS or the model.
