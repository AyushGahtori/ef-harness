# Audit Report — `pass-03/chunk-005` (`Tasks 090–095`: Unmerged `packages/planner` Execution Half)

## 1. Chunk identification and scope
- **Pass:** `Pass 03` (Discovery, Corpus, Spec Expansion, Research Engine, Planner, Intake, M2 Gate)
- **Chunk ID:** `pass-03/chunk-005`
- **Scope:** Unmerged M2 execution & compilation half of `packages/planner`: `master-plan` (`090`), `feature-plan` (`091`), `graph-compiler` (`092`), `phase0` (`093`), `design-system` (`094`), and `sequential-runner` (`095`).
- **Isolation state:** None of `Tasks 090–095` are merged into `harness/integration` (`30f2e9c`). All 6 worktrees are clean (`dirty: 0`) and branched directly off `main` (`6497730`).

## 2. Units inspected
| Unit | Branch | Commit | Worktree | Dirty |
| --- | --- | --- | --- | --- |
| `Task 090` | `task/090-master-planner-wave-budgets` | `b6b1e95` | `C:/Users/Ayush/Desktop/ef-wt/task-090-master-planner-wave-budgets` | 0 |
| `Task 091` | `task/091-feature-planner-sealed-oracles` | `c779647` | `C:/Users/Ayush/Desktop/ef-wt/task-091-feature-planner-sealed-oracles` | 0 |
| `Task 092` | `task/092-deterministic-graph-compiler` | `95d6eb5` | `C:/Users/Ayush/Desktop/ef-wt/task-092-deterministic-graph-compiler` | 0 |
| `Task 093` | `task/093-phase0-controller-gate0` | `1d460bd` | `C:/Users/Ayush/Desktop/ef-wt/task-093-phase0-controller-gate0` | 0 |
| `Task 094` | `task/094-ui-design-system-pipeline` | `0e553ab` | `C:/Users/Ayush/Desktop/ef-wt/task-094-ui-design-system-pipeline` | 0 |
| `Task 095` | `task/095-sequential-task-dispatcher` | `769e91a` | `C:/Users/Ayush/Desktop/ef-wt/task-095-sequential-task-dispatcher` | 0 |

## 3. Files inspected
- `Task 090`: `packages/planner/src/master-plan/{index.ts,types.ts,ports.ts,master-plan-orchestrator.ts,phase0-recipe-generator.ts,wave-dag-builder.ts,paperwork-budget-envelope-allocator.ts,state-db.ts}`
- `Task 091`: `packages/planner/src/feature-plan/{index.ts,types.ts,ports.ts,jit-feature-planner.ts,independent-oracle-author-sealer.ts,hidden-check-pool-store.ts,relations-to-edges-normalizer.ts,state-db.ts}`
- `Task 092`: `packages/planner/src/graph-compiler/{index.ts,types.ts,ports.ts,compiler.ts,traceability-sql-gate.ts,write-scope-checker.ts,waiver-guard.ts,windows-glob.ts}`
- `Task 093`: `packages/planner/src/phase0/{index.ts,types.ts,ports.ts,controller.ts,verifier.ts,command-runner.ts,installer.ts,state-store.ts}`
- `Task 094`: `packages/planner/src/design-system/{index.ts,types.ts,tokens.ts,contrast.ts,scaffold.ts,styleguide.ts,lint.ts,brownfield.ts}`
- `Task 095`: `packages/planner/src/sequential-runner/{index.ts,types.ts,ports.ts,runner.ts,ready-queue.ts,brief.ts,smoke.ts,state-db.ts}`

## 4. Architecture documents consulted
- `build-pipeline.md` (Step 3a Master Plan, Step 3b Feature Plan & Sealed Oracles, Step 3c Graph Compile, Phase 0 & Gate 0, Step 4 Execute Tasks)
- `planning-and-crew.md`, `ui-design-system.md`, `verification-for-real-apps.md`, `verification-and-isolation.md`
- `database-design.md`, `schema/state.sql`, `schema/queries.sql`
- `prompt-contracts.md` (`master-planner@1`, `feature-planner@1`, `oracle-author@1`)
- `IMPLEMENTATION_TASKS.md` (`lines 5503–5882`)

