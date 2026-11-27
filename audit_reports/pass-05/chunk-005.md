# Pass 05 — Chunk 005 Audit Report (`apps/renderer` Cozy 16-px Pixel-Art Office View, Seated Cast, Truthful A* Animation Director & Accessibility Auto-Fallback — `Tasks 162–165` + 2 Excluded Duplicate Branches)

## 1. Chunk Identification and Scope
- **Pass:** `pass-05`
- **Chunk:** `chunk-005`
- **Active Units Audited (4):**
  - `Task 162` (`task/162-office-pixijs-floor-sprites` @ `73d1bd4`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-162-office-pixijs-floor-sprites`, unmerged, clean)
  - `Task 163` (`task/163-office-seated-cast-tags-flows` @ `e70dc27`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-163-office-seated-cast-tags-flows`, unmerged, clean)
  - `Task 164` (`task/164-office-animation-director-v2` @ `0272a00`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-164-office-animation-director-v2`, unmerged, clean)
  - `Task 165` (`task/165-office-accessibility-auto-fallback` @ `c3401c3`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-165-office-accessibility-auto-fallback`, unmerged, clean)
- **Superseded Empty Duplicate Branches Verified for `Exclusions` (2):**
  - `task/162-office-pixijs-floorplan-sprites` @ `6497730` (`== main`, `0` committed product/test files; worktree `C:/Users/Ayush/Desktop/ef-wt/task-162-office-pixijs-floorplan-sprites` has only untracked `?? .agent-handoffs/task-162.md`) — superseded by `task/162-office-pixijs-floor-sprites` (`73d1bd4`).
  - `task/164-office-animation-director-astar` @ `6497730` (`== main`, `0` committed product/test files; worktree `C:/Users/Ayush/Desktop/ef-wt/task-164-office-animation-director-astar` has only untracked `?? .agent-handoffs/task-164.md`) — superseded by `task/164-office-animation-director-v2` (`0272a00`).
- **Governing Architecture Documents:** `office-view.md`, `open-design-questions.md`, `app-shell-and-governor.md`, `build-cockpit.md`, `cockpit-and-office.mmd`, `research/office-view-prior-art.md`.

## 2. Files Directly Inspected
- `apps/renderer/package.json` (`task-162`)
- `apps/renderer/src/office/renderer/{asset-paths.ts,office-pixi-viewport.ts,local-ports.ts,room-ids.ts,tiled-floor-plan-loader.ts,cozy-pixel-sprite-atlas-engine.ts}` (`Task 162`)
- `apps/renderer/src/office/cast/{office-cast-projector.ts,ports.ts,rooms.ts,format-agent-office-tag.ts}` (`Task 163`)
- `apps/renderer/src/office/director/{constants.ts,truthful-animation-director.ts,types.ts,synthetic-walkable-grid.ts}` (`Task 164`)
- `apps/renderer/src/office/a11y/{types.ts,orange-pressure-auto-board-fallback.ts,office-a11y-coordinator.ts,office-reduced-motion-adapter.ts}` (`Task 165`)

## 3. Verified Local Strengths
- `TiledFloorPlanLoader` & `CozyPixelSpriteAtlasEngine` (`162`) ship a real `floorplan-v1.tmj` containing all 11 canonical rooms with BFS-verified walkable connectivity, `< 24 MB` 16×16 nearest-neighbor pixel atlas integrity checks, `webglcontextlost`/`webglcontextrestored` hooks, WebGL-to-Canvas2D fallback, and `0`-frame hidden-tab ticker stop via `OfficeVisibilityController`.
- `OfficeCastProjector` (`163`) enforces 100% truthful `state.db` projection (`0` phantom NPCs when idle), `<= 22`-char `AgentID · short title` formatting (`A0014 · print page`), `Jr`/`Mid`/`Sr`/`Principal` rank outfits, color+shape colorblind-safe provider desk pins, strict `<= 3` helper sprites + `+N` pill, and CEO paper tray / Front Desk parcel counters.
- `TruthfulAnimationDirector` (`164`) enforces per-character `maxQueueLen = 2` queues, `400 ms` `BurstCollapseEventQueue`, `0 ms` Frame-0 `State-Beats-Motion` icon/health updates, `<= 2000 ms` lag-snap teleport, `1000 ms` minor dwell smoothing, `< 0.5 ms` A* pathfinding with snap fallback on blocked tiles, and virtual-clock testability.
- `OfficeA11yCoordinator` (`165`) provides `prefers-reduced-motion` static seated mode, `ORANGE`/`RED` automatic Board fallback with `GREEN` non-forced recovery offer, logical semantic DOM mirror with `1500 ms` debounced `aria-live="polite"`, `<= 28` Bullpen hot-desk overflow counter, and strictly OFF-by-default chimes with Focus Mode auto-mute.

