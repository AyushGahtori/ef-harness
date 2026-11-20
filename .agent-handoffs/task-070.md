---
task_id: "Task-070"
branch: "task/070-discovery-prompts-quote-verifier"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/discovery/src/prompts/**"
  - "packages/discovery/tests/prompts/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 070 handoff

Discovery prompt runners and the deterministic quote verifier. Commit stays on `task/070-discovery-prompts-quote-verifier`.

## Exports Provided

Import from `packages/discovery/src/prompts/index.ts` until the package barrel is wired:

- `DiscoveryPromptOrchestrator` — `runOpeningReview`, `runBatchResolve`, `runClarify`
- `ExactQuoteEvidenceVerifier` — `validateSpan`, `validateClaim`
- `QuoteValidationResult` — `{ accepted, code, message, turnId, start, end, quote, criterionId, questionId }`
- `evaluateProposal` — per-criterion judge used by the batch runner (sibling failures do not change it)
- `OPENING_RUBRIC_MAP_V1`, `openingRubricTargets`, `assertOpeningRubricMap`, `InvalidRubricMapError`
- `OpeningReviewV1Schema`, `BatchResolveV1Schema`, `ClarifyV1Schema` (local ports)
- `buildPromptEnvelope`, `buildFormatRepairMessage`, `escapeUntrusted`
- `FakeModelAdapter` and `ModelProtocolAdapter` (local ports)
- `loadDiscoveryPromptText`, `loadInferOrAskSkillDigest`
- Request and result types: `OpeningReviewRequest`, `OpeningReviewResult`, `BatchResolveRequest`, `BatchResolveResult`, `ClarifyRequest`, `ClarifyResult`, `DiscoveryTurn`, `EvidenceSpan`, `SettledDecision`, `UnsettledDecision`, `PendingDecision`

`QuoteDecisionCode` values callers will see: `accepted`, `turn_not_found`, `assistant_author`, `out_of_bounds`, `retracted`, `superseded`, `quote_mismatch`, `digit_altered`, `negation_dropped`, `currency_altered`, `positional_unbound`, `stale_options_version`, `unknown_criterion`, `unknown_question`, `recommendation_not_evidence`, `uncertainty_not_explicit`, `injection_not_evidence`, `negation_blocks_value`, `broadened_inference`, `recipient_not_established`, `baseline_is_not_a_requirement`.

Batch pending codes that are not quote codes: `costly_derivation`, `rule_not_allowlisted`, `rule_criterion_mismatch`, `rule_value_mismatch`, `unresolved_premises`, `self_support`, `circular_support`, `delegation_unbounded`, `two_readings_must_conflict`, `conflict_missing_reading`, `duplicate_criterion`, `missing_proposal`, `schema_invalid`, `evidence_required`.

Runner behavior Task 071, Task 098, and Task 191 can rely on:

- `opening-review@1` loads the blockquote under that heading in `opening-prompts.md`, wraps the transcript in `<user>`, and puts turn id, author, text, and retraction flags in escaped `<data source="turns">`. It parses `OpeningReviewV1Schema` (honest `blocked` exit included), quote-checks every claim that cites a span (value claims and recommendation or delegation claims), maps covered rubrics through `opening-rubric-map@1`, and splits domains into `certainDomains` vs `uncertainDomains` (`needsScopeProbe`).
- `batch-resolve@1` pins `infer-or-ask@1` (skill file version must be 1) plus the active criteria, allowlisted rules, prior facts, and the same turns block inside escaped `<data>` blocks. Each proposal is judged alone. Settled siblings stay in `settled`. Correct `missing` / `partial` / `conflict` rows stay in `unsettled`. Failures stay in `pending`. Ids that are not on the active list never become credits. Separately shaped `proposed_gaps` are returned only when the id is not active.
- Every runner result carries `promptVersion`, `rubricVersion`, and `ruleIds` from the envelope (`opening-rubric-map@1` or `infer-or-ask@1`).
- Two-reading statements (`the kitchen wants a printed list`, or `criterion.twoReadings`) must come back as `status: "conflict"` with both spans. The orchestrator then calls `clarify@1` unless `autoClarify: false`. A silent guess is not settled.
- `clarify@1` keeps `question_id` and `criterion`, requires `free_text: true`, offers the supplied options, and returns `decision: { status: "open", value: null, basis: null }` even when the model output is rejected.
- Schema failures of a whole document get one format-repair call (`role: "format_repair"`, validator paths only, transcript not repeated) and then one `stronger_reviewer` call. A third repair is not attempted. A batch that has at least one schema-valid proposal does not retry the whole document; invalid items become `pending` with `schema_invalid`.
- `basis: "derived"` is rejected in code for `mustAsk`, `costly`, `hardToReverse`, costly `kind`s, and criterion ids that name paid services, identity, retention, deletion, legal, or compliance. Explicit evidence or a bounded delegation (`limits` containing the value) is required instead.
- Positional quotes `yes` and `use the second one` (also first/third/fourth) require `OptionsVersionBinding` whose `optionsVersionAtInputStart === replyOptionsVersion`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/discovery/src/index.ts` is frozen. Re-export the public surface from the prompts folder:

```ts
export {
  DiscoveryPromptOrchestrator,
  ExactQuoteEvidenceVerifier,
  evaluateProposal,
  OpeningReviewV1Schema,
  BatchResolveV1Schema,
  ClarifyV1Schema,
  buildPromptEnvelope,
  buildFormatRepairMessage,
  FakeModelAdapter,
  OPENING_RUBRIC_MAP_V1,
  assertOpeningRubricMap,
  InvalidRubricMapError,
  PROMPT_IDS,
} from "./prompts/index.js";
export type {
  QuoteValidationResult,
  QuoteDecisionCode,
  ModelProtocolAdapter,
  OpeningReviewResult,
  BatchResolveResult,
  ClarifyResult,
  DiscoveryTurn,
  EvidenceSpan,
} from "./prompts/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or `packages/shared-contracts/src/index.ts` edit is required for this task.

## Dependency Intents (New Packages Requested)

None. Do not add `zod` to `@ef-harness/discovery` for this task. The closed parsers in `ports.ts` stand in for Task 009 until that package export exists.

## Contract Change Requests

None. Output shapes follow `prompt-contracts.md` discovery schemas and the basis vocabulary in `database-design.md` (`explicit` | `derived` | `delegated`, null unless `status` is `settled`).

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-070-discovery-prompts-quote-verifier`:

- `pnpm --filter @ef-harness/discovery typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/discovery lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/discovery test -- prompts` — pass, 4 files, 33 tests. Covers infer-or-ask rules 1–8 (positive and adversarial), the opening lunch example, opening.4 demo credit, `"Email the totals"` channel settled / recipient missing, `"open the link on their phones"` with no offline or native credit, the worked batch, clarify `Q17` staying open, `10:45` preserved, sibling preservation, `billing.crypto` rejected, one format-repair plus escalation, tag-escape of `</data><instruction>`, in-turn `scrap <topic>` overlap (including the scrap phrase itself), prompt version pins, and a harness citation on a recommendation request.
- `node scripts/verify-harmony.mjs --task 070` — pass (`harmony ok for Task-070`, exit 0). That command also re-ran repo `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

Local ports, swapped when the sibling branch is integrated:

- Task 009: replace `OpeningReviewV1Schema`, `BatchResolveV1Schema`, `ClarifyV1Schema`, `buildPromptEnvelope`, `buildFormatRepairMessage`, and `escapeUntrusted` in `packages/discovery/src/prompts/ports.ts` with the published Zod validators and envelope from `@ef-harness/shared-contracts`. Keep calling them by those names. Do not import that package's prompts path until `packages/shared-contracts/src/index.ts` actually exports it.
- Task 053: replace the local `ModelProtocolAdapter` (`complete` only) with the providers adapter. Runners send `{ role, promptId, prompt }` and read `{ text }`.
- Task 034: replace test `FakeModelAdapter` with the sim adapter. Tests branch on `request.role` and `request.promptId`.
- Task 069: replace `OPENING_RUBRIC_MAP_V1` / `assertOpeningRubricMap` with `OpeningRubricMapper` and the core map. The table is the one in `opening-prompts.md` (`opening.1` → `product.purpose`, `delivery.platform`; `opening.2` → `product.audience`, `actors.roles`; `opening.3` → `workflows.primary`, `data.entities` partial; `opening.4` → `workflows.primary`, `product.stage` partial; `opening.5` → `constraints.stack_preferences`, `deploy.target`, `constraints.deadline_budget`, plus delegations).

Left for later tasks, not implemented here:

- Task 071 semantic entailment (`establishes` / `contradicts` / `leaves_open`), full acyclic `derived_from` walks, and cross-chunk retraction. This task rejects self-support, mutual support visible through `PriorFact.criterionId` in the same batch, every in-turn mention that overlaps a `scrap <topic>` token (an optional `the` / `a` / `an` is skipped), and caller-supplied `retracted` / `superseded` spans.
- Task 098 should pass normalized-document locators through `ExactQuoteEvidenceVerifier` the same way turns are passed: author must be `developer` (or a future document-span port), and `[start, end)` must match the quote with digits, currency symbols, and negation tokens preserved.
- Persisting decisions to `state.db` is out of scope. Runners return settled / unsettled / pending records and do not write nodes.
