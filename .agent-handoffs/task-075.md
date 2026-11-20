---
task_id: "Task-075"
branch: "task/075-corpus-loader-core-data-auth"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/discovery/src/corpus-loader/**"
  - "corpus/packs/core-data-auth/**"
  - "packages/discovery/tests/corpus-loader/**"
  - ".agent-handoffs/task-075.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 075 handoff

Corpus pack loader, strict quality validator, project corpus pin, and the 29 M2 Core/Data/Auth question packs. Commit stays on `task/075-corpus-loader-core-data-auth`.

## Exports Provided

Import from `packages/discovery/src/corpus-loader/index.ts` until the discovery barrel is wired.

- `CorpusPackLoader` and `loadCorpusPacks(corpusRoot)` load YAML/JSON from `corpus/packs`, `corpus/elaborations`, `corpus/policies`, `corpus/rules-seams`, and `corpus/seams`.
- `CorpusQualityValidator` enforces the M2 authoring bar at load time. `strictConflicts` defaults to true.
- `corpusBundleHash` / `CorpusBundle.corpusBundleHash`: canonical SHA-256 of the parsed documents (`formatVersion` 1). Key order and comments do not change the hash. Question order does.
- `reconcileCorpusUpgrade` and `SqliteCorpusPinStore` stamp `meta.corpus_bundle_hash` on `state.db`. The pin is write-once. Upgrades append `corpus_reconciliation_log`, refresh `corpus_question_catalog`, and set `corpus_bundle_hash_observed`. Settled decision nodes and `scope_criteria` are not written.
- `exportCorpusEvalDataset` emits the positive/negative cases for Task 070 / Task 191, sorted by question id, polarity (negative then positive), and index, plus `datasetHash`.
- Manifest types: `QuestionPackManifest`, `QuestionManifest`, `OptionManifest`, `OptionElaborationPackManifest`, `UniversalPolicyPackManifest`, `CrossCuttingRulePackManifest`, `SeamTemplatePackManifest`, and the row types under them.
- Errors: `InsufficientExamplesError`, `UnrecognizedTouchesTagError`, `DuplicateQuestionIdError`, `PrerequisiteCycleError`, `MustAskPolicyFloorError`, `AsymmetricConflictError`, `OrphanCriterionError`, `YamlParseError`, `JsonParseError`, `CorpusShapeError`, `CorpusPinIntegrityError`.
- `parseStrictYaml(..., { uniqueKeys: true })` and `parseStrictJson`. Duplicate keys throw a line-numbered error. `STRICT_YAML_PARSE_OPTIONS.uniqueKeys` is `true`.
- `PACK_MANIFEST_SCHEMA_VERSION` is `1`. `PROJECT_STAGES` is `prototype | mvp | production`. `REVERSIBILITY_VALUES` is `easy | costly | irreversible`.

Question packs use stable ids `Q-CORE-01`–`Q-CORE-18`, `Q-DATA-01`–`Q-DATA-06`, and `Q-AUTH-01`–`Q-AUTH-05`. Each question has `requires`, symmetric `conflicts_with`, `touches`, `impact`, `reversibility`, `must_ask`, `allowed_inference_rules`, stage recommendations with a plain-English `rationale`, and options with `label`, `meaning`, and `stage_suitability`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/discovery/src/index.ts` in this task. The integrator should add:

```ts
export {
  AsymmetricConflictError,
  CORPUS_BUNDLE_HASH_META_KEY,
  CORPUS_DOCUMENT_KINDS,
  CORPUS_OBSERVED_HASH_META_KEY,
  CORPUS_QUESTION_CATALOG_META_KEY,
  CORPUS_RECONCILIATION_LOG_META_KEY,
  CorpusDiagnosticError,
  CorpusPackLoader,
  CorpusPinIntegrityError,
  CorpusQualityValidator,
  CorpusShapeError,
  DuplicateQuestionIdError,
  IMPACT_CLASSES,
  INFERENCE_RULE_ALLOWLIST,
  InsufficientExamplesError,
  JsonParseError,
  MustAskPolicyFloorError,
  OrphanCriterionError,
  PACK_MANIFEST_SCHEMA_VERSION,
  PROJECT_STAGES,
  PrerequisiteCycleError,
  QUESTION_SCOPES,
  QUESTION_STATUSES,
  REVERSIBILITY_VALUES,
  STRICT_YAML_PARSE_OPTIONS,
  SqliteCorpusPinStore,
  TOUCHES_TAG_GROUPS,
  TOUCHES_TAGS,
  UnrecognizedTouchesTagError,
  YamlParseError,
  canonicalJson,
  corpusBundleHash,
  exportCorpusEvalDataset,
  findPrerequisiteCycle,
  formatTouchesTagList,
  isInferenceRuleId,
  isTouchesTag,
  loadCorpusPacks,
  normalizeQuestionGraph,
  parseStrictJson,
  parseStrictYaml,
  questionCatalog,
  reconcileCorpusUpgrade,
  repositoryCorpusRoot,
  violatesMustAskPolicyFloor,
} from "./corpus-loader/index.js";
export type {
  AppliesWhenClause,
  ConflictAsymmetry,
  CorpusBundle,
  CorpusDocumentKind,
  CorpusEvalCase,
  CorpusEvalDataset,
  CorpusPackLoaderOptions,
  CorpusProjectStatePort,
  CorpusQualityValidatorOptions,
  CorpusReconciliationEntry,
  CrossCuttingRuleManifest,
  CrossCuttingRulePackManifest,
  ElaborationCellManifest,
  ImpactClass,
  InferenceRuleId,
  LoadedQuestion,
  NegativeExampleManifest,
  OptionElaborationManifest,
  OptionElaborationPackManifest,
  OptionManifest,
  ParsedCorpusFile,
  PositiveExampleManifest,
  ProjectMetadataPort,
  ProjectStage,
  QuestionCatalogEntry,
  QuestionEvalManifest,
  QuestionManifest,
  QuestionPackManifest,
  QuestionScope,
  QuestionStatus,
  ReconciliationResult,
  Reversibility,
  RuleScopeManifest,
  ScopeCriterionSnapshot,
  SeamTemplateManifest,
  SeamTemplatePackManifest,
  SettledDecisionSnapshot,
  StageRecommendationManifest,
  TouchesTag,
  UniversalPolicyManifest,
  UniversalPolicyPackManifest,
} from "./corpus-loader/index.js";
```

No root `package.json`, workspace, tsconfig, or eslint edit.

## Dependency Intents (New Packages Requested)

None. Parsing stays inside this package so `packages/discovery/package.json` does not gain a dependency. `uniqueKeys: true` is the strict parser option implemented here.

## Contract Change Requests

None. Frozen foundation files were not edited.

Local ports, because sibling branches are not on this base:

- Task 010 closed 28 touches tags: `TOUCHES_TAGS` / `TOUCHES_TAG_GROUPS` / `isTouchesTag` in `touches-tags.ts`. Swap these for the Task 010 barrel export when `task/010-closed-vocabularies` is integrated. Do not keep both lists.
- Task 017 `KnowledgeGraphRepo`: not on this base, and its published methods do not write the `meta` table. `SqliteCorpusPinStore` is the local port. It reads settled `nodes` (`fields.status === "settled"`) and `scope_criteria`, and writes only `meta`. Swap to a repo-backed `CorpusProjectStatePort` when Task 017 exposes project metadata.
- Task 071 inference rules: `INFERENCE_RULE_ALLOWLIST` in `inference-rules.ts`. Swap for the Task 071 allowlist.
- Task 073 `MustAskPolicyFloor`: `violatesMustAskPolicyFloor` rejects `must_ask: false` when `reversibility` is `costly` or `irreversible`. Swap for the Task 073 export.

`Q-CORE-05` and `Q-CORE-06` declare `conflicts_with` in both directions. A one-sided pair is normalized in memory and rejected when `strictConflicts` is true.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-075-corpus-loader-core-data-auth`:

- `pnpm --filter @ef-harness/discovery test -- corpus-loader` — passed, 4 files, 20 tests. Counts are core 18, data 6, auth 5. Hash is stable across two loads. Adversarial tag, duplicate id, cycle, 4 positive examples, 1 negative example, duplicate YAML key, must-ask floor, asymmetric conflict, and orphan criterion fail with file and id or line diagnostics. Eval export is 145 positive and 58 negative. Real-pack validation completed in under 500 ms.
- `pnpm --filter @ef-harness/discovery typecheck` — passed.
- `pnpm --filter @ef-harness/discovery lint` — passed.
- `node scripts/verify-harmony.mjs --task 075` — passed (`harmony ok for Task-075`).

## Known Limitations / Follow-Ups

- The v1 corpus table also lists dotted ids such as `product.purpose` and `auth.account_recovery`. This pack follows the task's exact 18/6/5 topic list and `Q-*` ids. Overlapping catalog ideas are `criteria` keys on those questions. Shipping the table as extra questions would break the exact-count invariant. Task 076 still owns the web, API, and CLI packs that complete the 44.
- The YAML subset accepts one document, block mappings and sequences, single-line flow collections, and `>` / `|` block scalars. Anchors, aliases, tags, and multi-document files throw. That matches `uniqueKeys: true` for the packs this task authors.
- `corpus_bundle_hash` hashes canonical parsed JSON, not raw file bytes.
- Elaborations, universal policies, cross-cutting rules, and seam templates are loaded and validated when those directories exist. Task 076 and Task 077 author them. They are absent on this branch, so the pinned hash covers the three question packs only.
- `Q-CORE-06` negative utterance `use on their phones` must not settle `offline_native_app`. The same utterance is also a negative near-miss on platform, freshness, and auth questions for different rejected readings.
- Rename reconciliation uses optional `renamed_from` on a question. The 29 authored questions do not set it. An upgrade test covers a rename plus an addition without mutating the pinned hash, the settled decision value, or `scope_criteria`.
