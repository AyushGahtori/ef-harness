---
task_id: "Task-153"
branch: "task/153-interactive-architecture-canvas"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/renderer/src/canvas/graph/**"
  - "apps/renderer/tests/canvas-graph/**"
  - ".agent-handoffs/task-153.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 153 handoff

Interactive Architecture Canvas (`React Flow` + off-main-thread `ELK.js`, saved positions, L1–L4 semantic zoom, search/status/brownfield filters) on `task/153-interactive-architecture-canvas`. Sibling task branches are not on base `649773097c387ae534b686ea5825f449f843aa7c`; local ports stand in for Task 017/032/122/169. Swap the rows below; keep the exported method names.

## Exports Provided

For Task 154 (selection & popovers), Task 155 (composer box target), Task 156 (box-chat intents / impact highlight), Task 169 (brownfield Today/Change layers):

- `InteractiveArchitectureCanvas` — live canonical graph controller: `bootstrap`, `reproject`, `refreshLayout`, `autoArrangeLayout`, `onNodeDragEnd`, `setSemanticZoomPill`, `setSearchQuery`, `setPhase`, `focusConnected`, `flushPendingGraphUpdates`, `syncFromShell` / `syncToShell`, keyboard + minimap/search chrome via `handleKey` / `toggleMinimap`.
- `CanvasSelectionContext` — single/multi selection and `focusConnected` neighborhood mode.
- `SavedNodePositionStore` — `state.db.canvas_layout`-shaped persistence via `CanvasLayoutPersistencePort` (`pinDragged`, `resetAutoArrange`, pinned respect invariant).
- `SemanticZoomController` — thresholds `SEMANTIC_ZOOM_THRESHOLDS` (L1 `<0.45`, L2 `<0.85`, L3 `<1.35`, L4 `>=1.35` / focus feature), cluster badges at L1.
- `CanvasSearchAndFilterBar` — status/type/brownfield/phase filters and sub-50ms search index.
- `ElkIncrementalLayoutEngine` — layered orthogonal ELK in a dedicated Node worker thread (`worker_threads` eval worker); unpinned-only incremental layout via `elk-layout-math` (`unpinnedElkGraph`, `placeBesidePinned`).
- `ReactFlowCanvasView`, `renderCanvasSurface`, `MemoizedCanvasNode` — `@xyflow/react` with `onlyRenderVisibleElements`, minimap (bottom-right), custom node grammar, accessible list fallback.
- `projectStateDbNode` / `projectStateDbEdge` — canonical SQLite node/edge projection helpers for live `state.db` rows (including `contradicts` before schema Task 081 lands).

Supporting: `MemoryKnowledgeGraphRepo`, `MemoryGraphEventStream`, `MemoryShellLayoutContext`, `MemoryCanvasLayoutPersistence`, `createLayoutWorkerClient`, `focusNeighborhood`, `conflictBubblesForLevel`, `visualGrammarForNode`, `reduceCanvasKey`, `projectCanvasGraph`, ports in `ports.ts`.

## Shared Wiring Needs (Root / Index Barrels)

Do **not** edit `apps/renderer/src/index.ts` on this branch. Integration should add:

```ts
export {
  InteractiveArchitectureCanvas,
  CanvasSelectionContext,
  SavedNodePositionStore,
  SemanticZoomController,
  CanvasSearchAndFilterBar,
  ElkIncrementalLayoutEngine,
  ReactFlowCanvasView,
  renderCanvasSurface,
  projectStateDbNode,
  projectStateDbEdge,
} from "./canvas/graph/index.js";
```

Declare on `@ef-harness/renderer` at integration (frozen here): `react`, `react-dom`, `@xyflow/react`, `elkjs` (already in root `devDependencies`; resolve via workspace hoisting). Mount `InteractiveArchitectureCanvas` from Task 122 `CenterWorkspaceTabs` Canvas slot; bind `ShellLayoutContextPort` + `KnowledgeGraphRepoPort` + `GraphEventStreamPort` from Task 122/017/032 handoffs.

## Dependency Intents (New Packages Requested)

None for root `package.json`. Renderer package remains frozen; canvas uses root-hoisted `react`, `@xyflow/react`, and `elkjs`.

## Contract Change Requests

1. **`schema/state.sql` — `canvas_layout` table** (referenced by task text): `canvas_layout(node_id, view_level, x, y, pinned_by_user)` with upsert keyed by `(node_id, view_level)`. This branch persists through `CanvasLayoutPersistencePort` + `MemoryCanvasLayoutPersistence` only.
2. **`edge_types` — `contradicts`** (Task 081): canvas renders and bubbles conflict edges before the type exists in foundation schema; integration should align `KnowledgeGraphRepo` edge reads.
3. **`ShellLayoutContextPort.hasSavedSession()`** — optional helper on Task 122 shell slice so returning from Board preserves canvas viewport/filters without re-centering Turn-1 discovery graphs.

Local ports to swap when sibling branches land:

| This branch | Replace with | Swap note |
| --- | --- | --- |
| `KnowledgeGraphRepoPort` + `MemoryKnowledgeGraphRepo` | Task 017 `KnowledgeGraphRepo` | `listActiveNodes`, `listActiveEdges`, `impactWalk` |
| `GraphEventStreamPort` | Task 032 incremental event stream | `subscribe` patch batches |
| `ShellLayoutContextPort` + `MemoryShellLayoutContext` | Task 122 `ShellLayoutContext` | `readCanvas` / `writeCanvas` viewport + filters |
| `CanvasLayoutPersistencePort` | Task 017/032 SQLite `canvas_layout` writer | same row shape |
| `WorkerInspectorPort` | Task 126 Worker Inspector | `openTaskInspector(taskNodeId)` |
| `projectStateDbNode` field mapping | Task 169 brownfield `observed`/`change` layers | `brownfieldLayer` on nodes |

## Exact Verification Commands & Results

```text
pnpm --filter @ef-harness/renderer typecheck
# exit 0

pnpm --filter @ef-harness/renderer lint
# exit 0

pnpm --filter @ef-harness/renderer test -- canvas-graph
# exit 0 — 4 files, 19 tests passed (26.17s on 2026-11-23)

node scripts/verify-harmony.mjs --task 153 --require-ready
# exit 0 — harmony ok for Task-153 (2026-11-23)
```

## Known Limitations / Follow-Ups

- Browser `elk-layout.worker.ts` module is present for Electron renderer builds; Node tests and Vitest use the `worker_threads` ELK pool in `ElkIncrementalLayoutEngine`.
- Full 300-node ELK in CI is bounded by worker timeout (45s); large graphs use incremental unpinned layout + saved pins (see `large graph layout` test).
- Search micro-benchmark assertion uses 50ms ceiling on Windows Vitest; hot path is still O(n) haystack scan over the in-memory index (<10ms in tight loop outside Vitest).
- Task 154 owns popovers/multi-select UI; this branch exports selection context only.
- Integration must wire `apps/renderer/src/index.ts` and replace memory ports per the swap table above.