# Pass 05 — Chunk 006 Audit Report (`packages/brownfield` L0–L2, Opening Flow, Baseline Test Health & `Task 175` M5 Exit Gate — `Tasks 166–170, 175`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-05` (Final chunk of Pass 05!)
- **Chunk:** `chunk-006`
- **Units Audited (6):**
  - `Task 166` (`task/166-brownfield-l0-repo-scanner` @ `01c9d1f`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-166-brownfield-l0-repo-scanner`, unmerged, clean)
  - `Task 167` (`task/167-brownfield-l1-code-map` @ `49b2404`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-167-brownfield-l1-code-map`, unmerged, clean)
  - `Task 168` (`task/168-brownfield-l2-summaries` @ `a9d88c3`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-168-brownfield-l2-summaries`, unmerged, clean)
  - `Task 169` (`task/169-brownfield-opening-flow` @ `596121a`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-169-brownfield-opening-flow`, unmerged, clean)
  - `Task 170` (`task/170-brownfield-baseline-test-health` @ `555e097`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-170-brownfield-baseline-test-health`, unmerged, clean)
  - `Task 175` (`task/175-m5-exit-gate` @ `14d3964`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-175-m5-exit-gate`, unmerged, clean)
- **Governing Architecture Documents:** `brownfield-discovery.md`, `opening-prompts.md`, `database-design.md`, `schema/code-index.sql`, `schema/state.sql`, `prompt-contracts.md` (`module-card-writer@1`), `resume-changer-benchmark.json`, `roadmap.md` (Milestone 5), `workspace-git-and-brownfield.mmd`, `research/brownfield-repo-understanding.md`.

## 2. Files Directly Inspected
- `packages/brownfield/package.json` & `packages/brownfield/src/index.ts` (`task-167`)
- `packages/brownfield/src/l0-scan/{git-exec.ts,observed-repo-facts-persister.ts}` (`Task 166`)
- `schema/code-index.sql` & `packages/brownfield/src/l1-codemap/{code-index-db.ts,web-tree-sitter-loader.ts,wasm-tree-sitter-indexer.ts,compact-code-map-query-service.ts}` (`Task 167`)
- `packages/brownfield/src/l2-cards/{module-card-cache-engine.ts,in-memory.ts}` (`Task 168`)
- `packages/brownfield/src/opening/{brownfield-opening-controller.ts,work-item-store.ts}` (`Task 169`)
- `packages/brownfield/src/test-health/baseline-test-health-runner.ts` (`Task 170`)
- `tests/e2e/m5-exit-gate/{run-m5-suite.ts,runner.ts,brownfield.ts,office.ts,ux.ts}` (`Task 175`)

## 3. Verified Local Strengths
- `BrownfieldL0RepoScanner` (`166`) skips sensitive `.env*`/`*.pem` files without reading bytes, detects multi-language manifests/frameworks/scripts/CI/schemas, computes recent git churn & co-change pairs, and extracts monorepo package DAGs.
- `CodeIndexDatabase` & `GeneratedAndVendoredFilter` (`167`) detect corruption via `PRAGMA quick_check` with automatic rebuild, filter minified/`// @generated`/vendored files, and expand `tsconfig.json` `paths` aliases.
- `RequestDrivenFocusSelector`, `L2PreSpendEstimator`, `CodeEgressSecretMasker`, and `StaleDocsDetector` (`168`) cap focus at `<= 20` files, scrub legacy secrets before model calls, repair hallucinated symbol exports against `CodeMapQueryPort`, and verify doc paths/symbols/churn deterministically without falsely flagging stable ADRs.
- `BrownfieldOpeningController` (`169`) provides the 5 canonical brownfield quick-prompts, splits mixed bug/perf/feature prompts, enforces SQL `EXPLAIN ANALYZE` + numeric baselines on perf fixes, extracts `<= 600`-token repo conventions, and fences hostile `AGENTS.md` prompt injections.
- `BaselineTestHealthRunner` (`170`) implements broken-build preflight gating, `3×` isolated flake classification, known-failing quarantine, and zero-test characterization safety-net detection.