## 5. Contracts and signatures discovered
- `Task 090` (`master-plan`): `MasterPlanOrchestrator.plan(input: MasterPlanInput): MasterPlan` (sync; expects `features` or `modelOutput` pre-supplied), `Phase0RecipeGenerator.generate(input)`, `WaveDagBuilder.build(features, options)`, `PaperworkBudgetEnvelopeAllocator.allocate(input)`, `MasterPlanStore.open(path)` (`DatabaseSync` with 6 custom tables). `ProjectKind = "web_saas" | "headless_cli" | "api" | "brownfield"`, `TaskLevel = "junior" | "mid" | "senior" | "manager"`.
- `Task 091` (`feature-plan`): `JitFeaturePlanner.plan(input)` (sync `PlannerOracleModel.complete`), `IndependentOracleAuthorSealer.author(input)` (sync `PlannerOracleModel.complete`), `HiddenCheckPoolStore`, `RelationsToEdgesNormalizer`, `FeaturePlanDatabase.memory()` (`:memory:`-only `DatabaseSync` with incompatible `nodes`/`edges`/`hidden_checks`/`cas_blobs`). `CrewLevel = "Junior" | "Mid" | "Senior"`.
- `Task 092` (`graph-compiler`): `DeterministicGraphCompiler.compile(input)` (sync 9-pass compiler), `WriteScopeDisjointnessChecker`, `TraceabilitySqlGate.check(input)` (creates throwaway `:memory:` `DatabaseSync` with 11 custom tables), `CompilationWaiverGuard`.
- `Task 093` (`phase0`): `Phase0ExecutionController.run(options): Promise<Phase0RunResult>`, `FoundationGate0Verifier.verify(options): Promise<Gate0Receipt>`, `Phase0StateStore.open(file)` (raw `DatabaseSync` creating 8 `phase0_*` tables), `NodeCommandRunner` (unsandboxed `child_process.spawn`), `LocalKernelPackageInstaller.install(req): InstallResult` (sync fake lockfile string builder).
- `Task 094` (`design-system`): `LookAndFeelInterviewFlow`, `W3cDesignTokenGenerator`, `DesignSystemScaffoldBuilder` (`ProjectKind = "web" | "cli" | "api" | "headless"`, `HEADLESS = new Set(["cli", "api", "headless"])`), `StyleguideRouteVerifier.verify(input)` (defaults to `OfflineUiPlaywrightContractVerifier` + `MemoryCasBlobStore`), `DesignTokenLintRuleset`.
- `Task 095` (`sequential-runner`): `SequentialBuildRunner.runUntilIdle()`, `ExplicitFirstReadyQueue`, `AttemptBriefMaterializer`, `PostMergeSmokeChecker` (`BarrelTypecheck` + `FastUnitSmoke`), `StateDb.open(filename)` (raw `DatabaseSync` + `splitWords` UDF + `sequential_attempt_receipts`).

