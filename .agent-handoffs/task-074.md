---
task_id: "Task-074"
branch: "task/074-honest-readiness-calculator"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/discovery/src/readiness/**"
  - "packages/discovery/tests/readiness/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 074 handoff

Honest readiness calculator, denominator-delta explainer, transitive prerequisite gate, and bounded deferral policy. Commit stays on `task/074-honest-readiness-calculator`.

## Exports Provided

Import from `packages/discovery/src/readiness/index.ts` (the package barrel is frozen; see wiring below).

- `ReadinessCalculator` — `project(workItemId)` and `scope(workItemId, scopeId)`. Executes the named `readiness` query from `schema/queries.sql` verbatim and returns `canonical` (`planningTotal`, `planningSettled`, `overallTotal`, `overallSettled`, `criticalOpen`) plus SQL tallies `{ settledExplicit, settledDerived, settledDelegated, settledDefaulted, settledObserved, pendingVerification, openMustAsk, openStandard, partial, missing, conflict, deferred, notApplicable, activeDenominator }`. `settledTotal` and `chosenForYou` (`delegated` + `defaulted`) are also SQL aggregates. `isReadyToPlan` is exactly `openMustAsk === 0 && conflict === 0 && pendingVerification === 0 && openStandard === 0 && partial === 0 && missing === 0 && transitivePrereqsMet === true`. Headlines are exact counts and never contain `%`.
- `DenominatorDeltaExplainer` — `recordBaseline`, `explainTurn`, `writeReopen`, `assertExplained`, `latestSnapshot`, `latestDelta`. Snapshots `{ activeDenominator, scopeIds, criterionIds }` (plus `settledTotal` and `turnId`) after a turn. A changed active set persists a `DenominatorDelta` on outbox type `discovery.denominator_delta`. Unchanged turns do not emit a delta. `assertExplained` throws `SilentDenominatorJumpError` when no snapshot exists or `activeDenominator` moved without a delta.
- `TransitivePrereqChecker` — `check(workItemId, scopeId)` and `checkProject(workItemId)`. Walks current `depends_on` edges between `feature` nodes. Returns `{ met, blockedByPrereq, blockers, cyclic }`. An ancestor with `blockingCount > 0` yields `blocked_by_prereq` scope ids and the ancestor's focusable blockers.
- `BoundedDeferralPolicy` — `defer({ workItemId, decisionId, deferredReason, revisitWave, stage? })` and `listDeferred(workItemId)` for Plan Preview. Success writes `status = 'deferred'`, `deferred_reason`, and `revisit_wave`. Refusal returns `{ ok: false, reason }` and does not write. Hard refusals: must-ask (including `scope_criteria.critical = 1`), active `conflict`, a criterion required by a non-deferred feature (`Required by Orders, Admin Panel, and Invoices`), and a deferral that would exceed the stage budget.
- `ReadyForHandoffGate` — `transition(workItemId)` and `reopenAfterPremiseSupersession({ workItemId, decisionIds, reason, turnId })`. Emits `discovery.scope_ready` with payload `action: "Expand Spec & Plan"` only when `canTransitionToReady` (the blocker formula and `disposition === "active"`). Emits `discovery.scope_reopened` when a ready scope falls back to discovering. Both events register consumer `ui_projection` through the verbatim `register_delivery` query.
- Supporting exports: `openReadinessDatabase`, `namedQuery`, `patchNodeFields`, `canTransitionToReady`, `isReadyToPlan`, `dispositionOf`, `DEFERRAL_BUDGET_PERCENT`, `ReadinessHonestyError`, `SilentDenominatorJumpError`, and the port/report types.

`disposition` is `awaiting_definition` when the latest scope revision has no criteria, `not_applicable` when every criterion is `not_applicable` (`activeDenominator === 0`), and `active` otherwise. Vacuous scopes can still satisfy the blocker conjunction; the gate does not treat them as ready.

Per-scope drilldown is `report.drilldown`: `conflicts`, `mustAsk`, `openStandard`, `pendingVerification`, and `blockedByPrereqScope`. Each blocker carries `focus.targetId` (the decision id) and `focus.kind` (`question` or `conflict`). When `pendingVerification > 0`, `report.actions` includes `{ kind: "retry_verification", label: "Retry verification", decisionIds }`.

Decision fields read by the tally: `status`, `basis`, `must_ask`, `criterion`, `scopeId`, `scopeLabel`, `deferred_reason`, `revisit_wave`. Feature fields: `workItem`, `readinessState` (`discovering` | `ready` | `not_applicable`), optional `stage`. Scope prerequisites are `edges(type = 'depends_on')` from the dependent feature to the ancestor feature. A criterion required by other scopes is `depends_on` from those feature nodes to the decision node.

## Shared Wiring Needs (Root / Index Barrels)

`packages/discovery/src/index.ts` is frozen and was not edited. Integration should re-export the readiness API from `./readiness/index.ts`:

- `ReadinessCalculator`
- `DenominatorDeltaExplainer`
- `TransitivePrereqChecker`
- `BoundedDeferralPolicy`
- `ReadyForHandoffGate`

No root `package.json`, workspace, tsconfig, or eslint change is required.

## Dependency Intents (New Packages Requested)

None. Counts and writes use Node's built-in `node:sqlite` (`DatabaseSync`) and the existing `@ef-harness/shared-contracts` canonical paths for `schema/state.sql` and `schema/queries.sql`. The connection must define `ef_search_text` before node writes; `openReadinessDatabase` and `patchNodeFields` register the same splitter `schema/schema-test.js` uses when it is missing.

## Contract Change Requests

- `discovery_scopes` has no `state` column in frozen `schema/state.sql` (`work_item`, `scope_rev`, `created_rev`, `reason` only). This task does not alter `schema/`. The discovering → ready → discovering lifecycle is stored on `work_items.status` (`discovering` | `ready`) for the work item and on the feature node's `fields.readinessState` for feature scopes such as `S-Auth` and `S-Checkout`. A later additive column `discovery_scopes.state TEXT NOT NULL DEFAULT 'discovering' CHECK (state IN ('discovering','ready','not_applicable'))` would let the gate write the name the task text uses. Until then, readers should use `work_items.status` and `fields.readinessState`.
- The detailed tally is SQL against `scope_criteria` + `nodes` for the latest `scope_rev`. It is not a new named statement in frozen `schema/queries.sql`. The canonical `readiness` statement is loaded and executed unchanged, and R10 is asserted against it (`planning_total 2`, `planning_settled 1`, `overall_total 3`, `overall_settled 1`, `critical_open 1`).
- `proposed` basis and `pending_verification` status never increment `settled*`, even when the verbatim query still counts `fields.status = 'settled'` (a settled `proposed` row is `planning_settled` in `canonical` and `pendingVerification` in the user-facing tally). `SemanticEntailmentPort.verdict` of `pending` or `unavailable` forces the same zero-credit bucket; `contradicts` forces `conflict`. The port cannot grant credit.
- A deferred row that is `must_ask` or `scope_criteria.critical = 1` is classified as open must-ask, so a bypassed deferral cannot clear the gate. `critical_open` from the canonical query remains a separate field.
- Sibling branches are not on this base. Local ports, to swap at integration:
  - `KnowledgeGraphPort.patchNodeFields` → Task 017 `KnowledgeGraphRepo.commitChangeSet`. The default `patchNodeFields` inserts a `change_sets` row (`origin = 'kernel'`) and updates `nodes` with `version + 1`. It does not write `node_changes` or `change_set_reads`.
  - `SemanticEntailmentPort.verdict` → Task 071 `SemanticEntailmentGate`.
  - `StageDepthPort.getStage` → Task 073 `StageDepthController`. Absent port and absent `fields.stage` default to `mvp`.
- Node `content_hash` on readiness writes is SHA-256 of a stable JSON object `{ kind, title, text, fields }`. Swap for Task 007 `computeNodeContentHash` (RFC 8785 + NFC) when that package is wired.
- Outbox types introduced here: `discovery.scope_ready`, `discovery.scope_reopened`, `discovery.denominator_snapshot`, `discovery.denominator_delta`. Each insert is paired with `register_delivery` for `ui_projection`.
- `activeDenominator` excludes `not_applicable` and includes `deferred`. There is no percentage field on `ReadinessReport`.
- Prototype deferral budget is 20% of non-must-ask active criteria, the same ceiling as `mvp`. The spec states `<= 20%` for `mvp` and `<= 5%` for `production` and does not name a prototype figure. The check is integer: `deferredAfter * 100 <= pool * percent`.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-074-honest-readiness-calculator`.

- `pnpm --filter @ef-harness/discovery typecheck` — exit 0.
- `pnpm --filter @ef-harness/discovery lint` — exit 0.
- `pnpm --filter @ef-harness/discovery test -- readiness` — exit 0. Vitest v5.1.1, 5 files, 26 tests passed (exact status/basis counts, R10 canonical parity, 99/100 + 1 conflict, `pending_verification` and entailment `unavailable` zero-credit with `Retry verification`, proposed zero-credit, 0/0 pruned scope, awaiting-definition headline, 16 of 19 headline, transitive `S-Checkout` blocked by `S-Auth` / `auth.session_expiry`, deferral budget and must-ask/conflict/prerequisite refusals, Stripe `15 → 20` delta, `3 settled · +8 new items unlocked (5 Billing, 3 Email)`, auth prune delta, silent-jump refusal, `discovery.scope_ready` plus `ui_projection` delivery, conflict refusal, premise reopen back to `discovering`, pruned scope stays `not_applicable`).
- `node scripts/verify-harmony.mjs --task 074` — exit 0, `harmony ok for Task-074` (includes workspace `pnpm typecheck`, `pnpm lint`, and `pnpm test`).

## Known Limitations / Follow-Ups

- Feature-scope lifecycle lives on `fields.readinessState` and the work item lifecycle on `work_items.status` until `discovery_scopes.state` exists. See Contract Change Requests.
- `partial` and `missing` block `isReadyToPlan` and are named in the headline. The drilldown object keeps the five groups from the task (`conflicts`, `mustAsk`, `openStandard`, `pendingVerification`, `blockedByPrereqScope`) and does not add separate partial/missing lists.
- `settledObserved` is included because `observed` is a legal basis. It counts in `settledTotal` and is not folded into `explicit`.
- Denominator explanations for a single added group, a single pruned group, and a same-turn settle-plus-unlock match the task examples. Mixed add-and-prune in one turn uses `Total items changed A → B after <trigger>`.
- The gate requires a denominator snapshot before `transition`. Call `recordBaseline` (and `explainTurn` after any active-set change) first.
- Plan Preview (Task 108) should call `BoundedDeferralPolicy.listDeferred`. Discover progress (Task 123) should render `headline` and `DenominatorDeltaExplainer` explanations, never a rounded percent. Spec expansion (Task 079) should call `ReadyForHandoffGate.transition` and treat `discovery.scope_ready` as the enablement for `Expand Spec & Plan`.