## 4. Local Implementation Defects Discovered
1. **`WasmTreeSitterIndexer` Never Uses Tree-Sitter WASM, Blocks Event Loop Synchronously, Checks Lowercase Governor `"orange"`/`"red"`, and Fabricates Linear Edges in `renderPersonalizedMap` (`Task 167` — `F-073`):**
   - `web-tree-sitter-loader.ts:10` calls `require("web-tree-sitter")`, which is undeclared in `packages/brownfield/package.json` (`dependencies` has only `@ef-harness/shared-contracts`), swallows the error returning `false`, bundles zero `.wasm` grammars, and `wasm-tree-sitter-indexer.ts:111` calls regex `parseStructurally(rel, content)` unconditionally without ever invoking a Tree-Sitter parser.
   - `WasmTreeSitterIndexer.index` (`wasm-tree-sitter-indexer.ts:61-130`) executes synchronously via `fs.statSync`/`fs.readFileSync` without async yielding every 25 files, and line 90 compares `signal.level === "orange" || signal.level === "red"` (lowercase) against `Task 118`'s uppercase `"ORANGE" | "RED"`.
   - `CompactCodeMapQueryService.renderPersonalizedMap` (`compact-code-map-query-service.ts:84-88`) constructs fake sequential edges `global[i] -> global[i+1]` instead of loading real `import:` / `refs` edges from `code-index.db`.
2. **Missing `module_cards` Table in `schema/code-index.sql` & Volatile In-Memory-Only `Task 168` Persistence (`F-073`):**
   - `schema/code-index.sql` defines `indexed_commits`, `commit_files`, `symbols`, `refs`, and `file_rank` — omitting `module_cards` required by `Task 168` (`code-index.db.module_cards`), leaving `Task 168` with only `InMemoryModuleCardStore` and `InMemoryObservedModuleGraph` (`in-memory.ts:15-37,97-117`) and a duplicate `packet-security-redactor.ts`.
3. **Self-Contained Toy Re-Implementations & `.ts` Extension Imports in `Task 175` M5 Exit Gate (`F-075`):**
   - `tests/e2e/m5-exit-gate/{run-m5-suite.ts,runner.ts,brownfield.ts,office.ts,ux.ts}` uses relative `.ts` imports and re-implements fake toy classes (`BrownfieldL0RepoScanner`, `WasmTreeSitterIndexer`, `CodeIndexDatabase` string-grepping `schema/code-index.sql` without SQLite, `OfficeCastProjector`, `TruthfulAnimationDirector`, `SavedNodePositionStore`, etc.) with zero workspace package imports, while `runLiveCertification` (`runner.ts:30-38`) only checks `.git/HEAD` existence.

## 5. Cross-Unit Contract & Seam Mismatches
1. **5-Way `packages/brownfield` Silo Isolation (`166`–`170`), Empty `src/index.ts` Barrel, and Upstream Port Clashes (`009, 011, 014, 017, 035, 036, 038, 048, 050, 069, 088, 093, 153` — `F-074`):**
   - `packages/brownfield/src/index.ts` is an empty `packageIdentity()` stub on all 5 branches, with zero cross-imports among `l0-scan` (`166`), `l1-codemap` (`167`), `l2-cards` (`168`), `opening` (`169`), and `test-health` (`170`).
   - `166` `git-exec.ts:22` spawns bare `"git"` from `PATH` instead of `Task 035`/`036` hermetic `MinGit`, and `ObservedRepoFactsPersister` (`166`) + `InMemoryObservedModuleGraph` (`168`) use custom `upsertObservedNode` / `upsertBrownfieldModule` ports instead of `Task 017` `KnowledgeGraphRepo` (`schema/state.sql` `node_kinds`).
   - `169` `BrownfieldOpeningController` calls `l0.scanSummary(repoRoot)` (`166` exposes `scan`), `codeMap.listModulesForPaths(...)` (absent on `167` `CompactCodeMapQueryService`), and `discovery.preSettleObservedCriteria(...)` (absent on `069` `DiscoverySessionCoordinator`), storing `work_items` only in `InMemoryWorkItemStore`.
   - `170` `BaselineTestHealthRunner` calls `worktrees.checkoutIsolated(sha)` (`038` uses `acquire`), `l0Scanner.detectScripts(path)` (absent on `166`), and `harness.runInSandbox(slot, argv)` (`048` uses `execute`), storing baseline health and `quarantined_tests` only in RAM (`in-memory.ts`) instead of `state.db` (`schema/state.sql` `quarantined_tests`).

