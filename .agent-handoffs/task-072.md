---
task_id: "Task-072"
branch: "task/072-adaptive-question-selector"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/discovery/src/selector/**"
  - "packages/discovery/tests/selector/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 072 handoff

Adaptive greedy maximum-coverage question selector and project-local question drafter (`question-drafter@1`). Commit stays on `task/072-adaptive-question-selector`.

## Exports Provided

Import from `packages/discovery/src/selector/index.ts` (the package barrel does not re-export these yet):

- `GreedyQuestionSelector` — greedy maximum-coverage picks. Marginal weights are must-ask, then conflict, then prerequisite-unblocker, then a standard open criterion. After each pick the covered criteria are removed. Tie-break is `(is_conflict DESC, is_must_ask DESC, downstream_unblock_count DESC, catalog_priority ASC, question_id ASC)`.
- `PrereqEligibilityFilter` — keeps a question only when every `requires_settled` prerequisite is `settled` or `not_applicable`, at least one target is `open` / `partial` / `missing` / `conflict`, and the question is not currently asked or deferred.
- `ProjectLocalQuestionDrafter` — drafts a plain-English question for an uncovered criterion with no catalog question, under the per-project cap (default 25). Invalid `question-drafter@1` output is rejected, retried once, then replaced by a deterministic template.
- `DiscoveryBatchBuilder` — batch size 1..4 (default 3), at most one complex question while a conflict card is active, related `bundleGroup` micros merged first, monotonic `options_version` on every multiple-choice prompt, immutable snapshot persisted through `discovery_batches.questions`.
- `selectNextBatch` — composes the four types, including scope priority, cycle breaking, anti-nag, and optional store/ledger writes.
- `QuestionDrafterV1Schema`, `DeterministicQuestionDrafter`, `DeterministicClarifyRephraser`.
- `CatalogPrereqCycleError` — logged when a prerequisite cycle leaves zero eligible questions. The cycle is opened on the lowest id. `warning` is plain English.
- `AntiNagGuard` — one skip or an ambiguous reply rephrases through the clarify port; two skips on a non-must-ask criterion offer `Use recommended default` and `Defer for later`.
- `InMemoryDiscoveryBatchStore`, `ScopeCriterionAskLedger`, `INSERT_DISCOVERY_BATCH_SQL`, `discoveryBatchInsertParams`.
- `stripSettledFromDrafts`, `TOUCHES_TAGS`.

`selectNextBatch` reads the caller's criterion rows and catalog. It does not open `state.db` itself. Pass `batchStore` and `askLedger` to persist the snapshot and the ask counters.

Foundational scopes `auth`, `data`, `core_domain`, and `deployment_target` are selected before leaf features. While any eligible question still covers an uncovered foundational criterion, leaf-only questions wait.

## Shared Wiring Needs (Root / Index Barrels)

`packages/discovery/src/index.ts` is frozen. When wiring is allowed, re-export the selector surface:

```ts
export {
  GreedyQuestionSelector,
  PrereqEligibilityFilter,
  ProjectLocalQuestionDrafter,
  DiscoveryBatchBuilder,
  selectNextBatch,
  QuestionDrafterV1Schema,
  CatalogPrereqCycleError,
  type DiscoveryBatchRecord,
  type CatalogQuestion,
  type CriterionState,
} from "./selector/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or package-barrel change.

## Dependency Intents (New Packages Requested)

No new package. `@ef-harness/discovery` already depends on `@ef-harness/shared-contracts`. Sibling branches are not on this base, so these local ports stand in:

- **Task 009 `QuestionDrafterV1Schema`.** `question-drafter@1` is not one of the 32 contracts in `prompt-contracts.md` (Task 009 recorded the same gap). `packages/discovery/src/selector/drafter.ts` is the local schema and validator. Swap `QuestionDrafterPort` for the shared-contracts schema if that contract is added without breaking the 32/32 inventory. Do not deep-import the sibling package.
- **Task 010 touches tags.** `packages/discovery/src/selector/touches.ts` copies the closed 28 `TOUCHES_TAGS`. Swap that list for the shared-contracts barrel once `packages/shared-contracts/src/index.ts` exports it.
- **Task 017 `KnowledgeGraphRepo` and Task 069 `DiscoverySessionCoordinator`.** This base does not export either type. Task 069's class is `DiscoverySessionManager`. `selectNextBatch` takes criterion snapshots and an optional `DiscoveryBatchStore`. `INSERT_DISCOVERY_BATCH_SQL` matches `discovery_batches`. Replace `InMemoryDiscoveryBatchStore` with `DiscoveryDbRepo.insertBatch` / `KnowledgeGraphRepo` when that port can store the snapshot JSON and the ask ledger. `DeterministicClarifyRephraser` stands in for Task 070 `clarify@1`; inject `DiscoveryPromptOrchestrator` as the `ClarifyPort`.
- **Task 069 decision-field parser.** It keeps a fixed field list. Preserve `ask_count` and `last_asked_turn` when decision `fields` are rewritten, or store them with `ScopeCriterionAskLedger`.

## Contract Change Requests

`schema/state.sql` is frozen. Two shapes need an integrator decision:

1. `scope_criteria` has no `ask_count` or `last_asked_turn` column. `ScopeCriterionAskLedger` stores them under the scope_criteria primary key `(work_item, scope_rev, decision)`. The batch snapshot also records `ask_updates` for that turn.
2. `discovery_batches.questions` is valid JSON. Task 069's reader expects a JSON array of decision ids. This task writes an object:

```json
{
  "question_ids": ["decision-id"],
  "snapshot": [],
  "split_card": null,
  "diagnostics": [],
  "catalog_version": "catalog-test",
  "ask_updates": []
}
```

`question_ids` stays the ordered primary decision ids so a cursor can walk the batch. The snapshot is the immutable copy (text, options, `options_version`, `why_asking`, targets) and must not be reread from live nodes. Accept both a string array and this object when the branches are wired.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-072-adaptive-question-selector`:

- `pnpm --filter @ef-harness/discovery typecheck` — pass (`tsc -b`, exit 0).
- `pnpm --filter @ef-harness/discovery lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/discovery test -- selector` — pass, 21 tests, 2 files, exit 0. Covers prerequisite gating (only the unsettled prerequisite), greedy marginal dedup, must-ask above conflict above unblocker above standard, tie-break order, 100 identical replays under catalog permutation, foundational-before-leaf, prerequisite-cycle break on the lowest id, settled-criterion stripping, batch cap 4 and default 3, one complex question beside an active conflict card, micro-question bundling, monotonic `options_version`, immutable `discovery_batches` JSON, anti-nag rephrase and the default/defer offer, plain-English `why_asking`, project-local drafting, one retry then deterministic fallback, and the 25-question cap with an explicit split-waves card.
- `node scripts/verify-harmony.mjs --task 072` — pass (`harmony ok for Task-072`, exit 0). That command also re-ran repository typecheck, lint, and test.

The performance test builds 500 questions and 1,000 open criteria, warms `GreedyQuestionSelector`, and checks that the median of five selections stays under 5 ms. Each question is linked to 4 criteria so the timed loop stays inside that budget on this machine. No network calls.

## Known Limitations / Follow-Ups

- Leaf questions are held while any eligible foundational question (auth, data, core domain, deployment target) still covers an uncovered criterion. They return in a later batch after those foundational criteria settle or become ineligible.
- `question-drafter@1` and `clarify@1` are deterministic local ports. A real model is injected through `QuestionDrafterPort` and `ClarifyPort`. The drafter is called once per uncovered gap, then once more only when validation fails.
- Ask counters live in `ScopeCriterionAskLedger`, not in a `scope_criteria` column. The caller adds `draftedQuestionIds.length` to the project-local budget and keeps drafted questions in the catalog; this module does not write the catalog back by itself.
- A prerequisite cycle is opened only when nothing else is eligible. The user-facing warning does not include criterion or question ids. Ids stay on `CatalogPrereqCycleError.cycle` and `brokenOnId`.
- The split-waves card text is `Split into smaller waves or confirm remaining items`. Remaining criterion ids are on the card object, not in the user-facing sentence.
- `why_asking` and option labels are checked against table names, dotted criterion keys, regex literals, and the active criterion ids. A dirty catalog string is replaced with a plain sentence.
