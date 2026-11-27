# Audit Report — `pass-03/chunk-007` (`Tasks 096–101, 105`: `packages/intake`, M2 `packages/integrator` & M2 Kitchen Exit Gate)

## 1. Chunk identification and scope
- **Pass:** `Pass 03` (Final chunk `7 / 7` — completes Pass 03!)
- **Chunk ID:** `pass-03/chunk-007`
- **Scope:** All 4 `packages/intake` units (`097–100`), M2 `packages/integrator` units (`096` `feature-integrator`, `101` `final-audit`), and `Task 105` M2 Kitchen Exit Gate (`tests/e2e/m2-exit-gate/**`, `benchmarks/m2-kitchen-e2e/**`).
- **Isolation state:** All 7 branches forked from `main` (`6497730`), clean (`dirty: 0`), unmerged on `harness/integration` (`30f2e9c`).

## 2. Units inspected
| Unit | Branch | Commit | Worktree | Dirty |
| --- | --- | --- | --- | --- |
| `Task 096` | `task/096-feature-integrator-engine` | `f69c07d` | `C:/Users/Ayush/Desktop/ef-wt/task-096-feature-integrator-engine` | 0 |
| `Task 097` | `task/097-external-intake-converters` | `f41cfd0` | `C:/Users/Ayush/Desktop/ef-wt/task-097-external-intake-converters` | 0 |
| `Task 098` | `task/098-intake-chunker-openapi-importer` | `f266844` | `C:/Users/Ayush/Desktop/ef-wt/task-098-intake-chunker-openapi-importer` | 0 |
| `Task 099` | `task/099-brand-asset-sanitizer-registry` | `8c8e2f7` | `C:/Users/Ayush/Desktop/ef-wt/task-099-brand-asset-sanitizer-registry` | 0 |
| `Task 100` | `task/100-bug-har-scrubber-triage` | `74e4e4a` | `C:/Users/Ayush/Desktop/ef-wt/task-100-bug-har-scrubber-triage` | 0 |
| `Task 101` | `task/101-completion-wave-final-audit` | `8660af4` | `C:/Users/Ayush/Desktop/ef-wt/task-101-completion-wave-final-audit` | 0 |
| `Task 105` | `task/105-m2-kitchen-exit-gate` | `f8e06c0` | `C:/Users/Ayush/Desktop/ef-wt/task-105-m2-kitchen-exit-gate` | 0 |

## 3. Files inspected
- `Task 097`: `packages/intake/src/{index.ts,converters/sandboxed-document-converter.ts,converters/types.ts,converters/ports/sandbox-runner.ts}`
- `Task 098`: `packages/intake/src/extraction/{pipeline.ts,types.ts}`
- `Task 099`: `packages/intake/src/assets/{brand-asset-registry.ts,sqlite-brand-state.ts}`
- `Task 100`: `packages/intake/src/bug-scrubber/triager.ts`
- `Task 096`: `packages/integrator/src/{index.ts,feature-integrator/engine.ts,feature-integrator/journey-gate.ts}`
- `Task 101`: `packages/integrator/src/final-audit/{completion-wave-controller.ts,state-db.ts}`
- `Task 105`: `tests/e2e/{package.json,tsconfig.json}`, `tests/e2e/m2-exit-gate/{pipeline.ts,runner.ts}`

## 4. Architecture documents consulted
- `external-intake.md`, `parallel-feature-integration.md`, `build-pipeline.md`, `completeness-gate.md`, `verification-for-real-apps.md`, `roadmap.md`, `opening-prompts.md`
- `prompt-contracts.md` (`feature-integrator@1`, `intake-extractor@1`, `issue-triage@1`, `final-project-auditor@1`)
- `schema/state.sql`
- `IMPLEMENTATION_TASKS.md` (`lines 5883–6248`, `6436–6503`)

## 5. Contracts and signatures discovered
- `Task 097`: `SandboxedDocumentConverter.convert(req): Promise<SandboxConversion>` emitting `NormalizedDocument` (`schema: "normalized-document@1"`, `fileName`, `mediaType`, `blocks[].locator: DocumentLocator`).
- `Task 098`: `StructuralDocumentChunker.chunk(doc)`, `IntakeExtractionPipeline.run(req)` (sync `ExtractorModel.complete`, expects incompatible `NormalizedDocument` with `sourceId`, `sourceName`, `mimeType`, `pageCount`, flat `block.{page,paragraph,line,level,section}`), `LiveSpeechPrecedenceReconciler`, `DeterministicSchemaContractImporter`.
- `Task 099`: `BrandAssetSanitizer`, `FontLicenseInspector`, `BrandAssetRegistry` (sync `CasBlobStorePort.{putBlob,getBlob,verifyBlobIntegrity}`, `SqliteBrandAssetState`), `Phase0BrandAssetsGenerator`, `DeterministicPlaceholderGenerator`.
- `Task 100`: `HarAndLogScrubber`, `SourceMapStackMapper`, `ToolLessIssueTriager.triage(input)` (sync `ToolLessModel.complete`), `SymptomCardStore`.
- `Task 096`: `FeatureIntegratorEngine.integrate(req): FeatureIntegrationResult` (sync; `passthroughBinder`, in-memory `CodeSnapshot` journey/viewport/audit evaluation), `MergeTreePreflightScanner`, `AggregatedWiringTaskBuilder`, `FeatureJourneyGate`.
- `Task 101`: `CompletionWaveController.run(req): Promise<CompletionWaveResult>` (`ProjectKind = "web" | "cli" | "openapi"`, `FinalAuditStore` custom SQLite tables, custom `BudgetLedgerPort`), `DeterministicRepoAuditor`, `LiveRouteCrawler`, `ShardedFinalProjectAuditor`, `LandingSummaryGenerator`.
- `Task 105`: `runCertifiedReplay(root): Promise<M2ExitGateReport>`, `executePipeline(harnessRoot, projectDir)` (static fixture copy, `.ts` relative imports).

