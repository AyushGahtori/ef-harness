---
task_id: "Task-162"
branch: "task/162-office-pixijs-floor-sprites"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/renderer/src/office/renderer/**"
  - "apps/renderer/assets/office/**"
  - "apps/renderer/tests/office-renderer/**"
  - ".agent-handoffs/task-162.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 162 handoff

Office View v1 PixiJS 2D renderer, 11-room Tiled JSON floor plan, and cozy 16-px layered sprite engine on `task/162-office-pixijs-floor-sprites`.

## Exports Provided

For Task 163 (seated cast), Task 164 (A* director), Task 165 (a11y overlay), Task 196 (art integrity):

- `OfficePixiViewport` — crisp 16-px PixiJS v8 viewport (`nearest`, integer zoom 1–4, WebGL with Canvas fallback, theme sync, ticker pause, WebGL context-loss hooks).
- `TiledFloorPlanLoader` — loads `floorplan-v1.tmj` (collision, walkable, desk anchors, 11 room objects); `verifyRoomConnectivity` BFS across all room pairs.
- `CozyPixelSpriteAtlasEngine` — Aseprite JSON + PNG atlas, Y-depth layering, `< 24 MB` budget guard.
- `OfficeCameraController` — pan, integer zoom, room-jump pills, fit-to-viewport, pan clamp.
- `ROOM_IDS` / `ROOM_JUMP_PILLS` / `OfficeRoomId` — canonical 11 room ids.

Supporting: `OfficeVisibilityController`, `paletteForTheme`, `MemoryShellThemePort`, `ShellThemePort`, `floorPlanAssetPath`, `spriteAtlasJsonPath`, `tilesReachable`, `SPRITE_DEPTH_ORDER`.

## Shared Wiring Needs (Root / Index Barrels)

Do **not** edit `apps/renderer/src/index.ts` on this branch. Integration should add:

```ts
export {
  OfficePixiViewport,
  TiledFloorPlanLoader,
  CozyPixelSpriteAtlasEngine,
  OfficeCameraController,
  OfficeVisibilityController,
  ROOM_IDS,
  ROOM_JUMP_PILLS,
} from "./office/renderer/index.js";
```

Mount `OfficePixiViewport` in Task 122 `CenterWorkspaceTabs` Office slot; bind `ShellThemePort` from Task 122 theme store. Resolve `pixi.js` from root hoisting (already in foundation `package.json` devDependencies).

## Dependency Intents (New Packages Requested)

None for root `package.json`. Renderer `package.json` remains frozen; office code imports `pixi.js` from workspace root.

## Contract Change Requests

None.

## Exact Verification Commands & Results

```text
pnpm --filter @ef-harness/renderer typecheck
# exit 0

pnpm --filter @ef-harness/renderer lint
# exit 0

pnpm --filter @ef-harness/renderer test -- office-renderer
# pass (floorplan 11 rooms + BFS, atlas budget/16px frames, camera zoom, ticker pause, context-loss simulation)

node scripts/verify-harmony.mjs --task 162
# exit 0
```

## Known Limitations / Follow-Ups

- v1 ships procedural placeholder pixel tiles/sprites; Task 196 adds bundled art integrity checksums.
- Cast movement, labels, and interactions land in Tasks 163–165; renderer exposes walkable grid and desk anchors only.