## 6. Shared-File & Ownership Conflicts
- `packages/brownfield/src/index.ts` and `packages/brownfield/package.json` must export all 5 submodules (`l0-scan`, `l1-codemap`, `l2-cards`, `opening`, `test-health`) and declare `web-tree-sitter` + `@ef-harness/{db,git-engine,sandbox,shared-observability,discovery}`.
- `schema/code-index.sql` / `CodeIndexDb` (`014` + `167` + `168`) needs an additive `module_cards` table so `168` persists SHA-256 module cards across sessions.

## 7. Runtime Wiring Gaps
- Wire `166–170` into `apps/daemon` (`066`), `069` `DiscoverySessionCoordinator`, `088` `ContextSlicerEngine`, `093` Phase 0, `129` `CrossFeatureUsageGraphChecker`, `153` `ArchitectureCanvas` (`Today`/`Change`), and `161` `VisualSteerRouter`.
- Wire `Task 175` `tests/e2e/m5-exit-gate` to exercise the real `@ef-harness/{brownfield,dictation,renderer,integrator,daemon}` modules.

## 8. Architecture & Security Violations
- `F-074`: `166` `git-exec.ts:22` executes ambient `PATH` `"git"` instead of hermetic `MinGit` (`035`).
- `F-073`: `168` duplicates `packet-security-redactor.ts` instead of delegating to `@ef-harness/shared-observability` (`011`).

## 9. Test Coverage & Verification Gaps
- `Task 175` M5 Exit Gate passes 100% vacuously against self-contained mock classes inside `tests/e2e/m5-exit-gate/**`.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-073` (`HIGH`):** Brownfield L1/L2 (`167`–`168`) Undeclared & Uncalled `web-tree-sitter` WASM, Synchronous Event-Loop Blocking, Lowercase Governor `"orange"`/`"red"` Check, Fake Linear Edges in `renderPersonalizedMap` & Missing `code-index.db.module_cards` Persistence.
- **`F-074` (`HIGH`):** `packages/brownfield` (`166`–`170`) 5-Way Internal Silo Isolation, Empty Barrel, Ambient `PATH` `"git"`, Volatile In-Memory `work_items`/`quarantined_tests` & Upstream Port Mismatches (`017, 035, 038, 048, 069, 088, 153`).
- **`F-075` (`HIGH`):** `Task 175` M5 Exit Gate Self-Contained Toy Re-Implementations (Zero Workspace Imports, Non-SQLite `CodeIndexDatabase` Stub, `.git/HEAD`-Only Live Mode) & `.ts` Extension Imports.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`166, 167, 168, 169, 170, 175`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and `schema/code-index.sql`.
- [x] **Pass 05 100% COMPLETE (`175 / 200` units audited!).**
- [x] Findings recorded immediately in `audit_findings.md` (`F-073`–`F-075`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-06/chunk-001`: `Tasks 176–181` (`packages/ship-deploy` external `effects` ledger, GitHub rate-aware queue & pre-push guard, PR/CI repair loop, Vercel & Docker-SSH deploy adapters, 6-phase expand-contract prod migrations, post-deploy smoke & rollback).