## 6. Confirmed findings
- **`F-040` (`HIGH` / `CONTRACT_MISMATCH`):** Unexported `packages/planner` submodules (`090–095, 102, 106–108`), conflicting `ProjectKind` enums (`090`/`093` `"web_saas" | "headless_cli"` vs `094` `"web" | "cli" | "headless"` causing `headless_cli` to scaffold React UI!), conflicting `CrewLevel` casing/values across 6 planner units, and synchronous `PlannerOracleModel` vs async `ModelProtocolAdapter` (`053`).
- **`F-041` (`CRITICAL` / `SCHEMA_MISMATCH`):** Five private SQLite schemas inside `packages/planner` (`090`, `091`, `092`, `093`, `095`) bypass `@ef-harness/db` single-writer `SqliteConnection`, collide with `schema/state.sql` (`091`'s `nodes`/`edges` DDL crashes on real `state.db`, `090`'s `budgets` rows violate `Task 023` hierarchy, `091`'s `hidden_checks` bypasses `nodes(kind='oracle')` + `CasBlobStore` `028` + `BlindCheckBinder` `056`), and `092` calls nonexistent methods on `081`, `088`, and `091`.
- **`F-042` (`CRITICAL` / `SECURITY`):** `Phase0ExecutionController` (`093`) executes unsandboxed `child_process.spawn` (`NodeCommandRunner`) with single-PID `process.kill` instead of Windows Job Object + Tier C sandbox (`040`/`047`), uses a non-installing synchronous `LocalKernelPackageInstaller` instead of `Task 046`, and `StyleguideRouteVerifier` (`094`) uses regex + solid-color PNG `OfflineUiPlaywrightContractVerifier` + bare-hex `MemoryCasBlobStore` instead of `Task 057` Playwright + `Task 028` CAS.
- **`F-043` (`CRITICAL` / `RUNTIME_WIRING`):** `SequentialBuildRunner` (`095`) defaults to regex toy `LocalStaticAudit`/`LocalCleanVerifier`/`LocalFeatureIntegrator` (`journeyPassed: journeys === 0` fails every feature with a journey!) and non-executing `PostMergeSmokeChecker` (`BarrelTypecheck` regex-checks `src/index.ts` only; `FastUnitSmoke` checks `smoke/cases.json` only), plus bare-hex `content_hash` and `splitWords` UDF in `sequential-runner/state-db.ts`.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `Task 083` (`SystemArchitectureSynthesizer`) → `Task 090` (`MasterPlanOrchestrator`) → `Task 093` (`Phase0ExecutionController`) + `Task 094` (`DesignSystemScaffoldBuilder` / `StyleguideRouteVerifier`).
- `Task 084` (`JitFeatureArchitectureSynthesizer`) → `Task 091` (`JitFeaturePlanner` + `IndependentOracleAuthorSealer`) → `Task 092` (`DeterministicGraphCompiler`) → `Task 095` (`SequentialBuildRunner`) + `Task 055`/`056` (`CleanVerifierRunner` / `BlindCheckBinder`).
- `Task 020–023` (`db` runtime/holds/lifecycle/budgets) + `Task 038–039` (`git-engine`) + `Task 046–048` (`sandbox`/`mcp-server`) + `Task 053–060` (`worker-loop`/`completeness-gate`/`verifier`) → `Task 093` & `Task 095`.

## 9. Defects and missing integrations
- None of `Tasks 090–095` import `@ef-harness/db`, `@ef-harness/git-engine`, `@ef-harness/sandbox`, `@ef-harness/worker-loop`, `@ef-harness/completeness-gate`, `@ef-harness/verifier`, or `@ef-harness/integrator`; all cross-package boundaries are mocked behind incompatible sync/toy local ports (`F-040`..`F-043`).
- `packages/planner/src/index.ts` does not re-export `master-plan`, `feature-plan`, `graph-compiler`, `phase0`, `design-system`, or `sequential-runner` (`F-040`).

## 10. Tests and verification performed
- Inspected unit test suites across `packages/planner/tests/{master-plan,feature-plan,graph-compiler,phase0,design-system,sequential-runner}/**`: tests exercise isolated local stores (`MasterPlanStore`, `FeaturePlanDatabase.memory()`, `:memory:` `TraceabilitySqlGate`, `Phase0StateStore`, `OfflineUiPlaywrightContractVerifier`, `SequentialBuildRunner` `StateDb`) rather than shared `ProjectStateDb` (`014`), `CleanVerifierRunner` (`055`), or `NativeWorkerLoop` (`053`).

## 11. Unresolved questions
- None for `Tasks 090–095`; remaining `packages/planner` units (`102, 106–108`) and `packages/intake` + `096, 101, 105` are scheduled next in `pass-03/chunk-006` and `pass-03/chunk-007`.

## 12. Explicit files and relationships still requiring inspection
- `pass-03/chunk-006`: `Tasks 102, 106–108` (`packages/planner/src/{specialists,crew-levels,scheduler,plan-preview}/**` vs `088, 090–092, 095`).
- `pass-03/chunk-007`: `Tasks 097–100, 096, 101, 105` (`packages/intake/**`, `packages/integrator/src/{feature-integrator,final-audit}/**`, `tests/e2e/m2-exit-gate/**`).
