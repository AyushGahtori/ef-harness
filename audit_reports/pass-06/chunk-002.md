# Pass 06 — Chunk 002 Audit Report (`packages/investigations` 6-Stage Mystery-Bug Pipeline, Localization Toolkit, Repo-Wide Sweep Engine & Sweep Safety Guards — `Tasks 182–185`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-06`
- **Chunk:** `chunk-002`
- **Units Audited (4):**
  - `Task 182` (`task/182-mystery-bug-investigation` @ `e61ea0c`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-182-mystery-bug-investigation`, unmerged, clean)
  - `Task 183` (`task/183-investigation-localization-toolkit` @ `1a6730f`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-183-investigation-localization-toolkit`, unmerged, clean)
  - `Task 184` (`task/184-sweep-ownership-engine` @ `b2e1a1d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-184-sweep-ownership-engine`, unmerged, clean)
  - `Task 185` (`task/185-sweep-safety-guards` @ `afa760f`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-185-sweep-safety-guards`, unmerged, clean)
- **Governing Architecture Documents:** `investigations-and-sweeps.md`, `prompt-contracts.md` (`investigator@1`, `sweep-planner@1`, `sweep-worker@1`), `schema/state.sql` (`path_leases`, `tasks`), `knowledge-slicing.md`, `investigations-and-sweeps.mmd`, `research/debugging-and-codemods.md`.

## 2. Files Directly Inspected
- `packages/investigations/package.json` & `packages/investigations/src/index.ts` (`task-184`)
- `packages/investigations/src/pipeline/{investigation-store.ts,pipeline.ts}` (`Task 182`)
- `packages/investigations/src/localization/flake-safe-git-bisector.ts` (`Task 183`)
- `packages/investigations/src/sweeps/{sweep-lease-coordinator.ts,deterministic-codemod-runner.ts}` (`Task 184`)
- `packages/investigations/src/sweep-guards/{persisted-name-boundary-gate.ts,post-sweep-brief-symbol-updater.ts}` (`Task 185`)

## 3. Verified Local Strengths
- `MysteryBugInvestigationPipeline` & `StageGateEnforcer` (`182`) enforce the 6-stage scientific sequence (`INTAKE → CLEAN_REPRO → QUARANTINED_LOCALIZE → PROVEN_MINIMAL_FLIP_ROOT_CAUSE → SCOPED_FIX → PERMANENT_REPRO_AND_MECHANISM_TESTS`), block `src/` edits during Stage 2, discard Stage 3 scratch worktrees before Stage 5, verify bidirectional `RED → GREEN → RED` minimal-flip proofs, and escalate unreproducible bugs without blind patches.
- `DeltaDebuggingInputShrinker`, `HypothesisLoopGuard`, and `SymptomPatchDetector` (`183`) enforce `<= 40`-run `ddmin` input shrinking, 3-miss narrow-subsystem tunnel-vision pivots, and detection of empty `catch` blocks, `setTimeout`/`sleep` race masks, and test weakening.
- `SweepLeaseCoordinator` & `MaintenanceWindowDrainer` (`184`) enforce single `repo_wide` sweep exclusion, sorted lexicographical path-prefix acquisition, and `<= 8`-file tail shards.
- `PersistedNameBoundaryGate`, `RiskyAstTransformDetector`, and `SweepLeftoverScanner` (`185`) expand naming variants (`camelCase`, `PascalCase`, `snake_case`, `kebab-case`, `SCREAMING_SNAKE_CASE`), preserve Zone 2 persisted DB/API/env names and historical migrations by default, and flag variable-shadowing/ORM drift.

## 4. Local Implementation Defects Discovered
1. **Broken Binary-Search `125` Skip (`low = mid + 1`), Missing `finally` Cleanup & Ambient `PATH` `"git"` in `FlakeSafeGitBisector` (`Task 183` `flake-safe-git-bisector.ts:31-45,143-190` — `F-078`):**
   - When `commits[mid]` returns `GIT_BISECT_SKIP_EXIT` (`125` — broken intermediate build), lines `153–157` advance `low = mid + 1`, discarding the entire lower half `[low .. mid-1]` and misattributing any regression introduced prior to `mid`!
   - Uses `execFileSync("git", ...)` from `PATH` instead of `035` Hermetic `MinGit` and omits `try/finally` checkout cleanup if `BisectDepthExceededError` or `runRepro` throws mid-bisect.
2. **Missing Codemod Dependencies, Unsandboxed In-Process `ts-morph`/`ast-grep` Execution & `jscodeshift` Dry-Run Disk Mutation (`Task 184` `deterministic-codemod-runner.ts:30-96` + `package.json:20-22` — `F-078`):**
   - `packages/investigations/package.json` omits `ts-morph`, `@ast-grep/napi`, and `jscodeshift` (`ts-morph-backend.ts` exists only in `tests/sweeps/`).
   - `withSandbox` executes `ts-morph` and `ast-grep` callbacks in-process without `Task 045`/`048` sandboxing under a post-hoc `setTimeout` boolean that cannot interrupt synchronous hangs; `"jscodeshift"` (`lines 52-72`) runs `node [script]` even when `step.dryRun === true` (mutating files during dry-run) and hardcodes `preview: { filesChanged: 0, linesAdded: 0, linesRemoved: 0 }`.
3. **Private In-Memory Default `SqliteInvestigationStore` (`Task 182` `investigation-store.ts:18-36,66` — `F-078`):**
   - Defaults to `:memory:` and creates an unmigrated `investigations` table absent from `schema/state.sql`.

## 5. Cross-Unit Contract & Seam Mismatches
1. **4-Way `packages/investigations` Silo Isolation (`182`–`185`), Empty Barrel, `"queued"`/`"paused"` Task-Status Mismatch & `path_leases` Seam (`F-079`):**
   - `packages/investigations/src/index.ts` is an empty `packageIdentity()` stub across all 4 branches, with zero cross-imports (`182` never invokes `183`; `184` never invokes `185`).
   - `PostSweepBriefSymbolUpdater` (`post-sweep-brief-symbol-updater.ts:19-23,55-58`) stores `sweep_symbol_map` in a volatile `Map` and checks `task.status !== "queued" && task.status !== "paused"`, matching `0` real `state.db` tasks (`schema/state.sql` uses uppercase `'READY'`, `'BLOCKED'`, etc.).
   - `182` calls nonexistent `codeMap.queryAroundRoutes` (`167`) and `symptomCards.load` (`100`); `184` calls `openSweepIntent`/`grantSweepLease` (`mode: "intent" | "granted"`) instead of `schema/state.sql` `path_leases` (`mode IN ('write','intent','exclusive')` via `020` `TaskClaimLeasesRepo`).

## 6. Shared-File & Ownership Conflicts
- `packages/investigations/src/index.ts` and `packages/investigations/package.json` must export `pipeline`, `localization`, `sweeps`, and `sweep-guards` and declare `ts-morph`, `@ast-grep/napi`, and `@ef-harness/{db,git-engine,sandbox,verifier,brownfield,intake,planner,integrator}`.

## 7. Runtime Wiring Gaps
- Wire `183` into `182` Stages 3 & 5 and `185` into `184` `SweepOrchestrator`, persist `investigations` and `sweep_symbol_map` via `MigrationRunner` on `@ef-harness/db` single-writer `SqliteConnection`, adapt `SweepLeaseCoordinator` to `020` `path_leases` (`'intent' → 'exclusive'`), and feed `sweep_symbol_map` into `088` `ContextSlicerEngine`.

## 8. Architecture & Security Violations
- `F-078`: `184` `DeterministicCodemodRunner` executes `ts-morph`/`ast-grep` outside `045` OS sandboxing and mutates disk on `jscodeshift` `dryRun: true`; `183` executes ambient `PATH` `"git"`.

## 9. Test Coverage & Verification Gaps
- `183`'s bisect test placed the broken commit *before* the culprit (`#4` broken, `#6` culprit), accidentally masking the `low = mid + 1` bug whenever a broken commit sits *after* the true culprit!

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-078` (`HIGH`):** `investigations` (`182`–`184`) Broken `FlakeSafeGitBisector` `125` Skip (`low = mid + 1` Discards Earlier Culprits) & Missing `finally` Reset, Unsandboxed Codemods Missing `ts-morph`/`@ast-grep` Deps, `jscodeshift` Dry-Run Disk Mutation & Unmigrated `investigations` Table.
- **`F-079` (`HIGH`):** `packages/investigations` (`182`–`185`) 4-Way Internal Silos, Empty Barrel, `"queued"`/`"paused"` vs `'READY'`/`'BLOCKED'` Mismatch in `PostSweepBriefSymbolUpdater` & `path_leases` (`'granted'` vs `'exclusive'`) Seam.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`182, 183, 184, 185`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and `schema/state.sql`.
- [x] Cross-checked against `009, 017, 019, 020, 028, 035, 038, 039, 045, 048, 050, 055, 057, 088, 100, 111, 167, 170`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-078`–`F-079`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-06/chunk-003`: `Tasks 186–188` (`packages/portability` `harness-state` orphan-branch exporter, portable `.zip` archive & cross-device single-writer lease rehydrator, multi-project global WFQ resource broker).
