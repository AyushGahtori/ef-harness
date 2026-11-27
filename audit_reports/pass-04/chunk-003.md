# Audit Report — `pass-04/chunk-003` (`Tasks 113–116, 130`: `packages/steering` & Re-Entry Reconciliation)

## 1. Chunk identification and scope
- **Pass:** `Pass 04` (Integrator, Steering, Governor, Providers, Runtime Adapters, M3/M4 Gates)
- **Chunk ID:** `pass-04/chunk-003`
- **Scope:** All 5 `packages/steering` units (`113` `router`, `114` `dispatcher`, `115` `holds`, `116` `question-arbiter`, `130` `reentry` + `apps/renderer/src/cockpit/welcome-back`), completing 100% of `packages/steering`.
- **Isolation state:** All 5 branches forked from `main` (`6497730`), clean (`dirty: 0`), unmerged on `harness/integration` (`30f2e9c`).

## 2. Units inspected
| Unit | Branch | Commit | Worktree | Dirty |
| --- | --- | --- | --- | --- |
| `Task 113` | `task/113-message-sequencing-intent-router` | `4c86c46` | `C:/Users/Ayush/Desktop/ef-wt/task-113-message-sequencing-intent-router` | 0 |
| `Task 114` | `task/114-four-route-steering-dispatcher` | `05609eb` | `C:/Users/Ayush/Desktop/ef-wt/task-114-four-route-steering-dispatcher` | 0 |
| `Task 115` | `task/115-multi-interpretation-hold-engine` | `2c95cd8` | `C:/Users/Ayush/Desktop/ef-wt/task-115-multi-interpretation-hold-engine` | 0 |
| `Task 116` | `task/116-shared-question-queue-arbiter` | `2370d7a` | `C:/Users/Ayush/Desktop/ef-wt/task-116-shared-question-queue-arbiter` | 0 |
| `Task 130` | `task/130-reentry-reconciliation-welcome-back` | `a92052c` | `C:/Users/Ayush/Desktop/ef-wt/task-130-reentry-reconciliation-welcome-back` | 0 |

## 3. Files inspected
- `Task 113`: `packages/steering/src/{index.ts,router/ddl.ts,router/runtime.ts}`
- `Task 114`: `packages/steering/src/dispatcher/{dispatcher.ts,kernel-stop.ts,types.ts}`
- `Task 115`: `packages/steering/src/holds/{engine.ts,database.ts}`
- `Task 116`: `packages/steering/src/question-arbiter/ddl.ts`
- `Task 130`: `packages/steering/src/reentry/{cold-open-reconciler.ts,state-store.ts}`, `apps/renderer/src/cockpit/welcome-back/welcome-back-screen.ts`

## 4. Architecture documents consulted
- `routing-design.md`, `agent-graph-routing.md`, `stops-undo-and-reentry.md`, `build-cockpit.md`, `editor-coexistence.md`
- `prompt-contracts.md` (`router@1`)
- `schema/state.sql`
- `IMPLEMENTATION_TASKS.md` (`lines 6937–7199`, `8034–8100`)

## 5. Contracts and signatures discovered
- `Task 113`: `SteeringMessageRouter.{beginInput,observeUi,accept,submit,resume}`, `UnifiedMessageSequencer`, `InputStartFocusSnapshotter`, `RouterShortlistRetriever`, `OrderedMultiClauseExecutor`, `ROUTER_DDL` (6 tables).
- `Task 114`: `FourRouteSteeringDispatcher.{dispatchClauses,dispatchReadOnlyQuery,dispatchExistingFeatureChange,dispatchNewFeatureAddition,dispatchExecutionControl}`, `ImmediateKernelStopController`, `NewFeatureDedupSpawner`, `MidBuildRouteReceipt`.
- `Task 115`: `MultiInterpretationHoldEngine.{holdAmbiguousMessage,noteVerificationFinished,mergeDecision}`, `HoldModeClassifier`, `HoldReasonStackCoordinator`, `AdditiveVsContradictoryResumer`, `HOLD_SCHEMA_SQL` (10 tables).
- `Task 116`: `SharedQuestionArbiter`, `OwnerFirstQuestionFilter`, `QuestionDedupSubscriberStore`, `StaleReplyReconciler`, `QUESTION_ARBITER_DDL` (`qa_*` shadow tables + `TELEMETRY_DDL`).
- `Task 130`: `ColdOpenReconciler.reconcile(input): ColdOpenReport`, `CommitAnsweredQuestionDetector`, `NoRunUntilResumeGate`, `InMemoryReentryStore`, `WelcomeBackScreen.render(model): WelcomeBackView`.

