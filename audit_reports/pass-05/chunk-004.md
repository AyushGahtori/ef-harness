# Pass 05 — Chunk 004 Audit Report (`packages/dictation` Whisper STT & Vocabulary, `apps/daemon` Live App Preview Runner & `Task 161` JSX Source Plugin + Point-to-Fix — `Tasks 157–158, 160–161`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-05`
- **Chunk:** `chunk-004`
- **Units Audited (4):**
  - `Task 157` (`task/157-local-whisper-dictation-engine` @ `6ebcdcd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-157-local-whisper-dictation-engine`, unmerged, clean)
  - `Task 158` (`task/158-dictation-vocabulary-normalizer` @ `1dd0dda`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-158-dictation-vocabulary-normalizer`, unmerged, clean)
  - `Task 160` (`task/160-live-app-preview-runner` @ `82213b1`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-160-live-app-preview-runner`, unmerged, clean)
  - `Task 161` (`task/161-jsx-source-plugin-point-to-fix` @ `58a5508`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-161-jsx-source-plugin-point-to-fix`, unmerged, clean)
- **Governing Architecture Documents:** `interactive-architecture.md`, `ui-design-system.md`, `prompt-contracts.md` (`visual-steer@1`), `app-shell-and-governor.md`, `test-environments.md`, `workspace-and-git.md`, `schema/global.sql`, `dictation-and-canvas.mmd`, `ui-design-system.mmd`.

## 2. Files Directly Inspected
- `packages/dictation/src/index.ts` (`task-157`)
- `packages/dictation/src/stt/whisper-engine.ts` (`Task 157`)
- `packages/dictation/src/vocabulary/{frozen-schema-adapter.ts,whisper-bpe.ts}` (`Task 158`)
- `apps/daemon/src/preview/{live-preview-daemon-runner.ts,create-runner.ts,local-job-supervisor.ts}` (`Task 160`)
- `apps/renderer/src/preview/point-to-fix/{visual-steer-router.ts,source-path.ts}` + `packages/planner/src/jsx-source-plugin/vite-plugin.ts` (`Task 161`)

## 3. Verified Local Strengths
- `LocalWhisperSttEngine` & `EditableDictationDraftController` (`157`) enforce never-auto-send editable drafts, LocalAgreement-2 confirmed/tentative spans, exact `3 s` hint and `60 s` auto mic-off + GPU release, `p < 0.72` amber underlines strictly on numbers/times/negations/domain terms, OS fallback when Whisper is unavailable, and zero `.wav` disk writes.
- `WhisperInitialPromptBuilder`, `TwoOccurrenceCorrectionLearner`, and `ProjectVerifiedSpokenIdNormalizer` (`158`) enforce exact `<= 224` GPT-2 BPE token caps with lowest→highest weight tail ordering, `>= 2` occurrence promotion + permanent user suppression, and grammar-guarded (`"there are two"` safe) project-verified spoken-ID normalization.
- `LivePreviewDaemonRunner`, `PersistentDemoDbManager`, `LastGoodPreviewFallbackStore`, and `IsolatedPreviewWebviewHost` (`160`) enforce lazy on-demand startup, `15 min` hidden / `RED` pressure suspension, additive-migration Demo DB preservation, crash fallback to `lastGoodPreviewCommitSha`, and `persist:ef-preview-<projectId>` Electron session isolation with off-origin navigation blocking.
- `DevOnlyJsxSourceTagPlugin` (`161`) injects `data-ef-source` strictly in non-production builds (`0` bytes in `NODE_ENV=production`) and `PointToFixPickerOverlay` captures single-element and drag-box gap regions cleanly.

## 4. Local Implementation Defects Discovered
1. **`gpt2.tiktoken` Asset Omitted From `dist/` Build Output (`Task 158` `packages/dictation/src/vocabulary/whisper-bpe.ts:25-26` — `F-069`):** `loadModel()` reads `path.join(path.dirname(fileURLToPath(import.meta.url)), "gpt2.tiktoken")` via `fs.readFileSync`, but `packages/dictation`'s `tsc` build script does not copy `src/vocabulary/gpt2.tiktoken` to `dist/vocabulary/gpt2.tiktoken`, causing `ENOENT` at runtime when imported from `dist/`.
2. **`VisualSteerRouter` Never Calls `visual-steer@1`, Hardcodes `"8 screens"`, and Falls Back to `"src/unknown/Unknown.tsx"` (`Task 161` `apps/renderer/src/preview/point-to-fix/visual-steer-router.ts:10-13,47-97` + `source-path.ts:1` — `F-070`):**
   - `source-path.ts:1` imports `"node:path"` inside `apps/renderer` (forbidden Node built-in in sandboxed renderer).
   - `VisualSteerRouter.route` never invokes the `visual-steer@1` LLM contract or `@ef-harness/shared-contracts` `VisualSteerOutputSchema` (`009`), checks only 2 hardcoded paths (`src/components/ui/button.tsx`, `design/tokens.json`), emits a hardcoded string `"This changes shared Button across 8 screens..."`, and falls back to `"src/unknown/Unknown.tsx"` instead of querying `code-index.db` (`167`) when `data-ef-source` is absent.
3. **Fake `LocalWindowsJobSupervisor` Claiming `killOnJobClose = true` (`Task 160` `apps/daemon/src/preview/local-job-supervisor.ts:34-79,98-120` — `F-070`):** Declares `readonly killOnJobClose = true as const` without ever creating a Windows Job Object (`child.kill("SIGKILL")` + `taskkill.exe`), leaving preview grandchild processes alive if `harnessd` crashes.

## 5. Cross-Unit Contract & Seam Mismatches
1. **`packages/dictation` (`157` ↔ `158`) Empty Barrel & Upstream Port Mismatches Against `014`, `040`, `118`, `132`, `155` (`F-069`):**
   - `packages/dictation/src/index.ts` is an empty `packageIdentity()` stub on both branches, and `157` and `158` have zero cross-imports.
   - `157` calls `gpu.acquireInteractive()` (`118` `GpuWhisperPriorityArbiter` exposes `activateDictation`/`deactivateDictation`), checks `pressure === "Red"` (`118` emits `"RED"` — `F-055`), and calls nonexistent `components.resolveWhisperComponent(modelId)` (`132`) and `jobs.superviseWhisper(...)` (`040`).
   - `158` defaults to volatile `MemoryGlobalDbVocabularyDriver` instead of `@ef-harness/db` `GlobalBrokerDb` (`014` `global.db.vocabulary` + `settings`).
2. **`160` (`LivePreviewDaemonRunner`) & `161` (`Point-to-Fix` / `DevOnlyJsxSourceTagPlugin`) Unwired from `014, 028, 038, 040, 050, 052, 057, 093, 111, 120, 155, 174` (`F-070`):**
   - `createLivePreviewDaemonRunner` (`create-runner.ts:31-69`) instantiates `LocalLiveKeyTestRefusalGuard`, `LocalTestEnvOrchestrator`, `LocalTemplateDbSeeder`, `LocalPortLeaseRepo`, `LocalWorktreeSlotPool` (an in-memory `commits` object map rather than a real Git worktree!), `LocalWindowsJobSupervisor`, and `LocalRuntimeOnlyEnvInjector` instead of wiring `014, 038, 040, 050, 052, 111, 120`.
   - `DevOnlyJsxSourceTagPlugin` (`161`) is not exported from `@ef-harness/planner` or wired into `093` Phase 0 `P0.8`, and `BeforeAfterBaselineApprover` (`161`) is disconnected from `028` `CasBlobStore`, `057` `UiPlaywrightContractVerifier`, `155` `SingleComposerView`, `160` `IsolatedPreviewWebviewHost`, and `174` `UiConsistencyPipeline`.

## 6. Shared-File & Ownership Conflicts
- `packages/dictation/src/index.ts` and `packages/dictation/package.json` must export `stt` (`157`) and `vocabulary` (`158`) and copy `gpt2.tiktoken` into `dist/vocabulary/`.
- `packages/planner/src/index.ts` must export `jsx-source-plugin` (`161`).
- `apps/daemon/src/index.ts` (`066`) and `apps/renderer/src/index.ts` (`122`) must mount `160` and `161`.

## 7. Runtime Wiring Gaps
- Run `packages/dictation` (`157`+`158`) in `apps/daemon` (`066`) wired to `GlobalBrokerDb` (`014`), `KnowledgeGraphRepo`/`NameRegistryRepo` (`017`/`019`), `WindowsJobObjectManager` (`040`), `GpuWhisperPriorityArbiter` (`118`), and `SignedComponentDownloader` (`132`), streaming draft updates over IPC to `155` `SingleComposerView`.
- Wire `LivePreviewDaemonRunner` (`160`) to real `GlobalBrokerDb` `port_leases` (`014`), `WorktreeSlotPool` (`038`), `WindowsJobObjectManager` (`040`), `TestEnvOrchestrator` (`050`), `TemplateDbManager` (`052`), `ProjectMergeQueue` (`111`), and `RuntimeOnlyEnvInjector` (`120`).
- Move `VisualSteerRouter` (`161`) path validation + `visual-steer@1` execution to `apps/daemon` (`066`) validated by `Task 009` `VisualSteerOutputSchema` + `code-index.db` (`167`) + `CasBlobStore` (`028`) + `UiPlaywrightContractVerifier` (`057`) + `UiConsistencyPipeline` (`174`).

## 8. Architecture & Security Violations
- `F-070`: `apps/renderer/src/preview/point-to-fix/source-path.ts:1` imports `"node:path"` inside `apps/renderer`, and `apps/daemon/src/preview/local-job-supervisor.ts` fakes `killOnJobClose = true` without a Windows Job Object.

## 9. Test Coverage & Verification Gaps
- `158`'s BPE tests run against `src/` TypeScript source, missing the `dist/vocabulary/gpt2.tiktoken` `ENOENT` build packaging defect; `160`'s runner tests run against synthetic in-memory `commits` maps rather than a real `wt/<project>/integration` Git worktree.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-069` (`HIGH`):** `packages/dictation` (`157`–`158`) Empty Barrel, Uncopied `gpt2.tiktoken` Build Asset Crash (`ENOENT` in `dist/`), Disconnected `stt`↔`vocabulary` Pipeline, Volatile `MemoryGlobalDbVocabularyDriver` & Upstream `118`/`132`/`040` Signature Mismatches.
- **`F-070` (`HIGH`):** Live App Preview (`160`) & Point-to-Fix (`161`) All-Mock `createLivePreviewDaemonRunner` (In-Memory `commits` Map & Fake `killOnJobClose`), Renderer `node:path` Import, Regex-Only `VisualSteerRouter` Bypassing `visual-steer@1`, and Unwired `P0.8`/`174` Baselines.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`157, 158, 160, 161`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md`.
- [x] Cross-checked against `009, 014, 017, 019, 028, 038, 040, 050, 052, 057, 093, 111, 118, 120, 132, 155, 167, 174`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-069`–`F-070`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-05/chunk-005`: `Tasks 162–165` (`apps/renderer` Cozy Office PixiJS v8 floor/sprites `73d1bd4`, seated agent cast `163`, A* animation director `0272a00`, a11y/reduced-motion/Orange fallback `165`, plus verify the 2 empty duplicate branches `162-office-pixijs-floorplan-sprites` & `164-office-animation-director-astar` at `6497730`).
