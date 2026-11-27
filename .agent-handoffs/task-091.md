---
task_id: "Task-091"
branch: "task/091-feature-planner-sealed-oracles"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/feature-plan/**"
  - "packages/planner/tests/feature-plan/**"
  - ".agent-handoffs/task-091.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 091 handoff

JIT feature planner, Step 3b sealed-oracle author, hidden-check pool, and relations-to-edges normalizer. Commit stays on `task/091-feature-planner-sealed-oracles`.

## Exports Provided

Import from `packages/planner/src/feature-plan/index.ts` until the planner barrel below is wired:

- `JitFeaturePlanner` — `feature-planner@1` decomposer. Refuses to run until the Task 084 consistency receipt passes. Emits 1–5 file leaves, one behavior each, disjoint write scopes, closed touches tags, `implements` / `depends_on`, visible checks, and one Task `096` feature-integration slot.
- `IndependentOracleAuthorSealer` — Step 3b `oracle-author@1`. Authors held-back cases from requirement EARS, `oracle_sketch`, and contracts only. Selects a different model family from the build worker when at least two families exist. One family stamps `oracle_independence: "same_family_only"` and logs `same_family_degraded`. One lint repair pass, then `>= 3` diverse cases (happy, boundary, negative or adversarial) before anything is stored.
- `HiddenCheckPoolStore` — writes `state.db.hidden_checks` plus a CAS blob. `readForCleanVerifier` is the kernel read. `readAsWorker`, `kbGet`, and `kbSearch` do not return sealed bytes. Storage paths are `kernel://state.db/hidden_checks/<id>`.
- `RelationsToEdgesNormalizer` — lifts `implements`, `verifies`, `depends_on`, `touches_entity`, `belongs_to`, `consumes_contract`, and the `consumes` alias into edge rows. A missing node id aborts the transaction before commit. After commit, `relations_in_fields` is empty.
- `FeaturePlanningSession` — plan, seal, then `beginGraphCompile`, then `authorizeWorker`. `replan` rewrites only tasks and sealed checks for the impacted requirement ids.
- `FakeModelAdapter` — scripted or deterministic offline model used by the tests.
- `FeaturePlannerV1Schema` and `OracleAuthorV1Schema` — local closed parsers for the Task 009 prompt documents.
- `FeaturePlanDatabase` — in-memory nodes, edges, `hidden_checks`, and `cas_blobs` projection. Also the local `KnowledgeGraphRepoPort` and `NameRegistryRepoPort`.
- `selectOracleAuthor`, `selectPlannerModel`, `lintOracleCase`, `compileWorkerBrief`, `sealedPathIsOutsideWorktree`, `TOUCH_TAGS`, `FeaturePlanError`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/planner/src/index.ts` on this branch. Append:

```ts
export {
  FakeModelAdapter,
  FeaturePlanDatabase,
  FeaturePlanError,
  FeaturePlannerV1Schema,
  FeaturePlanningSession,
  HiddenCheckPoolStore,
  IndependentOracleAuthorSealer,
  JitFeaturePlanner,
  OracleAuthorV1Schema,
  RelationsToEdgesNormalizer,
  RELATIONS_IN_FIELDS_SQL,
  compileWorkerBrief,
  sealedPathIsOutsideWorktree,
  selectOracleAuthor,
} from "./feature-plan/index.js";
export type {
  FeatureArchitectureConsistency,
  FeaturePlanDocument,
  HeldBackCase,
  KnowledgeGraphRepoPort,
  ModelRoster,
  NameRegistryRepoPort,
  OracleAuthorDocument,
  SealReceipt,
  WorkerBrief,
} from "./feature-plan/index.js";
```

No `packages/shared-contracts/src/index.ts` change. The prompt schemas stay local until Task 009 exports them.

## Dependency Intents (New Packages Requested)

None. The module uses Node built-ins (`node:sqlite`, `node:crypto`, `node:path`) already available to `@ef-harness/planner`. No `package.json` change.

## Contract Change Requests

Sibling branches are not on this base. Local ports stand in for them:

- Task 009 `FeaturePlannerV1Schema` / `OracleAuthorV1Schema` — replaced by `FeaturePlannerV1Schema.parse` and `OracleAuthorV1Schema.parse` in `schema.ts`. Swap those calls to the shared-contracts validators when that barrel lands. Keep rejecting held-back checks inside `feature-planner@1` and rejecting task-split fields inside `oracle-author@1`.
- Task 017 `KnowledgeGraphRepo` — `FeaturePlanDatabase` is the port (`activeIds`, `hasActiveNode`, node upsert). Point `RelationsToEdgesNormalizer` and `FeaturePlanningSession` at the repo when it exists. Node kinds used: `feature`, `spec_item`, `edge_case`, `rule`, `contract`, `arch_node` (entities), `task`, `check`.
- Task 019 `NameRegistryRepo` — `FeaturePlanDatabase.relationsInFields` runs the verbatim `relations_in_fields` query from `schema/queries.sql`, plus `touches_entity`, `belongs_to`, and `consumes_contract`. Call the repo's assert helper after publish once it exists.
- Task 084 `JitFeatureArchitectureSynthesizer` — `FeatureArchitectureConsistency` (`schema: "feature-architect@1"`, `passed`, `failures`). `JitFeaturePlanner` refuses to call the model until `passed` is true for that feature.

Schema additions the frozen `schema/state.sql` does not have yet. Required before this code writes the real database:

- Edge type `touches_entity` (`invalidates = 1`). The normalizer emits it. Current `edge_types` has no such row, so a foreign-keyed `edges.type` insert would fail.
- Tables `hidden_checks` and `cas_blobs` for sealed oracle bytes. Suggested columns match `FeaturePlanDatabase`: check id, feature id, requirement id, diversity, cas blob id, sha256, sealed_at, content JSON, status `sealed|superseded`, `encrypted_at_rest` (0 until export), `export_encryption` default `age-x25519`. CAS rows are `visibility = 'sealed'`.
- Task 186 encrypts those blobs with age X25519 at export. This task stores them sealed in the kernel state path and does not encrypt yet. `HiddenCheckPoolStore.exportIntent()` records that handoff.
- Task 055 reads sealed bytes only through `readForCleanVerifier`. Task 056 binds public entry points; checks already target routes, status codes, or accessible roles. Task 092 should treat `sealedBeforeCompile` as a precondition and should keep using canonical `edges` for traceability. Worker briefs expose `checks_hidden_count` only.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-091-feature-planner-sealed-oracles`:

- `pnpm --filter @ef-harness/planner typecheck` — exit 0.
- `pnpm --filter @ef-harness/planner lint` — exit 0.
- `pnpm --filter @ef-harness/planner test -- feature-plan` — 5 files, 19 tests passed.
- `node scripts/verify-harmony.mjs --task 091` — exit 0, printed `harmony ok for Task-091`.

## Known Limitations / Follow-Ups

- Sealed bytes are not age-encrypted in this task. `encrypted_at_rest` stays 0. Task 186 applies `age-x25519` on export.
- `hidden_checks` and `touches_entity` are enforced in the local database projection, not in frozen `schema/state.sql`.
- Model calls go through `PlannerOracleModel`. Production wiring supplies a real adapter; tests use `FakeModelAdapter`.
- Graph compile itself is Task 092. This task only refuses compile and worker dispatch until Step 3b has sealed.
- Re-plan keeps unaffected leaf objects and their sealed-check hashes intact. The integration slot is left in place when its leaf id set does not change.
- A trivial requirement (`trivial: true`) still gets a leaf and a visible check, and is exempt from the three-case sealed pool.