## 6. Confirmed findings
- **`F-053` (`CRITICAL` / `SCHEMA_MISMATCH`):** `packages/steering` (`113–116, 130`) stub barrel (`packages/steering/src/index.ts`), 3 conflicting private SQLite schemas (`113` `ROUTER_DDL` duplicating `outbox`/`outbox_deliveries` + `router_catalog`; `115` `HOLD_SCHEMA_SQL` running `CREATE TABLE task_runtime` / `task_holds` without `IF NOT EXISTS` and crashing on real `state.db`; `116` `QUESTION_ARBITER_DDL` creating `qa_inbox_items`/`qa_inbox_subscribers`/`qa_holds`/`qa_settled_fts` alongside `inbox_items`/`inbox_subscribers` where `inbox_items.status` lacks `'retired'`, plus `TELEMETRY_DDL` inside `state.db`), RAM-only `SteeringRuntime`/`RouteTelemetry` (`114`), and RAM-only `InMemoryReentryStore` (`130` writing invalid `attempts.state = 'CHECKPOINTED'` instead of `'parked'`/`'crashed'`).
- **`F-054` (`CRITICAL` / `CONTRACT_MISMATCH`):** `SteeringMessageRouter.route` (`113`, `router/runtime.ts:203-214`) invokes synchronous `router@1` in `gateModel(...)` and **discards the validated LLM output completely**, substituting regex heuristic `planMessage(...)`; `FourRouteSteeringDispatcher.dispatchReadOnlyQuery` (`114`, `dispatcher/dispatcher.ts:145-150`) throws `SteeringError("READ_ONLY_LLM")` whenever `answer.llmCalls !== 0`, colliding directly with `Task 102` `AskOwnerResponderEngine.answerQuestion` (which invokes `askModel` and omits `llmCalls`); `114` `pauseFeature` (`dispatcher/types.ts:11`, `kernel-stop.ts:164`) writes `USER_PAUSED_REASON = "user_paused"` instead of canonical `"user_pause"`; and `113`–`116`, `130` are completely unwired from each other and from `daemon`/`renderer`.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `Task 017`/`018`/`026` (`db`) → `Task 113` (`router`) → `Task 114` (`dispatcher`) + `Task 115` (`holds`) → `Task 116` (`question-arbiter`).
- `Task 087` (`revisions`) + `Task 102` (`ask-owner`) + `Task 108` (`plan-preview`) + `Task 040` (`JobObject`) + `Task 053`/`142` (`workers`) → `Task 114` (`dispatcher`).
- `Task 035`/`038` + `Task 085` + `Task 116` + `Task 121` + `Task 171`/`173` → `Task 130` (`reentry` + `welcome-back`).

## 9. Defects and missing integrations
- None of `113–116, 130` import each other or `@ef-harness/db`; `113` discards `router@1` output; `114` crashes on `102`'s `OwnerAnswer`; `114` writes invalid `"user_paused"` hold reason; `115` crashes on real `state.db` (`table task_runtime already exists`); `130` has no SQLite store and `WelcomeBackScreen` is a plain-text presenter not mounted in `apps/renderer`.

## 10. Tests and verification performed
- Reviewed unit test suites across `packages/steering/tests/{router,dispatcher,holds,question-arbiter,reentry}/**` and `apps/renderer/tests/welcome-back/**`.

## 11. Unresolved questions
- Interaction of `130` with `Task 121` (`HumanStepProbeRegistry` in `packages/governor`) and `Task 122`/`128`/`131` (`apps/renderer` / `apps/desktop`) — inspected next in `pass-04/chunk-004` and Pass 05.

## 12. Explicit files and relationships still requiring inspection
- `pass-04/chunk-004`: `Tasks 117–121, 134` (`packages/governor` telemetry, admission, capacity-pools, vault, human-steps + `Task 134` M3 Exit Gate).
