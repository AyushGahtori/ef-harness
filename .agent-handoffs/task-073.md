---
task_id: "Task-073"
branch: "task/073-discovery-depth-controls"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - packages/discovery/src/depth/**
  - packages/discovery/tests/depth/**
  - .agent-handoffs/task-073.md
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 073 handoff

Stage depth presets, the integer `ask_value` guard, the fixed must-ask floor, one-click delegation, Autopilot, and the Chosen for you ledger. Commit stays on `task/073-discovery-depth-controls`.

## Exports Provided

`packages/discovery/src/depth/index.ts`:

- `StageDepthController` — `chip()`, `profile()`, `recommendationFor(criterionId)`, `switchStage(stage)`. Persists `prototype | mvp | production` (default `mvp`) on arch node `project-stage:<workItemId>` because `node_kinds` has no `project` kind. `switchStage` is the promotion/demotion reconciler. It never rewrites `basis = explicit`. A stricter stage reopens previously `defaulted` criteria whose `ask_value` now meets the threshold and sets the scope reason to `+N criteria added for <Stage> stage`. A looser stage settles still-open criteria that no longer apply as `defaulted`.
- `AskValueInterrogationGuard` — `reconcile(stage)`. `ask_value = impact × uncertainty` with integer weights (`RISK_WEIGHT`, `REWORK_WEIGHT`, `STAGE_IMPACT_MULTIPLIER`, `ASK_THRESHOLD`, `IMPORTANCE_THRESHOLD`, `VISIBLE_QUESTION_CAP`). Below-threshold criteria are stored as `basis = defaulted`. Overflow past the stage's visible cap is stored the same way and kept on the ledger. `computeAskScore` and `isBelowAskThreshold` are pure.
- `MustAskPolicyFloor` — `assess(entry)`, `noteUserText(text)`, `markContradiction(criterionId)`, `signals()`. Hard-coded classes: `authentication_roles`, `payments_side_effects`, `retention_privacy_pii`, `core_workflow`, `deployment_target` (skipped only when `deploymentObvious`), `user_contradiction`. `Stripe` escalates `domain: payments`. `HIPAA` escalates `domain: sensitive_data`. A vague prompt such as `Build a SaaS app` also forces auth, core workflow, and `domain: data_model`. Signals only turn on.
- `AutopilotDelegationEngine` — `run({ cancelAfter })`. Each delegated criterion is its own transaction with `basis = delegated`. Cancellation is checked before the next criterion. Halt reasons: `must_ask`, `conflict`, `high_risk_spec_expander`, `ambiguous_brownfield`, `missing_recommendation`, `cancelled`.
- `ChosenForYouLedger` — `view()`, `forPlanPreview()`, `override(criterionId, optionId, reopener)`. Every active `delegated` or `defaulted` decision is listed with `{ criterionLabel, chosenValue, basis, rationale, impactLevel, downstreamTaskCount }` plus `Change` / `Override` routes to Task 087 and a Plan Preview flag for Task 108. Override writes `basis = explicit`, records `supersession`, and reopens `derived` dependents.
- `AcceptAllRecommendedAction.accept({ scope: "batch" | "open", criterionIds, k })` — batch or scope delegation. Must-ask rows stay open with `Needs your decision (must-ask: handles payments)` for payments. Never writes `explicit`.
- `DepthSession` — in-memory `schema/state.sql` fixture that wires the controllers. `recordExplicit` is the only direct explicit writer besides ledger override.
- `stageProfile(stage)` — ask threshold, importance threshold, visible cap, and verification strictness (`relaxed` / `standard` / `strict`).
- Integer tables: prototype ask 8 / importance 6 / cap 10; mvp 12 / 3 / 16; production 4 / 1 / 25. Impact multipliers: 1, 2, 4.

`assertAutomaticBasis` throws `BasisHonestyError` for any basis other than `delegated` or `defaulted`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/discovery/src/index.ts` is frozen by Task 001. Add this barrel export so later tasks import depth controls from `@ef-harness/discovery`:

```ts
export {
  AcceptAllRecommendedAction,
  AskValueInterrogationGuard,
  AutopilotDelegationEngine,
  BasisHonestyError,
  CatalogError,
  CatalogIndex,
  ChosenForYouLedger,
  DepthError,
  DepthSession,
  LocalGreedyQuestionSelector,
  LocalPremiseSupersessionReopener,
  LocalSqliteKnowledgeGraph,
  MustAskPolicyFloor,
  RecommendationError,
  StageDepthController,
  StageSwitchError,
  StaleDecisionError,
  UnknownCriterionError,
  assertAutomaticBasis,
  computeAskScore,
  isBelowAskThreshold,
  openDepthKnowledgeGraph,
  resolveStageRecommendation,
  stageProfile,
} from "./depth/index.js";
export type {
  AcceptAllResult,
  AskScore,
  AutopilotResult,
  DepthCatalogEntry,
  DepthDecision,
  GreedyQuestionSelector,
  HaltReason,
  KnowledgeGraphRepo,
  LedgerEntry,
  LedgerView,
  MustAskClass,
  OverrideResult,
  PremiseSupersessionReopener,
  ProjectStage,
  RecommendationResolution,
  StageChipModel,
  StageProfile,
  StageSwitchResult,
} from "./depth/index.js";
```

Do not edit `packages/discovery/package.json`. No new dependency is required.

## Dependency Intents (New Packages Requested)

None. Persistence uses built-in `node:sqlite` and `node:crypto` against `schema/state.sql`.

## Contract Change Requests

None. No schema, root manifest, or shared-contract edits.

Upstream bindings, used because sibling branches are not on `harness/integration`:

- `KnowledgeGraphRepo` in `packages/discovery/src/depth/knowledge-graph.ts` is a local port of Task 017. `openDepthKnowledgeGraph` / `LocalSqliteKnowledgeGraph` apply `schema/state.sql`, register `ef_search_text`, and write change sets, decision nodes, the project-stage arch node, discovery scopes, scope criteria, and `derived_from` edges. Replace with `openKnowledgeGraph` from `@ef-harness/db` when Task 017 is integrated, and map these writes onto `commitChangeSet` / `getNode`. Discovery is layer 2, so it cannot import `@ef-harness/db` (also layer 2) until an integrator re-exports the repository through a lower layer or the discovery barrel.
- `LocalGreedyQuestionSelector` is a local port of Task 072 `GreedyQuestionSelector`. It scores uncovered criteria and returns 1..4 questions. `AcceptAllRecommendedAction` and `AutopilotDelegationEngine` call `selectBatch`. Swap the class for the Task 072 export without changing the `GreedyQuestionSelector` method shape.
- `LocalPremiseSupersessionReopener` is a local port of Task 071 `PremiseSupersessionReopener`. Ledger override calls `reopenDependents(premiseDecisionId)`, which reopens `derived_from` dependents whose basis is not `explicit`. Swap for the Task 071 export when that branch lands.
- `localContentHash` is a local stand-in for Task 007 `computeNodeContentHash` (SHA-256 of a sorted `{ kind, title, text, fields }` encoding). Swap for the shared RFC 8785 helper when it is exported.
- `stateSchemaPath()` reads `schema/state.sql` by relative path. That is the same file as `canonicalAssetAbsolute("stateSql")`. The shared-contracts barrel publishes `dist`, which is not built for `vitest` on this base, so the depth package does not import it at runtime.

`scope_criteria` stays pointed at the same decision id when a ledger item is overridden. Supersession is the `node_versions` interval plus `fields.supersession` (`previous_basis`, `previous_value`, `previous_version`). Nodes are not deleted.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-073-discovery-depth-controls`:

- `pnpm --filter @ef-harness/discovery test -- depth` — pass. Vitest 5.1.1: 3 files, 20 tests passed (three stage presets, all six must-ask classes, safe MVP fallback versus option zero, Stripe/HIPAA escalation, vague SaaS halt, accept-all anti-silent payments badge, autopilot halt reasons, cancel-before-next-criterion, transaction rollback, prototype-to-production `+6` banner with 15 explicit decisions preserved, MVP promotion, production-to-prototype downgrade with history, visible-question cap, ledger override and derived reopen, plan-preview ledger completeness).
- `pnpm --filter @ef-harness/discovery typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/discovery lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 073` — pass (`harmony ok for Task-073`).

## Known Limitations / Follow-Ups

- Autopilot delegates every currently resolvable open criterion, then reports the first remaining blocker in criterion-id order. It does not skip a must-ask in order to invent product decisions. A vague `Build a SaaS app` catalog of workflow, auth, and data-model criteria halts with nothing settled.
- `partial` and `missing` criteria are not auto-settled. If they have no stronger halt reason they are reported as `missing_recommendation`.
- Delegated decisions are kept across a stage change. Only `defaulted` decisions are reopened when `ask_value` crosses the new threshold, and only non-explicit open criteria are downgraded when they stop applying.
- The visible cap counts non-must-ask questions that would otherwise be asked. Must-ask questions stay visible in addition to that cap.
- `node:sqlite` transactions are synchronous. Cancel is observed between criterion transactions, which is what makes the in-flight decision commit and the next one stay unwritten.
- Task 108 should read `ChosenForYouLedger.forPlanPreview()` before Start Build. Task 123 should bind the Discover chip to `StageDepthController.chip()` and `switchStage`. Task 074 should read `stageProfile` thresholds from this module once the discovery barrel re-exports it.
