---
task_id: "Task-065"
branch: "task/065-hint-ladder-dispute-routing"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/verifier/src/hint-ladder/**"
  - "packages/verifier/tests/hint-ladder/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 065 handoff

Persistent hint ladder over `state.db.verification_state`. Commit stays on `task/065-hint-ladder-dispute-routing`.

## Exports Provided

Import from `packages/verifier/src/hint-ladder/index.ts` until the package barrel is wired.

Required for Task 066 (acceptance), Task 068 (M1 exit), Task 102 (`ask-owner-responder@1`), and Task 107 (scheduler escalation):

- `HintLadderController`
  - `processHiddenFailure(failure) -> HintFeedbackPayload`
  - `processStaticFailure(outcome) -> StaticAuditLadderResult`
  - `resetOnBriefChange(taskId, briefVersion) -> void`
  - `handleTestDispute(input) -> TestDisputeRecord`
  - `applyDisputeVerdict(verdict) -> DisputeVerdictResult`
  - `checkCrossWorkerPattern(query) -> CrossWorkerMatch | null`
- `HintFeedbackPayload` — `step_1 | step_2 | step_3 | contract_mismatch | non_ladder`
- `TestDisputeRecord` — open dispute routed to `ask-owner-responder@1`, `penalized: false`

Step 1 `hint` is only `{ ruleId, ruleText, failureType }`. Step 2 `hint` adds `{ freshInput, expectedOutput, candidateActualOutput }`. Step 3 carries `escalation` plus failure `history` with no hidden inputs. `EXHAUSTED` decision card options are exactly `revise brief`, `fix by hand`, `waive`.

`record_hidden_failure` is loaded from `schema/queries.sql` and executed inside `BEGIN IMMEDIATE`. `finish_submission` and `register_delivery` are also executed from that file. Disclosed check ids are written to `verification_state.disclosed_checks` in the same transaction. Events `HintLadderAdvanced`, `FreshExampleDisclosed`, `TaskEscalated`, and `TestDisputeOpened` are inserted into `outbox` with delivery rows for `scheduler` and `ui_projection`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/verifier/src/index.ts` on this branch. When integrating, add:

```ts
export {
  CanonicalQueryMissingError,
  DisputeCounterexampleError,
  DisputeReferenceError,
  EXHAUSTED_DECISION_OPTIONS,
  HINT_LADDER_EVENT_CONSUMERS,
  HINT_LADDER_EVENTS,
  HiddenPoolInvariantError,
  HintLadderController,
  HintLadderError,
  bindDatabaseSync,
  detectCrossWorkerPattern,
  drawFreshExample,
  loadCanonicalQueries,
  localComputeFailureFingerprint,
  localNodeContentHash,
  localPropertyExample,
  staticFingerprintMetaKey,
} from "./hint-ladder/index.js";
export type {
  CandidateExampleRunner,
  CandidateProbeRequest,
  CrossWorkerMatch,
  DecisionCard,
  DisputeVerdictInput,
  DisputeVerdictResult,
  EscalationDecision,
  FailureAttribution,
  FailureFingerprintInput,
  FailureFingerprintPort,
  FailureType,
  HiddenCheckFailure,
  HiddenExample,
  HintFeedbackPayload,
  HintLadderControllerOptions,
  LadderHistoryEntry,
  ModelLevel,
  NamedQueries,
  PropertyExampleGenerator,
  PropertyExampleRequest,
  StateDbPort,
  StaticAuditLadderResult,
  StaticAuditOutcome,
  StepOneFeedback,
  StepOneHint,
  StepThreeFeedback,
  StepTwoFeedback,
  StepTwoHint,
  TestDisputeInput,
  TestDisputeRecord,
} from "./hint-ladder/index.js";
```

No root `package.json` script changes.

## Dependency Intents (New Packages Requested)

None. No package.json changes. Sibling packages are not imported.

Local ports and the swap at integration:

| Port on this branch | Replace with |
| --- | --- |
| `HintLadderControllerOptions.db: StateDbPort` (`bindDatabaseSync` adapts `node:sqlite`) | Task 013 `ProjectStateDb` writer connection. It must already have `ef_search_text` registered, be the single writer, and not already be inside a transaction. This controller issues `BEGIN IMMEDIATE` / `COMMIT`. |
| `HintLadderControllerOptions.fingerprint` (`localComputeFailureFingerprint`) | Task 007 `computeFailureFingerprint`. Called as `{ failureClass, ruleOrCheckId, filePath, detail }` when the caller does not pass an explicit fingerprint. Explicit fingerprints (schema R6 `fp-a` / `fp-b`) are stored unchanged. |
| `localNodeContentHash` on `dispute_upheld` check version bumps | Task 007 `computeNodeContentHash` over `{ kind, title, text, fields }`. |
| `HintLadderControllerOptions.generator` (`localPropertyExample`) | Task 064 property generator. Used only when disclosing a real spare would leave fewer than two undisclosed spares or only one sealed hidden example. The failed check and at least one other sealed example stay out of `disclosed_checks`. |
| Direct `INSERT INTO outbox` plus canonical `register_delivery` | Task 026 `OutboxRepo.appendEventInTx(conn, event, consumers)` with `consumers = ["scheduler", "ui_projection"]` (`HINT_LADDER_EVENT_CONSUMERS`). |
| Canonical `finish_submission` when `submission_pending = 1` | Task 021 submission repo, same SQL. Direct `task_runtime` updates cover `WAITING_INPUT`, `CLEAN_VERIFY`, `READY`, and retries whose submission flag is already clear. |

`FailureAttribution` matches Task 060 (`implementation | contract_mismatch | binding_defect | environment | flaky_test`). Only `implementation` calls `record_hidden_failure`.

## Contract Change Requests

None.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-065-hint-ladder-dispute-routing`.

- `pnpm --filter @ef-harness/verifier typecheck` — exit 0
- `pnpm --filter @ef-harness/verifier lint` — exit 0
- `pnpm --filter @ef-harness/verifier test -- hint-ladder` — exit 0, 1 file, 12 tests passed
- `pnpm --filter @ef-harness/verifier test` — exit 0, 2 files, 13 tests passed (hint ladder plus package smoke)
- `node scripts/verify-harmony.mjs --task 065` — exit 0, `harmony ok for Task-065`

Covered by the hint-ladder tests: schema R6 (`fp-a` → 1, `fp-b` → 2, `fp-b` → 3, `brief_version: 2` → 1) with the state file closed and reopened between step 1 and step 2 and again after disclosure; step 1 returns only rule id, rule text, and failure type; step 2 discloses one fresh spare, keeps the failed case and another spare sealed, and records `disclosed_checks`; an already disclosed id is skipped; a pool with one sealed example left is synthesized instead of disclosed; a throwing probe rolls the ladder write back; the same attempt's repeated fingerprint escalates Junior → Mid; two workers (Mid then Senior) on `R17` / `AC-31` route to the author with the brief-and-test message and do not change level; Manager step 3 is `EXHAUSTED` with the decision card; an unclear brief at step 3 routes to the author; `resetOnBriefChange` leaves `ladder_step` at 0 so the next failure is step 1; `contract_mismatch` and `environment` do not call `record_hidden_failure`; three identical static fingerprints escalate without changing `ladder_step` or `last_fingerprint`, a different fingerprint or a pass resets the streak, and the streak survives reopening the database; `DisputeTest` by rule id or guessed check id pauses at `WAITING_INPUT` without changing the attempt, the ladder, or the check version; `dispute_rejected` returns the author quote and resumes `CODING`; `dispute_upheld` versions only the cited check, resets the ladder, and sets `CLEAN_VERIFY`.

## Known Limitations / Follow-Ups

- `verification_state.static_failures` is only a counter. The last static fingerprint lives in `meta` under `hint-ladder.static-fingerprint.<task>` (`staticFingerprintMetaKey`) so a restart can tell a repeated finding from a new one. No schema change on this branch.
- A new `brief_version` clears `disclosed_checks` in addition to the canonical fingerprint reset. Those ids belonged to the previous brief's pool. `static_failures` is left in place across a brief change and is cleared when a dispute is upheld.
- `resetOnBriefChange` stores `ladder_step = 0`. The observable reset to step 1 is the next `record_hidden_failure`, which matches schema test R6. Storing 1 before that failure would skip the first hint.
- Cross-worker author review requires at least two attempts whose model or level differs and that share rule id, fingerprint, and brief version. The same attempt repeating a fingerprint uses the step-3 jump, not author review.
- If the current holder is null when a hidden or static failure returns to coding, the task is set to `READY` so it can be claimed. A live holder returns to `CODING`. Model escalation and exhaustion clear the holder via `finish_submission` when a submission is pending.
- `binding_defect`, `environment`, and `flaky_test` skip the ladder and do not open an author inbox. Task 060 still owns those routes. `contract_mismatch` returns the visible message only.
- A rule-only `dispute_upheld` versions the lowest check id linked by `verifies` then `derived_from`. A cited check id versions that check. The worker-facing dispute API never updates `nodes`.
- The fresh-example probe runs inside the write transaction so a failure cannot persist a disclosure without the actual output. A slow probe holds the writer lock until it returns.
- Upheld disputes insert a `kernel` change set and a `breaking` `node_changes` row. The check's new `content_hash` uses the local canonical hash until Task 007 is injected.