## 6. Confirmed findings
- **`F-046` (`CRITICAL` / `CONTRACT_MISMATCH`):** `packages/intake` (`097–100`) stub barrel (`packages/intake/src/index.ts`), `NormalizedDocument` & locator structural mismatch between `097` (`converters`) and `098` (`extraction`), unsandboxed/duplicate `NodeSandboxRunner` (`097`), sync `CasBlobStorePort` + rogue `SqliteBrandAssetState` + missing `suggestBrandColors` (`099`), and sync `ExtractorModel`/`ToolLessModel` (`098`/`100`) vs async `ModelProtocolAdapter` (`053`).
- **`F-047` (`CRITICAL` / `RUNTIME_WIRING`):** `packages/integrator` (`096, 101`) stub barrel (`packages/integrator/src/index.ts`), synchronous `FeatureIntegratorEngine` (`096`) running in-memory `CodeSnapshot` callbacks + `passthroughBinder` instead of async `CleanVerifierRunner` (`055`), `BlindCheckBinder` (`056`), `UiPlaywrightContractVerifier` (`057`), `CompletenessGateRunner` (`054`), `RuntimeLifecycleRepo` (`022`), and `GitRefCasUpdater` (`039`); and `CompletionWaveController` (`101`) using private `FinalAuditStore` SQLite tables, incompatible `ProjectKind = "web" | "cli" | "openapi"`, and nonexistent `BudgetLedger` methods (`ensureCompletionScopes`, `reserveAcrossScopes`, `getBudgetRemaining`).
- **`F-048` (`CRITICAL` / `TEST_GAP`):** `Task 105` M2 Kitchen Exit Gate (`tests/e2e/m2-exit-gate/pipeline.ts`) imports **zero** `@ef-harness/*` M2 packages — it copies pre-baked static HTML/JS from `benchmarks/m2-kitchen-e2e/fixture/`, reads hardcoded `sequential-baseline.json` metrics, uses an identity `ef_search_text` UDF + bare-hex `content_hash`, sits outside `tests/e2e/tsconfig.json`'s `"include": ["src/**/*.ts"]` with illegal `.ts` import extensions under `NodeNext`, and lacks root `test:m2-exit-gate:{replay,live}` scripts.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `Task 040`/`045` (`sandbox`) + `Task 028` (`CasBlobStore`) → `Task 097` (`converters`) → `Task 098` (`extraction`) → `Task 069` (`discovery`) / `Task 083` (`system-arch`) / `Task 087` (`revisions`).
- `Task 099` (`assets`) → `Task 093` (`phase0`) + `Task 094` (`design-system`) + `Task 174` (`ui-checks`).
- `Task 100` (`bug-scrubber`) → `Task 169` (`brownfield`) + `Task 182` (`investigations`).
- `Task 095` (`sequential-runner`) → `Task 096` (`feature-integrator`) → `Task 111` (`merge-queue`) / `Task 101` (`final-audit`) → `Task 105` (`m2-exit-gate`) / `Task 172` (`landing`).

## 9. Defects and missing integrations
- `097` output cannot be consumed by `098` without a canonical `NormalizedDocument` adapter/unification (`F-046`).
- `096` and `101` bypass real sandboxed test/Playwright/verifier infrastructure (`F-047`), and `095` (`SequentialBuildRunner`) never calls real `096` or `101` (`F-043`).
- `105` certifies a hand-written static fixture app rather than an app generated by the M2 harness pipeline (`F-048`).

## 10. Tests and verification performed
- Reviewed test suites across `packages/intake/tests/**`, `packages/integrator/tests/{feature-integrator,final-audit}/**`, and `tests/e2e/tests/m2-exit-gate.test.ts`; inspected `tests/e2e/tsconfig.json` and `tests/e2e/package.json`.

## 11. Unresolved questions
- Interaction of `096` and `101` with M3/M5 `packages/integrator` siblings (`109–112, 129, 171–174`) — scheduled immediately next in `pass-04/chunk-001` and `pass-04/chunk-002`.

## 12. Explicit files and relationships still requiring inspection
- **Pass 03 is now 100% COMPLETE (`Tasks 069–108`).**
- Next: `pass-04/chunk-001` (`Tasks 109–112, 129` — `packages/integrator` handoffs, feature-branches, merge-queue, CCR, undo).
