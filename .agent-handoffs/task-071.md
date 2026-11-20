---
task_id: "Task-071"
branch: "task/071-entailment-derivations-reopening"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/discovery/src/entailment/**"
  - "packages/discovery/tests/entailment/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 071 handoff

Independent `entailment-checker@1` gate, acyclic derivation checks, cross-chunk retraction, and selective premise reopening. Commit stays on `task/071-entailment-derivations-reopening`.

## Exports Provided

Import from `packages/discovery/src/entailment/index.ts` (the package barrel is intentionally unchanged):

- `SemanticEntailmentGate` — batches `entailment-checker@1` for every derived claim and every costly or hard-to-reverse explicit claim. The model packet is only `{ criterion, proposedValue, citedExcerptsWithSurroundingParagraph, rule, premises }`. Only `verdict === "establishes"` settles a claim. `leaves_open`, a blocked honest exit, a schema miss, a timeout, and HTTP 503 stay `pending_verification` with zero readiness credit. `contradicts` is stored as `conflict`.
- `DerivationChainValidator` — before any model call, rejects a rule missing from the criterion allowlist (`RuleNotAllowlistedError`), a self-cycle or mutual cycle (`CyclicDerivationError` with the node path, e.g. `["D-A", "D-B", "D-A"]`), an unsettled or retracted premise (`UnsettledPremiseError`), an assistant paraphrase or non-grounded root (`UngroundedDerivationError`), and a derived costly, hard-to-reverse, or must-ask claim (`CostlyDerivationError`). Roots must be settled `explicit`, `delegated`, or `observed`.
- `LongTurnRetractionReconciler` — reconciles every chunk of one submitted turn before `commit()`. `"Maybe add printing … actually, scrap printing"` and `"Maybe print … actually scrap print"` produce zero printing nodes. A lone printing request stays in the current release. `"Add printing after launch"` is stored with `release: "later"`.
- `PremiseSupersessionReopener` — walks only current `derived_from` edges. `supersede(premiseId, "superseded" | "retracted")` reopens a dependent with no surviving support (`status: "open"`, previous version kept), re-anchors a dependent that still has independent `explicit_value` user evidence to `basis: "explicit"`, and does not touch nodes reachable only through other edge types such as `depends_on`. `reopenDependents` does the same walk when the premise row itself stays settled under a new value.
- `ReplacementSecondEventDisambiguator` — `"Actually set the cutoff to 10:45"` replaces `11:00`, keeps the old fact in history, and reopens derived dependents. `"Kitchen wants final counts at 10:45"` keeps both readings and returns `clarify@1`.
- `LowConfidenceDictationHold` — a low-confidence dictated time, amount, count, or behavioral name stays `open`. The change summary bolds the value (`**10:45**`).
- `FakeModelAdapter` — offline scripted `entailment-checker@1` port used by the unit tests. `MemoryEntailmentMetrics` records `(resolverModel, entailmentModel, verdict, criterionKind)`.
- `selectEntailmentModel` — when two or more families are connected, routes the checker to a family other than `batch-resolve@1`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/discovery/src/index.ts` on this branch. Integration should add:

```ts
export {
  SemanticEntailmentGate,
  DerivationChainValidator,
  LongTurnRetractionReconciler,
  PremiseSupersessionReopener,
  ReplacementSecondEventDisambiguator,
  LowConfidenceDictationHold,
} from "./entailment/index.js";
```

No root `package.json`, workspace, tsconfig, or eslint change.

## Dependency Intents (New Packages Requested)

None. No package.json dependency is added. Zod is not on this foundation base, so the entailment output is checked by the local parser below instead of a new dependency.

## Contract Change Requests

None. `pending_verification` is stored in `nodes.fields.status`. `nodes.status` stays the lifecycle vocabulary (`active` / `superseded`). Validated derivations are temporal `edges(src = derived decision, type = "derived_from", dst = premise)`. Premise ids may also appear in `fields.premises`; the reopener ignores ids that are only in JSON.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-071-entailment-derivations-reopening`:

- `pnpm --filter @ef-harness/discovery typecheck` — exit 0.
- `pnpm --filter @ef-harness/discovery lint` — exit 0.
- `pnpm --filter @ef-harness/discovery test -- entailment` — 4 files, 14 tests, all passed. Covers the phone-link pair (`"link on a phone"` / `"link on their phones"` accepts `menu.mobile_web` and leaves offline and native `leaves_open`), cycle / allowlist / unsettled-premise rejection, `derived_from` persistence, D2 reopen / D3 explicit re-anchor / D4 and `depends_on` spillover ignored, cross-chunk printing retraction, timeout and HTTP 503 fail-closed, replacement vs second event, and the low-confidence hold.
- `node scripts/verify-harmony.mjs --task 071` — exit 0, `harmony ok for Task-071`.

## Known Limitations / Follow-Ups

Sibling branches are not merged. These local ports must be swapped at integration; do not import the unpublished packages as if they were already on `harness/integration`.

- **Task 009 `EntailmentCheckerV1Schema`:** `parseEntailmentCheckerV1` accepts `{ verdict: establishes|contradicts|leaves_open, reason }` or `{ blocked: true, reason, missing_ids? }` and rejects extra keys. Replace it with `EntailmentCheckerV1Schema` from `@ef-harness/shared-contracts` once Task 009 is wired.
- **Task 017 `KnowledgeGraphRepo`:** `KnowledgeGraphPort` uses `currentRevision`, `getNode`, `getEdgesAsOf`, and `commitChangeSet`. Tests use `InMemoryKnowledgeGraph`. Inject `KnowledgeGraphRepo` so the same writes hit `state.db`. The in-memory content hash is SHA-256 of a stable JSON form, not the repo's JCS hasher.
- **Task 070 `ExactQuoteEvidenceVerifier` / `QuoteValidationResult`:** `LocalExactQuoteEvidenceVerifier` checks developer authorship, span equality, digits, and adjacent negations. Swap the class for the Task 070 export. `TurnDirectory` is the local turn lookup until Task 069 exposes committed turns.
- **Task 034 `FakeModelAdapter`:** that adapter's `complete()` returns worker tool outcomes. This task's `FakeModelAdapter` scripts entailment JSON, timeouts, and 503s. Keep the entailment port, or translate Task 034 completions into `EntailmentModelResponse`. Do not point the gate at the sim adapter directly.
- **Catalog allowlist:** `MapInferenceCatalog` is the stand-in until the discovery catalog loader publishes per-criterion `allowed_inference_rules`.
- **Task 191 metrics:** `EntailmentMetricSink.record({ resolverModel, entailmentModel, verdict, criterionKind })` is in memory. Meta-Lab should subscribe. `verdict: "unavailable"` covers timeout, 503, blocked exits, and schema misses.
- **Task 074 / 082 / 098 / 194** can construct `SemanticEntailmentGate`, `DerivationChainValidator`, `LongTurnRetractionReconciler`, and `PremiseSupersessionReopener` from this folder. Readiness credit is `earnsReadinessCredit`: only `status === "settled"` with a basis and `retracted === false`.
- Retraction matching is deterministic stem overlap (`print` / `printing`) plus an explicit cue list (`scrap`, `scratch`, `never mind`, and the other cues in the reconciler). It does not call a model.
- A second event keeps the existing cutoff settled and writes an open `kitchen.final_counts` row plus the `clarify@1` question. It does not turn the cutoff into a conflict by itself.
- Cross-family selection picks the lexicographically first connected family that is not the `batch-resolve@1` family. One connected family still runs, and a failed call stays pending.
