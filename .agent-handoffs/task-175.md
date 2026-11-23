---
task_id: "Task-175"
branch: "task/175-m5-exit-gate"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "benchmarks/m5-resume-changer/**"
  - "tests/e2e/m5-exit-gate/**"
  - "tests/e2e/tests/m5-exit-gate.test.ts"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 175 handoff

M5 exit gate for `resume-changer@497831ec`: guided brownfield change, Canvas/Composer/Dictation/Point-to-Fix, and Office truthfulness. Commit stays on `task/175-m5-exit-gate`. Do not merge.

Sibling branches `153`–`174` are not on this base (`649773097c387ae534b686ea5825f449f843aa7c`). The gate talks to them through local ports under `tests/e2e/m5-exit-gate/`. Swap the module. Keep the method names. Do not import the unpublished packages as if they were already on `harness/integration`.

The pinned manifest is read only from `resume-changer-benchmark.json` (`CANONICAL_ASSETS.resumeChangerBenchmark`). This branch does not edit it. The offline code slice is `benchmarks/m5-resume-changer/fixture.json`. CI does not clone GitHub.

## Exports Provided

Import from `tests/e2e/m5-exit-gate/index.ts` until a package barrel is allowed to re-export them.

- `ResumeChangerBenchmarkVerifier` — `verify(manifest, fixture, faults)` checks the pinned commit `497831ec5aa7effb354bb1a8d22d2f031b17a4e0`, 73 `docs/` files, 17 plan/task files, and 4,906 plan lines. It runs the L0/L1/L2, opening, baseline, coexistence, human-author, and 6-stage UI ports. L0 must finish under `2_000` ms, detect Next.js + Tailwind + Vitest, and read `0` bytes from `.env*` paths. L1 writes symbols and PageRank into an in-memory `code-index.db` shaped like `schema/code-index.sql`. L2 keeps focus `<= 20` and drops a `likely_stale` doc that names `src/features/print/DeletedPrintRoute.tsx`.
- `M5InteractiveUxE2eSuite` — `run(faults)` covers pinned drag survival across a Wave 2 add, L1–L4 zoom (`<0.45`, `<0.85`, `<1.35`, else L4), zero-token impact under `15` ms, revision-drift prompt, exact post-send deltas, per-target drafts, the bare `"2"` mismatch block, grey-then-black dictation with no auto-send at `4_000` ms, the `3_000` ms hint, the `60_000` ms mic-off, amber times/negations below `0.72`, two-occurrence `supabase` → `Supabase`, spoken `rule seventeen` → `R17` only, isolated `persist:ef-preview-resume-changer`, additive Demo DB survival, `0` production `data-ef-source` tags, click + drag-box capture, and Before/After widths `375` and `1440`.
- `OfficeTruthfulnessCertifier` — `certify(faults)` projects one worker per room across the 11 Task 162 room ids, formats `A0014 · print page` (22-character clamp), shows at most 3 helpers plus `+N`, applies state icons at `0` ms, teleports when unbounded lag would be `2_300` ms so `maxVisualLagMs` stays `<= 2_000`, collapses a 6-event burst to queue length `2`, reports idle CPU `1.35%` and hidden CPU `0%`, static reduced-motion, Orange → Board, `32` bullpen workers with overflow `32 - 28`, and `0` serious mirror issues.
- `M5ExitGateReport` — schema id `m5-exit-gate-report@1`. `evaluate(facts, hostElapsedMs)` fail-closes on any single reason. `renderScorecard` writes the Markdown scorecard. `signReport` is `sha256:` over the canonical signing view (sorted keys, no `signature`, no `hostElapsedMs`). `claimedCertification` is true only when `exitCode` is `0`.
- `runM5Certification` / `runLiveCertification` — ci-replay returns the signed report. `--live` is `node tests/e2e/m5-exit-gate/run-m5-suite.ts --live` and exits `2` without a network call. A local `EF_M5_RESUME_CHANGER_ROOT` directory may be noted; it still does not claim certification on this base.

Fail-closed reasons include `manifest`, `l0Scan`, `l0Secrets`, `l0Latency`, `l1Index`, `l2Focus`, `staleDocs`, `preSpend`, `stackQuestions`, `conventions`, `baselineRegression`, `secondUiKit`, `todayChange`, `coexistence`, `shaPreserved`, `silentStash`, `humanAuthorship`, `scopeFence`, `uiConsistency`, `uiContrast`, `uiRhythm`, `pinnedDrag`, `semanticZoom`, `impactPreview`, `driftConflict`, `changeHighlight`, `draftPreserve`, `typeMismatch`, `dictationAutoSend`, `dictationTiming`, `amberHighlight`, `vocabCorrection`, `spokenId`, `previewPartition`, `demoDb`, `prodSourceTags`, `pointToFix`, `beforeAfter`, `officeCast`, `officeTag`, `officeHelpers`, `officeIconLatency`, `officeVisualLag`, `officeBurst`, `officeIdleCpu`, `officeHiddenCpu`, `reducedMotion`, `orangeBoard`, `hotDeskOverflow`, `axeSerious`, `hostElapsed`, and `liveNotClaimed`.

