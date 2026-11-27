# Pass 05 — Chunk 003 Audit Report (Interactive Architecture Canvas, 14-Type Popovers, Single Composer, Box-Chat Intents & Spec/Plan/Matrix Tabs — `Tasks 153–156, 159`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-05`
- **Chunk:** `chunk-003`
- **Units Audited (5):**
  - `Task 153` (`task/153-interactive-architecture-canvas` @ `f38da6d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-153-interactive-architecture-canvas`, unmerged, clean)
  - `Task 154` (`task/154-canvas-popovers-multiselection` @ `cb0b77d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-154-canvas-popovers-multiselection`, unmerged, clean)
  - `Task 155` (`task/155-single-composer-state-machine` @ `8405651`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-155-single-composer-state-machine`, unmerged, clean)
  - `Task 156` (`task/156-canvas-box-chat-intents` @ `2c03735`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-156-canvas-box-chat-intents`, unmerged, clean)
  - `Task 159` (`task/159-spec-browser-plan-tree-tabs` @ `cd7bfd6`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-159-spec-browser-plan-tree-tabs`, unmerged, clean)
- **Governing Architecture Documents:** `interactive-architecture.md`, `linked-graphs-design.md`, `linked-architecture-revisions.md`, `routing-design.md`, `spec-expansion.md`, `planning-and-crew.md`, `security-and-governance.md`, `schema/state.sql`, `schema/queries.sql`, `dictation-and-canvas.mmd`.

## 2. Files Directly Inspected
- `schema/state.sql` (`700–796`)
- `apps/renderer/package.json` (`task-153`)
- `apps/renderer/src/canvas/graph/{saved-node-position-store.ts,react-flow-canvas-view.ts,local-ports.ts}` (`Task 153`)
- `apps/renderer/src/canvas/popovers/registry.ts` (`Task 154`)
- `apps/renderer/src/composer/composer-target-state-machine.ts` (`Task 155`)
- `apps/renderer/src/canvas/intents/{sql.ts,graph.ts,controller.ts}` (`Task 156`)
- `apps/renderer/src/canvas/tabs/state-db.ts` (`Task 159`)

## 3. Verified Local Strengths
- `InteractiveArchitectureCanvas` (`153`) implements 4-level semantic zoom (`System` → `Features & Contracts` → `Rules & Requirements` → `Tasks & Runtime`), conflict bubbling across zoom levels, Web Worker `ELK.js` layout preserving `pinnedByUser` positions, viewport culling, and `Today`/`Change`/`Both` brownfield layer filters.
- `NodeTypePopoverRegistry`, `MultiBoxSelectionController`, and `PostSendChangeHighlighter` (`154`) cover all 14 canonical node types without leaking sealed-oracle test source during active builds, clamp popovers inside viewport bounds, and respect `prefers-reduced-motion`.
- `ComposerTargetStateMachine` (`155`) enforces the 4-target state machine (`Question`, `Box`, `Element`, `General`), per-target draft preservation, non-answering Canvas selection, `InputStartFocusSnapshot` lock on first keystroke, bare-number `TargetTypeMismatchGuard`, auto-return toast, and multi-box clause splitting.
- `BoxChatIntentController` (`156`) distinguishes `Correct (misheard)` vs `Change`, enforces zero-side-effect `Cancel` on `ZeroTokenImpactPreviewModal`, deduplicates multi-box impact unions, and catches `baseRevision !== currentDbRevision` via `RevisionDriftConflictPrompt`.
- `SpecBrowserTab`, `MatrixCoverageExplorer`, `MediumRiskProposalReviewPanel`, `PlanTreeAndPreviewTab`, and `RuntimeTasksTableTab` (`159`) separate `Planned Now` vs `Projected Later`, collapse universal matrix rules, block `Start Build` on active conflicts, and virtualize 500-row task tables.

## 4. Local Implementation Defects Discovered
1. **Illegal `node:sqlite`, `node:fs`, and `node:crypto` Imports Inside `apps/renderer` + Fabricated `INTENT_GRAPH_SCHEMA_SQL` (`Tasks 156 & 159` — `F-067`):**
   - `156` (`apps/renderer/src/canvas/intents/graph.ts:1`, `sql.ts:32-115`) imports `{ DatabaseSync } from "node:sqlite"` inside the Chromium renderer bundle and instantiates a fabricated 20-column `nodes` table (`value`, `lifecycle`, `built`, `landed`, `provenance_quote`, `amber`, `dictation_badge`, etc.) plus out-of-schema `vocabulary_corrections`.
   - `159` (`apps/renderer/src/canvas/tabs/state-db.ts:1-4,52-58,93-122`) imports `"node:crypto"`, `"node:fs"`, and `{ DatabaseSync } from "node:sqlite"` inside `apps/renderer`, reads `state.sql` from disk via `fs.readFileSync`, registers an **8th divergent `ef_search_text` UDF** (`F-010`), and executes direct SQLite writes inside the renderer process!
2. **Undeclared `@xyflow/react` & `elkjs` Dependencies in `apps/renderer/package.json` (`Task 153` `react-flow-canvas-view.ts:8` vs `apps/renderer/package.json:20-28` — `F-067`):** `react-flow-canvas-view.ts` imports `@xyflow/react` (and `elk-incremental-layout-engine.ts` uses ELK) without declaring `@xyflow/react` or `elkjs` in `apps/renderer/package.json`.

## 5. Cross-Unit Contract & Seam Mismatches
1. **Missing `canvas_layout` Persistence & Disconnected Intra-Canvas/Composer/Daemon Ports (`Tasks 153–156, 159` vs `017, 071, 073, 079, 080, 084, 087, 102, 108, 113, 122, 129, 158` — `F-068`):**
   - `schema/state.sql` has no `canvas_layout` table; `153` defaults to volatile `MemoryCanvasLayoutPersistence` and calls `shell.readCanvas()`/`writeCanvas()` absent on `122`'s `ShellLayoutContext`.
   - Zero imports exist across `153` (`canvas/graph`), `154` (`canvas/popovers`), `155` (`composer`), `156` (`canvas/intents`), and `159` (`canvas/tabs`).
   - `156` `BoxChatIntentController` keeps its own duplicate `draft`/`cursor`/`locks` state instead of consuming `155` `ComposerTargetStateMachine` + `113` `InputStartFocusSnapshot`, and calls 9 `Local*` stand-ins (`LocalAskOwnerResponder`, `LocalReverseImpactWalker`, `LocalChangeClassifier`, `LocalEarlyCutoffReverifier`, `LocalReverifyBeforeReworkGate`, `LocalRevisionAutoStartPolicy`, `LocalPremiseSupersessionReopener`, `LocalDictationVocabulary`, `LocalPostSendChangeHighlighter`) instead of routing over IPC to `harnessd` (`071, 087, 102, 108, 129, 158`) and `154` (`PostSendChangeHighlighter`).

## 6. Shared-File & Ownership Conflicts
- `apps/renderer/package.json` and `apps/renderer/src/index.ts` must add `@xyflow/react`, `elkjs`, `react`, `react-dom` (`F-063`, `F-067`) and mount `153`, `154`, `155`, `156`, and `159` into `122` `SingleAppShell`.

## 7. Runtime Wiring Gaps
- Move `156` (`IntentGraph`) and `159` (`CanonicalStateDb`) SQLite queries/mutations onto `apps/daemon` (`066`) backed by `@ef-harness/{db,discovery,spec-expansion,planner,integrator,steering,dictation}` over typed IPC (`009`/`031`/`067`); add `canvas_layout` to `@ef-harness/db` `state.db` v2 migration (`015`); and wire `153` ↔ `154` ↔ `155` ↔ `156` ↔ `159` inside `122` `SingleAppShell`.

## 8. Architecture & Security Violations
- `F-067`: Importing `node:sqlite`, `node:fs`, and `node:crypto` inside `apps/renderer` (`156`, `159` — matching `141` `F-058`) violates Electron renderer `contextIsolation` / `nodeIntegration: false` sandboxing (`security-and-governance.md`, `desktop-app.md`) and breaks browser/renderer bundling.

## 9. Test Coverage & Verification Gaps
- Unit tests in `153`–`156` and `159` run under Node Vitest (where `node:sqlite` and `node:fs` accidentally work!) rather than a browser/Chromium renderer environment, masking the illegal Node built-in imports.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-067` (`CRITICAL`):** `apps/renderer/src/canvas/{intents,tabs}` (`156`, `159`) Illegal Renderer `node:sqlite`/`node:fs`/`node:crypto` Imports, Fabricated 20-Column `nodes` Schema, 8th `ef_search_text` UDF & Undeclared `@xyflow/react`/`elkjs` Dependencies (`153`).
- **`F-068` (`HIGH`):** Canvas & Composer Silos (`153`–`156`, `159`) Missing `canvas_layout` SQLite Table, Missing `ShellLayoutContext.readCanvas`/`writeCanvas`, Duplicate Composer State in `156`, and Nine `Local*` Stand-Ins Disconnected from `harnessd` IPC.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`153, 154, 155, 156, 159`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and `schema/state.sql`.
- [x] Cross-checked against `010, 015, 017, 071, 073, 079, 080, 084, 087, 102, 108, 113, 122, 129, 158`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-067`–`F-068`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-05/chunk-004`: `Tasks 157–158, 160–161` (`packages/dictation` Whisper STT `157` & vocabulary `158`, `apps/daemon` Live App Preview runner `160`, `apps/renderer` JSX `data-ef-source` tagger & Point-to-Fix `161`).
