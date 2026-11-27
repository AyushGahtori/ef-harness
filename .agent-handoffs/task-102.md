---
task_id: "Task-102"
branch: "task/102-specialist-review-qa-prompts"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/specialists/**"
  - "packages/planner/tests/specialists/**"
  - ".agent-handoffs/task-102.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 102 handoff

`reviewer@1`, `taste-reviewer@1`, and `ask-owner-responder@1` run inside `packages/planner/src/specialists`. This branch was created from `649773097c387ae534b686ea5825f449f843aa7c` (`foundation/task-001-complete`). Current `harness/integration` is ahead of that commit and its lockfile does not match `packages/shared-contracts/package.json` (`zod` was added as a direct dependency), so `pnpm install --frozen-lockfile` cannot create a worktree from that tip. Sibling branches are not merged here. Commit stays on `task/102-specialist-review-qa-prompts`.

## Exports Provided

From `packages/planner/src/specialists/index.ts`:

- `HighRiskDiffReviewer` — selective `reviewer@1` monitor. Runs only when `touches` hit `auth`, `payments`, `pii`, `migrations`, `security`, `external_side_effect`, or `concurrency` (plus the Task 010 spellings in `HIGH_RISK_TOUCH_ALIASES`), or `hintRetryLevel >= 2`, or `tagDrift` is true. Blocking findings must carry a real diff line range, a MUST/rule id supplied with the request, and a concrete failure scenario. Confirmed blocks go to `VerificationHintLadder.pushReviewerDefect` and count toward the 4% review envelope. Vague style notes stay advisory. The same task can be rejected at most 2 times; the third disputed review escalates with the diff and the concern.
- `AdvisoryTasteVisionReviewer` — `taste-reviewer@1`. Label is always `ADVISORY ONLY` and `blocksMerge` is always false. Accepts full-page, mobile 375, desktop 1440, and `/__styleguide` shots. Skips with `skipped_no_vision_model`, `skipped_prototype`, `skipped_cheapest`, or `skipped_budget_pressure` (spent/limit >= 0.85). Refuses non-synthetic shots with `rejected_non_synthetic` before any vision bytes are sent. Optional one-shot polish and high-confidence layout escalation both require user approval and do not block.
- `AskOwnerResponderEngine` — worker decision cards (3 lines, 2–3 options, one recommendation) for ambiguity and `DisputeTest`, plus read-only answers from `state.db` nodes, edges, task runtime, holds, name-registry tables, and `check_results` receipts. Model text cannot replace those facts.
- `FakeModelAdapter` — scripted specialist model with no network.
- `SpecialistStateDb` — `node:sqlite` reader/fixture for the state.db columns these queries use.
- Ports: `VerificationHintLadder`, `StaticAuditGate`, `UiPlaywrightContractVerifier`, plus `MemoryHintLadder`, `MemoryStaticAuditGate`, `MemoryUiPlaywrightVerifier`, `MemoryReviewEnvelope`, `MemoryReviewRejectionStore`.
- Validators: `parseReviewerV1`, `parseTasteReviewerV1`, `parseAskOwnerResponderV1`, `checkCitation`, `decideReviewerRisk`, `screenshotRedactionProblem`.
- Constants: `HIGH_RISK_TOUCHES`, `HIGH_RISK_TOUCH_ALIASES`, `MAX_REVIEWER_REJECTIONS` (2), `INTEGRATION_REVIEW_ENVELOPE_PPM` (40000, the 4% share), `BUDGET_PRESSURE_RATIO` (0.85).

## Shared Wiring Needs (Root / Index Barrels)

`packages/planner/src/index.ts` is frozen. Add this re-export so callers import the specialists from `@ef-harness/planner` and not from a deep path:

```ts
export {
  ASK_OWNER_ROLE,
  AdvisoryTasteVisionReviewer,
  AskOwnerInputError,
  AskOwnerResponderEngine,
  BUDGET_PRESSURE_RATIO,
  FakeModelAdapter,
  HIGH_RISK_TOUCH_ALIASES,
  HIGH_RISK_TOUCHES,
  HighRiskDiffReviewer,
  INTEGRATION_REVIEW_ENVELOPE_PPM,
  MAX_REVIEWER_REJECTIONS,
  MemoryHintLadder,
  MemoryReviewEnvelope,
  MemoryReviewRejectionStore,
  MemoryStaticAuditGate,
  MemoryUiPlaywrightVerifier,
  REVIEWER_ROLE,
  SpecialistStateDb,
  TASTE_ROLE,
  UnscriptedModelError,
  budgetPressure,
  buildAskOwnerPrompt,
  buildReviewerPrompt,
  buildTastePrompt,
  canonicalHighRiskTouch,
  checkCitation,
  decideReviewerRisk,
  filterGrounded,
  isBlockedExit,
  parseAskOwnerResponderV1,
  parseLocation,
  parseReviewerV1,
  parseTasteReviewerV1,
  parseUnifiedDiff,
  screenshotRedactionProblem,
  selectFamily,
} from "./specialists/index.js";
export type {
  AdvisoryNote,
  AskOwnerSchemaPayload,
  BlockingFinding,
  ClickableCitation,
  DecisionCard,
  HighRiskReviewRequest,
  HighRiskReviewResult,
  ModelCall,
  ModelRosterEntry,
  OwnerAnswer,
  SpecialistModel,
  StaticAuditGate,
  StaticAuditReceiptView,
  TasteReviewRequest,
  TasteReviewResult,
  TasteScreenshot,
  UiPlaywrightContractVerifier,
  VerificationHintLadder,
  WorkerEscalationRequest,
} from "./specialists/index.js";
```

No root `package.json` change. No new workspace package.

## Dependency Intents (New Packages Requested)

None. `node:sqlite` is the Node built-in already used by the foundation. Do not add `zod` on this branch; the three output validators are local structural ports of the Task 009 schemas.

## Contract Change Requests

None.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-102-specialist-review-qa-prompts`.

- `pnpm --filter @ef-harness/planner typecheck` — exit 0.
- `pnpm --filter @ef-harness/planner lint` — exit 0.
- `pnpm --filter @ef-harness/planner test -- specialists` — 3 files, 21 tests passed.
- `node scripts/verify-harmony.mjs --task 102` — exit 0, `harmony ok for Task-102`.

## Known Limitations / Follow-Ups

Local ports stand in for sibling branches that are not on this base. Swap them when those branches are integrated; do not keep both copies.

| Local port | Replace with |
| --- | --- |
| `parseReviewerV1`, `parseTasteReviewerV1`, `parseAskOwnerResponderV1` | `ReviewerV1Schema`, `TasteReviewerV1Schema`, `AskOwnerResponderV1Schema` from `@ef-harness/shared-contracts` (Task 009). Keep the same closed kinds, the `advisory: true` literal, the honest `{ blocked: true }` exit, and the change-list rules. |
| `StaticAuditGate.readReceipt` | The STATIC_AUDIT receipt from the completeness gate (spec names Task 054; on current integration the receipt type lives with Tasks 058/059). `HighRiskDiffReviewer` already accepts the receipt on the request. |
| `UiPlaywrightContractVerifier.captureScreens` | Task 057 capture of full-page, 375px, 1440px, and Task 094 `/__styleguide` shots. |
| `VerificationHintLadder.pushReviewerDefect` | Task 065 `HintLadderController` (the spec names this ladder Task 059). Map the defect into one hint-ladder step. `countsTowardReviewEnvelope` stays true. |
| `MemoryReviewEnvelope` and `BUDGET_PRESSURE_RATIO` | Task 090 `PaperworkBudgetEnvelopeAllocator` integration/review 4% envelope. Taste review skips at high pressure, Prototype, or Cheapest. `reviewer@1` on security and payment diffs still runs. |
| `tagDrift: boolean` | Task 077 diff auto-tag detector. The caller sets the flag when the diff's tags drifted. |
| `seedReceiptId` / `environment: "synthetic_test_env"` | Task 052 synthetic seed receipt. Shots without it are not sent to a vision model. |
| `SpecialistStateDb` column subset | A migrated `state.db`. Reads use `nodes`, `edges` (`depends_on`, `valid_to_rev IS NULL`), `task_runtime`, `task_holds`, `names` (`db_table`), and `check_results`. Feature wave is `nodes.fields.wave`. Started tasks are every runtime state except `DRAFTED`, `READY`, `CANCELLED`, and `SUPERSEDED`. |

`AskOwnerResponderEngine` publishes the sentence built from those rows. A scripted model reply is requested when facts exist and is discarded when it adds a status the rows do not contain. Recognized questions are waiting-task, database-table, auth-test receipts, and feature progress (`Did we add Stripe webhooks yet?`). Anything else is either a keyword hit on decision/spec/rule text or `No recorded fact in state.db answers that. I will not guess.`

Downstream hooks named in the task: Task 095–096 verification review, Task 114 read-only steering Q&A, and Task 174 advisory visual review should construct `HighRiskDiffReviewer`, `AdvisoryTasteVisionReviewer`, and `AskOwnerResponderEngine` from this module after the barrel export above is wired.