## Shared Wiring Needs (Root / Index Barrels)

No barrel edit. `tests/e2e/src/index.ts` and `benchmarks/src/index.ts` stay frozen.

`tests/e2e/vitest.config.ts` is frozen and only includes `tests/**/*.test.ts`. The suite is launched from `tests/e2e/tests/m5-exit-gate.test.ts`, which that include already collects and which the `m5-exit-gate` filter matches. The runner stays in `tests/e2e/m5-exit-gate/`. That launcher is the only file outside `benchmarks/m5-resume-changer/**` and `tests/e2e/m5-exit-gate/**`.

When root `package.json` can change, add:

```json
"test:m5-exit-gate:replay": "node tests/e2e/m5-exit-gate/run-m5-suite.ts",
"test:m5-exit-gate:live": "node tests/e2e/m5-exit-gate/run-m5-suite.ts --live"
```

When `tests/e2e/src/index.ts` can change, re-export the gate from the owned barrel:

```ts
export {
  M5ExitGateReport,
  M5InteractiveUxE2eSuite,
  OfficeTruthfulnessCertifier,
  ResumeChangerBenchmarkVerifier,
  REPORT_SCHEMA,
  runM5Certification,
} from "../m5-exit-gate/index.ts";
```

## Dependency Intents (New Packages Requested)

None. No new package and no dependency edit.

## Contract Change Requests

None. `resume-changer-benchmark.json` and `schema/code-index.sql` stay read-only.

## Sibling swaps (branches not on this base)

| Local port | Missing sibling | Swap |
| --- | --- | --- |
| `benchmarks/m5-resume-changer/fixture.json` plus `loadResumeChangerManifest` | Pinned `resume-changer-benchmark.json` and a real checkout of `497831ec` | Keep the count checks (73 / 17 / 4,906). Replace the code slice with the checkout. Do not clone GitHub from CI. |
| `BrownfieldL0RepoScanner` | Task 166 `BrownfieldL0RepoScanner` / `StackAndFrameworkDetector` | Same scan result: Next.js, Tailwind, Vitest, doc/plan counts, `0` secret bytes. |
| `WasmTreeSitterIndexer` / `AiderPageRankCalculator` / `CodeIndexDatabase` | Task 167 | Same names. Real WASM index and `code-index.db` replace the structural export scan. Schema text stays `schema/code-index.sql`. |
| `RequestDrivenFocusSelector` / `StaleDocsDetector` / `L2PreSpendEstimator` | Task 168 | Focus cap `20`. Stale status `likely_stale` drops the deleted print route. Pre-spend text stays visible. |
| `BrownfieldOpeningController` / `TodayVsChangeConfirmationBuilder` / `ExistingConventionsExtractor` | Task 169 | `0` redundant stack questions. Today layer does not contain the new toggle. Tokens stay the repo's. |
| `BaselineTestHealthRunner` | Task 170 | Baseline pass rate `1` and the new export-tone check. |
| `EditorCoexistenceWatcher` | Task 171 | `0` interruptions. SHA-256 of the untouched dirty file stays put. |
| `ZeroStashLandingExecutor` | Task 172 `ZeroStashLandingExecutor` | Command list must not include `git stash`. Scope fence rejects the untouched path. |
| Human author fields | Task 173 | `HUMAN_OWNED` with `Developer Checkout <developer@localhost>`. Harness email `foundation@ef-harness.local` fails the gate. |
| `UiConsistencyPipeline` | Task 174 | Six stages. Contrast drift fails stage 4. Header drift fails stage 5. A second kit (`@mui/material`, `@chakra-ui/react`, `antd`) fails the duplicate stage. |
| `SavedNodePositionStore` / `SemanticZoomController` | Task 153 | Three pinned boxes survive Wave 2. Zoom thresholds match `SEMANTIC_ZOOM_THRESHOLDS`. |
| `PostSendChangeHighlighter` | Task 154 | Exact added/updated ids. Highlight window stays the sibling's `8_000` ms when the real highlighter is swapped. |
| `PerTargetDraftStore` / `TargetTypeMismatchGuard` | Task 155 | Keys `question:Q-04`, `box:D-17`, `element:E-9`. Bare `"2"` is blocked when options are not numeric. |
| `RevisionDriftConflictPrompt` / `ZeroTokenImpactPreviewModal` | Task 156 | Prompt when `baseRevision !== current`. `llmCalls` stays `0` and elapsed stays `< 15`. |
| `DictationStabilityStream` / `EditableDictationDraftController` / `LowConfidenceCriticalSpanHighlighter` | Task 157 | Grey then black. Hint and mic-off strings match Task 157. `autoSend` stays false through a `4_000` ms pause. Amber cutoff `0.72`. |
| `TwoOccurrenceCorrectionLearner` / `ProjectVerifiedSpokenIdNormalizer` | Task 158 | Two distinct occurrence ids promote `Supabase`. Catalog is `R17`, `T-42`, `A0014`, `REQ-3`. `there are seventeen` is not rewritten. |
| `IsolatedPreviewWebviewHost` / `PersistentDemoDbManager` | Task 160 | Partition `persist:ef-preview-resume-changer` does not leak into `persist:ef-app`. Additive `tone` column keeps both demo rows. |
| `DevOnlyJsxSourceTagPlugin` / `PointToFixPickerOverlay` / `BeforeAfterBaselineApprover` | Task 161 | Production count of `data-ef-source` is `0`. Click and gap capture `ToneToggle.tsx`. Approval updates `375` and `1440`. |
| `OfficeCastProjector` / `formatAgentOfficeTag` / `HelperSpriteClusterManager` | Task 163, room ids from Task 162 | `A0014 · print page`, max `3` helpers, then `+N`. |
| `TruthfulAnimationDirector` / `BurstCollapseEventQueue` / `OfficeFrameBudgetMonitor` | Task 164 | `maxQueueLen` `2`, burst window `400` ms, `maxVisualLagMs` `2_000`, idle CPU under `5`, hidden CPU `0`. |
| `OfficeReducedMotionAdapter` / `OrangePressureAutoBoardFallback` / `HotDeskOverflowAggregator` / `OfficeSemanticMirrorTree` | Task 165 | Static reduced motion, Orange banner and Board tab, bullpen cap `28`, `0` serious axe findings. |

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-175-m5-exit-gate` after `pnpm install --frozen-lockfile` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`:

- `pnpm --filter @ef-harness/e2e typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/e2e lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/e2e test -- m5-exit-gate` — pass. Vitest v5.1.1, 1 file, 4 tests, about 0.7s. ci-replay gate exit 0: commit `497831ec5aa7effb354bb1a8d22d2f031b17a4e0`, docs `73`, plan files `17`, plan lines `4906`, L0 under `2s` with `0` secret bytes, `11` symbols and `8` ranked files in `code-index.db`, focus `3` (`<= 20`) with the deleted print route flagged `likely_stale` and ignored, `0` stack questions, baseline pass rate `1`, `0` stash, `0` interruptions, developer authorship kept, 6 UI stages, pinned drag `3/3`, zoom `L1,L2,L3,L4`, impact `0` LLM calls and well under `15` ms, no dictation auto-send at `4s`, mic hint at `3s` and mic off at `60s`, `Supabase` after two occurrences, `rule seventeen` → `R17`, `0` production `data-ef-source` tags, Office tag `A0014 · print page`, helpers `3` and `+2`, icon lag `0` ms, visual lag `2000` ms via teleport (unbounded `2300` ms fails), burst queue `2`, idle CPU `1.35%`, hidden CPU `0%`, Orange Board fallback, hot-desk `32` with overflow `4`, axe serious `0`, `hostElapsedMs` about `40` ms (`< 120_000`). Injected faults for silent stash, prod tags, `2.3s` lag, dictation auto-send, ignored stale doc, contrast drift, header drift, untouched-file edit, a second UI kit, secret reads, and a spoofed harness author all fail the gate. Live mode exits `2` and does not claim certification.
- `node tests/e2e/m5-exit-gate/run-m5-suite.ts` — exit 0. `node tests/e2e/m5-exit-gate/run-m5-suite.ts --live` — exit 2.
- `node scripts/verify-harmony.mjs --task 175` — pass (`harmony ok for Task-175`, exit 0, about 190s). Schema check, diagram check, owned-path scope, and workspace `pnpm typecheck`, `pnpm lint`, and `pnpm test` succeeded.

## Known Limitations / Follow-Ups

- Live M5 certification is not claimed. `--live` exits 2 even when `EF_M5_LIVE_CONFIRM=1` is set. A directory in `EF_M5_RESUME_CHANGER_ROOT` is only noted. No GitHub clone and no network call. Swap in the real sibling barrels before a live checkout can pass.
- Dictation `3s` / `4s` / `60s` and the Office lag teleport use a virtual clock. The ci-replay path does not sleep for those durations.
- `tests/e2e/tests/m5-exit-gate.test.ts` exists because `tests/e2e/vitest.config.ts` is frozen.
- `code-index.db` is an in-memory stand-in that checks `schema/code-index.sql` for `symbols` and `file_rank`. It does not open SQLite and it does not download tree-sitter grammars.
- The 73-doc inventory comes from the pinned manifest. `fixture.json` is the small source slice used for stack detection, the guided tone-toggle change, and the stale deleted-route assertion.
- Swap the local ports in the table above when the sibling barrels are on the integration branch.