## 4. Local Implementation Defects Discovered
1. **Missing `"pixi.js"` Dependency in `apps/renderer/package.json`, Forbidden Node `node:fs`/`node:path`/`node:url` Imports in Sandboxed Renderer, and Hardcoded `800×600` Bootstrap Size (`Task 162` — `F-071`):**
   - `office-pixi-viewport.ts:1` imports `{ Application, Container } from "pixi.js"`, but `apps/renderer/package.json:20-22` declares only `"@ef-harness/shared-contracts": "workspace:*"` in `dependencies` (omitting `"pixi.js"`).
   - `asset-paths.ts:1-4`, `tiled-floor-plan-loader.ts:1,49`, and `cozy-pixel-sprite-atlas-engine.ts:1,61,64` import `"node:fs"`, `"node:path"`, and `"node:url"` (`fs.readFileSync`, `fs.statSync`, `fileURLToPath`) inside `apps/renderer`, crashing Electron's sandboxed `BrowserWindow` (`sandbox: true, nodeIntegration: false`). Furthermore, `apps/renderer/package.json` `tsc` build does not bundle/copy `assets/office/*` for browser runtime consumption.
   - `OfficePixiViewport.bootstrap` (`office-pixi-viewport.ts:17-20,50-56,77-88,97-100`) accepts `options.width` and `options.height` in `OfficePixiViewportOptions`, never saves them, and hardcodes `800` and `600` (`viewportWidthPx: 800, viewportHeightPx: 600`, `app.init({ width: 800, height: 600 })`).
   - `OfficePixiViewport` initializes an empty `this.world = new Container()` (`office-pixi-viewport.ts:43,110`) without mounting tilemap sprites, cast sprites, labels, or focus rings onto the PixiJS scene graph.
2. **`OrangePressureAutoBoardFallback.setUserOverride(true)` Fails to Cap Office to Static Reduced-Motion Mode (`Task 165` `orange-pressure-auto-board-fallback.ts:56-63` — `F-072`):**
   - When the user manually overrides `ORANGE`/`RED` fallback back to Office View, `setUserOverride(true)` calls `this.pixi.start()` without forcing `OfficeReducedMotionAdapter` / `TruthfulAnimationDirector.setMotionEnabled(false)` (`seatAllAtDesks()`), violating the `Task 165` edge-case invariant requiring static reduced-motion mode while under `ORANGE` RAM pressure.

## 5. Cross-Unit Contract & Seam Mismatches
1. **3-Way `OfficeRoomId` Vocabulary Split Across `162`/`164` vs `163` vs `165` (`F-072`):**
   - `Task 162` (`room-ids.ts:2-14`) & `Task 164` (`director/constants.ts:2-14`): `"qa-verification-lab"` and `"integration-merge-bay"` (kebab-case).
   - `Task 163` (`cast/rooms.ts:4-16,59`, `office-cast-projector.ts:104,136-139`): `"qa-lab"` instead of `"qa-verification-lab"`, plus hardcoded `ROOM_ORIGIN` pixel coordinates instead of `TiledFloorPlanLoader` `deskAnchors`!
   - `Task 165` (`a11y/types.ts:1-9`): snake_case `"ceo_office"`, `"engineering_bullpen"`, `"qa_lab"`, `"merge_bay"`, `"shipping_dock"`, `"break_room"` plus virtual `"flagged"` — omitting 5 of the 11 canonical rooms (`front-desk`, `discovery-lounge`, `research-library`, `architecture-studio`, `planning-war-room`) from keyboard/screen-reader traversal!
2. **`163` ↔ `164` `OfficeCastProjector` & `162` ↔ `164` `WalkableGridPort` Contract Clashes (`F-072`):**
   - `163` `OfficeCastProjector.project(snapshot: OfficeCanonicalSnapshot, view?: OfficeViewState): OfficeCastScene` vs `164` `OfficeCastProjectorPort { project(agentId: string): CastProjection | null; listActiveAgentIds(): readonly string[] }`.
   - `162` `LoadedFloorPlan` (`walkable: ReadonlyArray<number>`, `rooms`, `deskAnchors`) vs `164` `WalkableGridSnapshot` (`walkable: ReadonlySet<string>` `"col,row"`, `roomDoorways`, `roomDesks`), causing `164` to run against `createSyntheticOfficeWalkableGrid()` (`synthetic-walkable-grid.ts:9-60`) instead of `floorplan-v1.tmj`.
