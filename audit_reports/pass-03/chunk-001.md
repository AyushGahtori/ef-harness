# Pass 03 — Chunk 001: Discovery Engine Core, Prompts, Entailment, Selector, Depth & Readiness (`Tasks 069–074`)

## 1. Chunk identification and scope
- **Pass number:** Pass 03
- **Chunk ID:** `pass-03/chunk-001`
- **Unit IDs:** `Task 069`, `Task 070`, `Task 071`, `Task 072`, `Task 073`, `Task 074`
- **Branches and commits:**
  - `task/069-discovery-core-opening-rubrics` (`0df0a18`, merged into `harness/integration`)
  - `task/070-discovery-prompts-quote-verifier` (`326728d`, merged into `harness/integration`)
  - `task/071-entailment-derivations-reopening` (`2c91b46`, merged into `harness/integration`)
  - `task/072-adaptive-question-selector` (`7f8f233`, merged into `harness/integration`)
  - `task/073-discovery-depth-controls` (`47801e2`, merged into `harness/integration`)
  - `task/074-honest-readiness-calculator` (`27758b5`, merged into `harness/integration`)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration/packages/discovery` (clean across `task-069`..`task-074`)
- **Governing architecture documents:** `project-discovery.md`, `opening-prompts.md`, `discovery-depth-and-catalog.md`, `prompt-contracts.md`, `skills/infer-or-ask/SKILL.md`, `database-design.md`, `architecture-deep-review.md`, `schema/state.sql`, `schema/queries.sql`, `IMPLEMENTATION_TASKS.md` (`Tasks 069–074`).

## 2. Units inspected
- `Task 069` (`0df0a18`), `Task 070` (`326728d`), `Task 071` (`2c91b46`), `Task 072` (`7f8f233`), `Task 073` (`47801e2`), `Task 074` (`27758b5`).

## 3. Files inspected
- `IMPLEMENTATION_TASKS.md` (`lines 4241–4586`)
- `packages/discovery/package.json`
- `packages/discovery/src/index.ts`
- `packages/discovery/src/core/{decision-fields.ts,discovery-db-repo.ts,session-manager.ts,sqlite-state.ts}`
- `packages/discovery/src/prompts/{discovery-prompt-orchestrator.ts,ports.ts}`
- `packages/discovery/src/entailment/{semantic-entailment-gate.ts,derivation-chain-validator.ts}`
- `packages/discovery/src/selector/engine.ts`
- `packages/discovery/src/depth/{stage-depth-controller.ts,sqlite-state.ts}`
- `packages/discovery/src/readiness/{readiness-calculator.ts,ready-for-handoff-gate.ts,sql.ts,graph.ts}`

## 4. Architecture documents consulted
- `project-discovery.md` & `opening-prompts.md` (5 opening prompts, `opening-rubric-map@1`, explicit-submit-only turns, exact quote verification, independent `entailment-checker@1`)
- `discovery-depth-and-catalog.md` (stage presets, `ask_value`, fixed must-ask floor, `Chosen for you` ledger, honest exact-count readiness, bounded deferrals)
- `prompt-contracts.md` & `skills/infer-or-ask/SKILL.md` (`opening-review@1`, `batch-resolve@1`, `clarify@1`, `entailment-checker@1`, `question-drafter@1`)
- `database-design.md`, `schema/state.sql`, `schema/queries.sql` (`work_items`, `discovery_scopes`, `scope_criteria`, `discovery_batches`, `turns`, `nodes` decision `fields`)

## 5. Contracts and signatures discovered
- `DiscoverySessionManager` (`core/session-manager.ts`): synchronous `send(input: { workItemId, text, target, opId }): SendResult`, `selectDelegatedValue(...)`, `placeBatch(...)`, `reviseScope(...)`
- `DiscoveryDbRepo` (`core/discovery-db-repo.ts`): wraps `core/knowledge-graph-port.ts` `KnowledgeGraphRepo`
- `DiscoveryPromptOrchestrator` (`prompts/discovery-prompt-orchestrator.ts`): async `runOpeningReview(req): Promise<OpeningReviewResult>`, `runBatchResolve(req): Promise<BatchResolveResult>`, `runClarify(req): Promise<ClarifyResult>`
- `ExactQuoteEvidenceVerifier` (`prompts/exact-quote-evidence-verifier.ts`): `validateSpan(span): QuoteValidationResult`, `validateClaim(spans, ctx): QuoteValidationResult`
- `SemanticEntailmentGate` (`entailment/semantic-entailment-gate.ts`): synchronous `checkAll(claims): EntailmentBatchResult`, `DerivationChainValidator`, `LongTurnRetractionReconciler`, `PremiseSupersessionReopener`
- `selectNextBatch` / `GreedyQuestionSelector` / `ProjectLocalQuestionDrafter` (`selector/engine.ts`)
- `StageDepthController` / `AskValueInterrogationGuard` / `MustAskPolicyFloor` / `AutopilotDelegationEngine` / `ChosenForYouLedger` (`depth/`)
- `ReadinessCalculator` / `ReadyForHandoffGate` / `DenominatorDeltaExplainer` / `BoundedDeferralPolicy` (`readiness/`)

## 6. Confirmed findings
- **F-029** — `packages/discovery` (`Tasks 069–074`) has 6 disconnected intra-package silos, 4 incompatible `KnowledgeGraph`/SQLite interfaces, sync-vs-async model/session mismatches (`DiscoverySessionManager.send` + `SemanticEntailmentGate.complete` sync vs `DiscoveryPromptOrchestrator` + `ModelProtocolAdapter` async), and destructive/crashing `decision` `fields` JSON schema mismatches (`core` `parseDecisionFields` throws `BasisStatusSeparationError` on non-opening `evidence` lacking `rubricId` and strips `must_ask`/`scopeId`/`deferred_reason`/`revisit_wave`/`delegated_at`/`rationale`/`rule`/`premises`, while `entailment` writes `mustAsk`/`feature` camelCase vs `readiness/sql.ts` reading `$.must_ask`/`$.scopeId`/`$.workItem`).
- **F-030** — `packages/discovery/src/core/decision-fields.ts` `valueSatisfiesLimits` hardcodes ONLY `{ sqlite: ["free", "local"] }`, throwing `DelegationBoundsError` for every other delegated technology/option in the system.
- **F-031** — `packages/discovery/src/prompts/ports.ts` (`repositoryRoot`, `loadDiscoveryPromptText`, `loadInferOrAskSkillDigest`) walks parent directories looking for `pnpm-workspace.yaml` and `opening-prompts.md` on disk (failing in packaged Electron builds), duplicates `Task 009` prompt schemas/envelopes, and `core/sqlite-state.ts`, `depth/sqlite-state.ts`, `readiness/sql.ts` add 3 more divergent `ef_search_text` UDFs + standalone `DatabaseSync` openers (cross-referencing `F-010`, `F-012`).

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `Task 009` (`shared-contracts/prompts`) + `Task 017` (`db/knowledge`) + `Task 053` (`worker-loop/protocols`) → consumed by `packages/discovery` (`069–074`).
- `Task 069` (`core`) ↔ `Task 070` (`prompts`) ↔ `Task 071` (`entailment`) ↔ `Task 072` (`selector`) ↔ `Task 073` (`depth`) ↔ `Task 074` (`readiness`).
- `packages/discovery` (`069–074`) → consumed by `spec-expansion` (`079–081`), `research-engine` (`082`), `intake` (`098`), `planner/plan-preview` (`108`), `renderer` (`123, 153, 155`), `brownfield` (`169`), `meta-lab` (`190, 191, 194`).

## 9. Defects and missing integrations
- Zero dependency on `@ef-harness/db` or `@ef-harness/worker-loop` in `packages/discovery/package.json`.
- All 6 discovery submodules operate on incompatible local ports and conflicting `nodes.fields` JSON shapes for `kind = 'decision'`.
- Hardcoded `{ sqlite: ["free", "local"] }` delegation table in `core/decision-fields.ts`.
- Monorepo-only `pnpm-workspace.yaml` filesystem walk in `prompts/ports.ts`.

## 10. Tests and verification performed
- Inspected actual TypeScript implementations across all 6 `packages/discovery` submodules (`069–074`) and verified against `schema/state.sql`, `schema/queries.sql`, and `IMPLEMENTATION_TASKS.md`.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- `packages/discovery/src/corpus-loader/**` (`075`), `packages/discovery/src/skills/**` (`078`), and `corpus/**` (`075–078` + unmerged `103–104`) — next in `pass-03/chunk-002`.
