# Pass 03 — Chunk 003: Spec Expansion Matrices, Cell Filler, 5-Layer Contradictions & Research Engine (`Tasks 079–082`)

## 1. Chunk identification and scope
- **Pass number:** Pass 03
- **Chunk ID:** `pass-03/chunk-003`
- **Unit IDs:** `Task 079`, `Task 080`, `Task 081` (`packages/spec-expansion`), `Task 082` (`packages/research-engine`)
- **Branches and commits:**
  - `task/079-spec-matrix-generators` (`f19582e`, merged into `harness/integration`, **dirty worktree diff present**)
  - `task/080-spec-cell-filler-proposed-review` (`0f5e3d9`, merged into `harness/integration`)
  - `task/081-five-layer-contradiction-checker` (`24fe966`, merged into `harness/integration`)
  - `task/082-research-engine-api-verifier` (`a6d8908`, merged into `harness/integration`)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration/packages/{spec-expansion,research-engine}` and `C:/Users/Ayush/Desktop/ef-wt/task-079-spec-matrix-generators`
- **Governing architecture documents:** `spec-expansion.md`, `knowledge-database.md`, `build-pipeline.md`, `security-and-governance.md`, `prompt-contracts.md`, `schema/state.sql`, `schema/global.sql`, `IMPLEMENTATION_TASKS.md` (`Tasks 079–082`).

## 2. Units inspected
- `Task 079` (`f19582e` + uncommitted worktree diff in `task-079-spec-matrix-generators`), `Task 080` (`0f5e3d9`), `Task 081` (`24fe966`), `Task 082` (`a6d8908`).

## 3. Files inspected
- `schema/state.sql` (`lines 1–160`)
- `IMPLEMENTATION_TASKS.md` (`lines 4829–5074`)
- `packages/spec-expansion/package.json`
- `packages/spec-expansion/src/generators/{persistence.ts,collapse.ts}` (both on `harness/integration` and in `task-079-spec-matrix-generators`)
- `packages/spec-expansion/src/filler/{pipeline.ts,state-graph.ts}`
- `packages/spec-expansion/src/contradictions/{engine.ts,z3-solver.ts}`
- `packages/research-engine/package.json`
- `packages/research-engine/src/{feature-research-orchestrator.ts,installed-type-api-verifier.ts,research-fact-cache.ts}`

## 4. Architecture documents consulted
- `spec-expansion.md` (12 coverage matrices, scoped-rule collapse, 3-pass cell filling, EARS + `oracle_sketch`, 5-layer contradiction engine with Z3 WASM minimal UNSAT core)
- `schema/state.sql` (`node_kinds`, `edge_types` extensible lookup table, `requirements` view)
- `schema/global.sql` (`research_cache` table + CAS-backed `artifact_hash`)
- `build-pipeline.md` & `security-and-governance.md` (`SecureDocFetcher`, HTML/Unicode quarantine, `.d.ts` installed-type supremacy)

## 5. Contracts and signatures discovered
- `MatrixGeneratorRegistry`, `ScopedRuleCollapser.collapse(run): CollapsedMatrices`, `MatrixCellPersistenceRepo.persist(graph, run, collapsed): PersistStats` (`079`)
- `OrderedCellFillerPipeline.run(input: FillerRunInput): FillerRunResult`, `ProposedRequirementReviewQueue`, `EarsOracleValidator` (`080`)
- `FiveLayerContradictionEngine.check(req): ContradictionReport`, `Z3UnsatCoreSolver.solve(problem): Z3SolveResult` (`081`)
- `FeatureResearchOrchestrator.research(req): Promise<ResearchRunResult>`, `RiskTriggeredTopicGenerator`, `TokenBasedQuoteMatcher`, `InstalledTypeApiVerifier`, `ResearchFactCache` (`082`)

## 6. Confirmed findings
- **F-034** (**CRITICAL**) — Foreign-key crashes on `edges.type REFERENCES edge_types(type)` in `state.db`: `Task 079` writes `type = 'expands'`, `Task 081` writes `type = 'contradicts'`, and `Task 082` writes `type = 'informs'`, none of which are seeded in `schema/state.sql` `edge_types` (`state.sql:64-67`); against real `ProjectStateDb` with `PRAGMA foreign_keys = ON`, all three throw `SQLITE_CONSTRAINT_FOREIGNKEY`.
- **F-035** (**CRITICAL**) — `packages/spec-expansion` (`Tasks 079–081`) is missing `task-079`'s uncommitted bugfixes on `harness/integration` (`ScopedRuleCollapser` `< 47` cap + first-cell anchor bug; `MatrixCellPersistenceRepo` inserting `matrix_manifest`/`matrix_group`/unfilled `matrix_cell` as active `rule`/`spec_item` rows that pollute the `requirements` SQL view; stringified `fields` in `contentHash`), disconnects `079` ↔ `080` ↔ `081` (`081` calls nonexistent `matrices.listCells()` and `filler.listMaterializedRequirements()` and reads nonexistent `fields.selectedOptionId`/`fields.groupId` instead of `discovery`'s `fields.value`/`fields.criterion`), runs synchronous model ports in `080` and `081`, and leaves `Z3UnsatCoreSolver` (`081`) on a hand-rolled exponential DPLL fallback instead of the installed `"z3-solver": "^5.4.1"` WASM package.
- **F-036** (**HIGH**) — `packages/research-engine` (`Task 082`) stores `CachedResearchRecord` payloads (`facts`, `sourceExcerpt`) ONLY in an in-memory `Map` (`this.bodies` in `research-fact-cache.ts:57,101,122`), losing 100% of cached research facts across daemon restarts despite writing metadata to `global.db.research_cache`, imports `"typescript"` at runtime while declaring it only in `devDependencies`, and defines `SecureDocFetcherPort.fetchDocs(url, { role })` incompatible with `Task 045` `SecureDocFetcher`.

## 7. Unverified findings
- None (`0` unverified; all 16/16 dirty worktrees across the entire repo have now been inspected and accounted for!).

## 8. Producer-consumer relationships
- `packages/discovery` (`069–075`) + `corpus` (`076–077`) → `packages/spec-expansion` (`079–081`) → `packages/research-engine` (`082`) & `packages/planner` (`083–095`).
- `packages/sandbox` (`045` `SecureDocFetcher`) + `packages/db` (`014` `GlobalBrokerDb`, `017` `KnowledgeGraphRepo`, `028` `CasBlobStore`) → `packages/research-engine` (`082`).

## 9. Defects and missing integrations
- Uncommitted `task-079` fixes absent on `harness/integration` and `task/079` branch tip.
- Missing `edge_types` rows (`expands`, `contradicts`, `informs`) in `state.db` bootstrap/migrations.
- Broken intra-package calls (`listCells`, `listMaterializedRequirements`, `selectedOptionId`/`groupId`) across `079`, `080`, `081` and `discovery`.
- Volatile RAM-only `this.bodies` map in `ResearchFactCache` (`082`).

## 10. Tests and verification performed
- Diffed `integration` vs `task-079-spec-matrix-generators` on `persistence.ts` and `collapse.ts`; inspected `pipeline.ts`, `state-graph.ts`, `engine.ts`, `z3-solver.ts`, `feature-research-orchestrator.ts`, `installed-type-api-verifier.ts`, and `research-fact-cache.ts` against `schema/state.sql` and `schema/global.sql`.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- `packages/planner` merged M2 submodules (`Tasks 083–089`: `system-arch`, `feature-arch`, `views-export`, `views-import`, `revisions`, `slicer`, `rule-matching`) — next in `pass-03/chunk-004`.