3. **Upstream Cockpit & Governor Port Clashes (`162–165` vs `118, 122–127` — `F-072`):**
   - `165` `PressureMachinePort` (`a11y/types.ts:69-72`) expects `.pressure` and `.subscribe(...)`, whereas `Task 118` `PressureHysteresisStateMachine` exposes `currentLevel()` / `evaluate(sample)` without `.subscribe` (`F-055`).
   - None of `162–165` is exported from `apps/renderer/src/index.ts` (`122`) or wired to `122` `SingleAppShell`, `123` `PhaseLayoutPresetManager`, `124` `BoardCockpitView`, `125` `BoardHealthSignalEngine`, `126` `WorkerInspectorPanel`, or `127` `CalmInboxList`.

## 6. Shared-File & Ownership Conflicts
- `apps/renderer/package.json` (`122`, `153`, `162`) must add `"pixi.js"` alongside `"react"`, `"react-dom"`, `"@xyflow/react"`, and `"elkjs"`.
- `apps/renderer/src/index.ts` (`122`) must export and mount the unified `OfficeView` combining `162`, `163`, `164`, and `165`.
- Duplicate empty branches `task/162-office-pixijs-floorplan-sprites` (`6497730`) and `task/164-office-animation-director-astar` (`6497730`) must be listed in `combination_task.md` `Exclusions`.

## 7. Runtime Wiring Gaps
- Build a browser-safe asset loader for `floorplan-v1.tmj` + `cozy-office-atlas.{json,png}` + `office-tiles.png`, adapt `LoadedFloorPlan` (`162`) to `WalkableGridPort` (`164`) and `deskAnchors` (`163`), unify `OfficeRoomId` to `Task 162`'s 11 canonical `ROOM_IDS`, render cast/tile/label display objects onto `OfficePixiViewport.world`, and wire `OfficeA11yCoordinator` (`165`) to `118` `PressureHysteresisStateMachine` (over daemon IPC) and `122–127` Cockpit shell/panels.

## 8. Architecture & Security Violations
- `F-071`: `apps/renderer/src/office/renderer/{asset-paths.ts,tiled-floor-plan-loader.ts,cozy-pixel-sprite-atlas-engine.ts}` import Node's `node:fs`, `node:path`, and `node:url` inside the sandboxed Electron renderer.

## 9. Test Coverage & Verification Gaps
- Unit tests in `162–165` pass in Node Vitest using `fs.readFileSync` and mock `PixiApplicationLike` / `SIBLING_PORT_SWAPS` / `createSyntheticOfficeWalkableGrid`, never catching the missing `"pixi.js"` dependency, browser sandbox `node:fs` crash, or `"qa-verification-lab"` vs `"qa-lab"` vs `"qa_lab"` room-ID mismatches.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-071` (`HIGH`):** Office 2D Renderer (`162`) Undeclared `"pixi.js"` Dependency, Forbidden Renderer `node:fs`/`node:path`/`node:url` Imports, Hardcoded `800×600` Viewport Size, Unmounted `world` Scene Graph & Empty Duplicate Branch `task/162-office-pixijs-floorplan-sprites`.
- **`F-072` (`HIGH`):** Four-Way Office Submodule Isolation (`162`–`165`): 3 Incompatible `OfficeRoomId` Vocabularies (`"qa-verification-lab"` vs `"qa-lab"` vs `"qa_lab"`), `OfficeCastProjector`/`WalkableGridPort` Clashes, Uncapped `ORANGE` User-Override Motion, Missing `118`/`122–127` Wiring & Empty Duplicate Branch `task/164-office-animation-director-astar`.

## 11. Chunk Completion Gate Verification
- [x] Every active unit in scope (`162, 163, 164, 165`) + both superseded `6497730` branches inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and `office-view.md`.
- [x] Cross-checked against `106, 116, 118, 119, 122, 123, 124, 125, 126, 127`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-071`–`F-072`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-05/chunk-006`: `Tasks 166–170, 175` (`packages/brownfield` L0 scanner, L1 `web-tree-sitter` + PageRank `code-index.db`, L2 lazy module summaries, brownfield `Today`/`Change` opening flow, baseline test health & quarantine + `Task 175` M5 `resume-changer@497831ec` Exit Gate).
