---
task_id: "Task-080"
branch: "task/080-spec-cell-filler-proposed-review"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/spec-expansion/src/filler/**"
  - "packages/spec-expansion/tests/filler/**"
  - ".agent-handoffs/task-080.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 080 handoff

Ordered 3-pass spec cell filler (`spec-expander@1`), deterministic risk floor, EARS/oracle validator, and medium-risk proposed-item review. Commit stays on `task/080-spec-cell-filler-proposed-review`.

## Exports Provided

Import from `packages/spec-expansion/src/filler/index.ts`. The package barrel is frozen, so these names are not re-exported from `@ef-harness/spec-expansion` yet.

Produced for Task 081 (contradiction checking), Tasks 083–084 (architecture synthesis), Task 091 (oracle author), and Task 159 (spec browser review UI):

- `OrderedCellFillerPipeline` — strict Pass 1, then Pass 2, then Pass 3. Later passes do not overwrite earlier passes. Already-filled cells whose source hash is unchanged are skipped. Pass 3 is not called when Pass 1 and Pass 2 cover every active cell.
- `DeterministicPass1And2Filler` — Pass 1 settled `explicit` / `derived` / `delegated` decisions and active `X-01`–`X-14` rules, then Pass 2 chosen-option elaborations and `UP-01`–`UP-08`. A question-covered cell is not filled by a universal policy when the chosen option does not match.
- `LlmCellExpanderPass3` — batches remaining cells by feature and matrix, at most 25 cells per `spec-expander@1` call. One repair call retries only omitted, vague, or malformed cells. A blocked or non-JSON payload repairs the whole batch once.
- `ProposedRequirementReviewQueue` — groups pending medium-risk proposals by feature and matrix. `settle` and `approveAll` apply `Approve all`, `Edit`, and `Reject` in one change set. Edit re-validates EARS and oracle text, supersedes the proposal to `basis = 'explicit'`, and calls the contradiction recheck port. Reject writes a clarification comment and leaves the cell out of the pending group.
- `EarsOracleValidator` — EARS shape, vague wording (`fast`, `intuitive`, `appropriate`, `handle gracefully`, `good ux`) unless the same text names an observable status, message, or bound, a concrete oracle sketch (input plus observable outcome), and unauthorized premises or forbidden scope phrases.
- `applyRiskFloor` — `auth` / `authn` / `authz` / `session`, `payments` / `money` / `billing`, `pii` / `personal_data`, `deletion` / `destructive_write`, `external_side_effect` / `external_api` / `outbound_message` / `inbound_webhook`, matrix `M10`, and refund/delete/payment subjects force `risk: 'high'` even when the model says `low`.
- `FakeModelAdapter` — scripted local stand-in used by the kitchen fixture. No network.
- `openFillerStateDb` / `FillerStateDb` — writes canonical `spec_item` requirement nodes, `derived_from` and `belongs_to` edges, and blocking `must_ask` decision nodes into `schema/state.sql`.
- `MemoryMatrixCellStore` — local cell-fill store until Task 079's `MatrixCellPersistenceRepo` is on this base.
- `RecordingContradictionRecheck` — records Pass 3 conflicts and review edits for Task 081.
- `MemoryChosenForYou` — audit rows for low-risk auto-accepted proposals.
- `parseSpecExpanderOutput` — local structural parse of `spec-expander@1` success and blocked-exit payloads.
- `buildFillMetrics` — `Pass 1 Decisions/Rules: N%`, `Pass 2 Elaborations/UP: N%`, `Pass 3 LLM: N%`. Deterministic passes record `deterministicTokens: 0`.
- Catalogs: `CROSS_CUTTING_RULES`, `UNIVERSAL_POLICIES`, `OPTION_ELABORATIONS`.
- Constants: `PASS3_BATCH_LIMIT` (25), `RISK_TIERS`, `FILL_BASES`, `SETTLED_BASES`, `MATRIX_IDS`.

Requirement nodes are `kind: 'spec_item'` (the schema's requirement kind). Fields include `touches`, `ears_text`, `oracle_sketch`, `basis`, `risk`, `feature`, `cell_id`, `pass`, and `source_ids`. Provenance edges are `derived_from` to the matrix cell and to the decision, rule, elaboration, or policy, plus `belongs_to` the feature.

Risk routing:

- `low` — `fields.basis = 'proposed'`, `nodes.status = 'active'`, `review_status = 'auto_accepted'`, and a Chosen-for-you audit row.
- `medium` — `nodes.status = 'draft'`, `fields.basis = 'proposed'`, `review_status = 'proposed'`, grouped for review before planning.
- `high` or model `status: 'asked'` — no requirement node. A draft `decision` with `must_ask: true` and `blocking: true` is the Discovery question. `nodes.basis` stays null because `asked` is not a basis.

`schema/state.sql` cannot store node status `proposed`. Pending medium items use `draft` plus `fields.basis = 'proposed'` and `fields.review_status = 'proposed'`. Approve and a valid edit set `fields.basis = 'explicit'` and `nodes.status = 'active'`. Reject sets `nodes.status = 'superseded'` and `review_status = 'rejected'`, and inserts a `comment` clarification.

## Shared Wiring Needs (Root / Index Barrels)

`packages/spec-expansion/src/index.ts` is frozen by Task 001. Add this barrel export so later tasks import the filler from `@ef-harness/spec-expansion`:

```ts
export {
  CROSS_CUTTING_RULES,
  DeterministicPass1And2Filler,
  EarsOracleValidator,
  FILL_BASES,
  FakeModelAdapter,
  FillerStateDb,
  LlmCellExpanderPass3,
  MATRIX_IDS,
  MemoryChosenForYou,
  MemoryMatrixCellStore,
  OPTION_ELABORATIONS,
  OrderedCellFillerPipeline,
  PASS3_BATCH_LIMIT,
  ProposedRequirementReviewQueue,
  RISK_TIERS,
  RecordingContradictionRecheck,
  ReviewValidationError,
  SETTLED_BASES,
  UNIVERSAL_POLICIES,
  applyRiskFloor,
  buildFillMetrics,
  cellMatches,
  computeNodeContentHash,
  concreteProposal,
  earsPatternName,
  formatSpecItemId,
  globMatch,
  hashParts,
  isConcreteOracle,
  isVague,
  normalizeEars,
  openFillerStateDb,
  parseExpanderPrompt,
  parseSpecExpanderOutput,
  scopeMatches,
  sha256,
  upstreamDecisionHash,
} from "./filler/index.js";
export type {
  CellOutcome,
  ChangeSetProposal,
  ChosenForYouEntry,
  ChosenForYouPort,
  ChosenOption,
  ClarificationPrompt,
  CommitResult,
  ContradictionRecheckInput,
  ContradictionRecheckPort,
  CrossCuttingRule,
  DecisionEntailment,
  DeterministicClaim,
  EdgeCreate,
  ExpanderPrompt,
  FeatureBudget,
  FillBasis,
  FillDiagnostic,
  FillMetrics,
  FillerRunInput,
  FillerRunResult,
  GraphEdge,
  GraphNode,
  MatrixCellPersistencePort,
  ModelCompletion,
  ModelRequest,
  MustAskQuestion,
  NodeCreate,
  NodeUpdate,
  OpenCell,
  OptionElaboration,
  ParsedExpander,
  Pass3CellResult,
  Pass3Input,
  Pass3Result,
  PersistedFill,
  PromptCell,
  ReadinessSnapshot,
  ReviewEdit,
  ReviewGroup,
  ReviewProposal,
  ReviewSettleCommand,
  ReviewSettleResult,
  RiskFloorInput,
  RiskFloorResult,
  RiskTier,
  SettledBasis,
  SettledDecision,
  SpecExpanderCell,
  SpecExpanderModel,
  UniversalPolicyClause,
} from "./filler/index.js";
```

Do not add a deep import path. Callers should use the package barrel after that wiring lands.

## Dependency Intents (New Packages Requested)

None. The filler uses `node:sqlite`, `node:crypto`, and `node:fs`, plus `@ef-harness/shared-contracts` (`canonicalAssetAbsolute` for `schema/state.sql`), which this package already depends on. Zod is not imported. The local `parseSpecExpanderOutput` stands in for `SpecExpanderV1Schema` until Task 009 is exported from the shared-contracts barrel.

## Contract Change Requests

None. No schema, root manifest, package barrel, or lockfile edits.

Sibling branches are not on this base. Local ports, and the swap when those branches integrate:

- `parseSpecExpanderOutput` matches Task 009 `SpecExpanderV1Schema` per cell (basis `proposed` xor status `asked`, EARS shape, risk, premises). Vague-word rejection stays here, as Task 009's handoff says. Point Pass 3 at `SpecExpanderV1Schema` when `@ef-harness/shared-contracts` exports it, and delete the local structural parser.
- `FillerStateDb.commitChangeSet` / `getNode` follow the Task 017 `ChangeSetProposal` subset (`origin: 'kernel'`, node create/update, edge create) and open canonical `schema/state.sql` with `ef_search_text` registered. Replace `openFillerStateDb` with `KnowledgeGraphRepo` when `@ef-harness/db` exports it. Keep writing `spec_item` nodes and `derived_from` / `belongs_to` edges.
- `MemoryMatrixCellStore` implements `MatrixCellPersistencePort` (`upsertCell`, `saveFill`, `getCell`, `listCells`). Swap the pipeline's `store` for Task 079 `MatrixCellPersistenceRepo`. Cell keys in the kitchen fixture are stable ids; Task 079's `cell:<matrix_id>:<axisA>:<axisB>` keys can be passed through unchanged.
- `CROSS_CUTTING_RULES` copies `X-01`–`X-14` from `v1-knowledge-corpus.md` because Task 077's handoff is still empty. `X-01` is `all: [authz, route]`. `X-07` is `all: [personal_data, logging]`. Other rules use the corpus `any` lists. Replace the catalog with the Task 077 loader.
- `UNIVERSAL_POLICIES` contains two disjoint clause sets that share ids `UP-01`–`UP-08`. `source: 'v1-corpus'` is the screen/form/list cell map in `v1-knowledge-corpus.md` (loading, empty, error, submit, destructive confirm, long list, dates, unknown route). `source: 'task-076'` is the engineering wording in Task 076 (secrets, schema boundary, safe errors, safe mutations, money/time precision, resource limits, accessibility, health/logs) because that task has not landed and its text disagrees with the corpus table. A cell takes one clause. Replace both with the Task 076 policy bundle.
- `OPTION_ELABORATIONS` carries the `data.concurrent_edits` pair from `v1-knowledge-corpus.md` (`last_write_wins`, `optimistic_version`). Pass 2 applies only the chosen option. A cell whose subject matches any elaboration pattern is question-covered and is not filled by a universal policy. Swap for the Task 076 elaboration index.
- `FakeModelAdapter` in this package is a prompt-in, JSON-out stub for `spec-expander@1`. Task 034's `FakeModelAdapter` takes an rng, a clock, and scripted `ModelCompletion`s and does not speak this prompt. Tests use this local class. A later runner can adapt Task 034's adapter if it returns the same `{ text, actualTokens }` completion.
- `RecordingContradictionRecheck.recheck({ reason: 'pass3_conflict' | 'review_edit' | 'review_approve', requirementIds, pairs })` is the Task 081 hook. Pass 3 never overwrites a Pass 1 or Pass 2 cell; a model echo of those cell ids is flagged and the stored text stays. Replace the recorder with `FiveLayerContradictionEngine`.
- `MemoryChosenForYou.record` is the low-risk auto-accept audit until Task 073 `ChosenForYouLedger` is on the barrel.

`computeNodeContentHash` / `formatSpecItemId` (`SI-001`) are local copies of the Task 007 algorithms used by Task 017. Point them at the shared barrel when Task 007 is exported.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-080-spec-cell-filler-proposed-review`:

- `pnpm --filter @ef-harness/spec-expansion test -- filler` — pass. Vitest 5.1.1: 1 file, 10 tests. Kitchen Pass 1 → Pass 2 → Pass 3, Pass 1 immutability when the model echoes a filled cell, deterministic share >= 70% with `deterministicTokens: 0`, zero model calls when Pass 1 and Pass 2 cover every active cell, risk floor promotes payments/PII/deletion/auth/external calls to a blocking must-ask, vague `handle gracefully` / `fast` repair once then `needs_review`, omitted 3 of 20 retried alone, approve 6 / reject 2 with explicit vs proposed basis, edit validation rollback, one requirement node for duplicate EARS text, and a 25-cell call cap.
- `pnpm --filter @ef-harness/spec-expansion typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/spec-expansion lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 080` — pass, printed `harmony ok for Task-080`. That command also ran repo `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- Medium-risk `status = 'proposed'` is stored as `nodes.status = 'draft'` and `fields.review_status = 'proposed'` because `nodes.status` only allows `draft`, `active`, `retired`, and `superseded`.
- High-risk escalation creates a draft `decision` (`must_ask`, `blocking`) rather than a `spec_item`. Task 072 / Task 074 should read those decision nodes.
- The default call budget is 32 calls and 200,000 tokens per feature. A feature that hits the cap leaves the unsent cells `needs_review` with `budget_exceeded` instead of dropping them.
- `FillerStateDb` covers the change-set subset this task writes. It is not a full `KnowledgeGraphRepo` (no impact walk, no read-set checks, no id allocator beyond `SI-###`).
- Near-duplicate requirements collapse when normalized EARS text is identical inside one feature. Weaker paraphrases stay as separate nodes.
- Pass 3 repair is one extra call. A second failure, including a still-omitted cell, stays `needs_review`.
- Review `settle` updates the in-memory cell store before the state.db change set commits. A failed commit would leave the store ahead of the database; the sqlite transaction itself rolls back.
