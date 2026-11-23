---
task_id: "Task-163"
branch: "task/163-office-seated-cast-tags-flows"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/renderer/src/office/cast/**"
  - "apps/renderer/tests/office-cast/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 163 handoff

Office View v1 seated cast on `task/163-office-seated-cast-tags-flows`. Projects canonical `state.db` workers onto the 11-room floor plan from Task 162 with zero decorative NPCs.

## Exports Provided

Import from `apps/renderer/src/office/cast/index.ts`:

- `OfficeCastProjector` — truthful 1-to-1 cast projection (`project(snapshot)`).
- `AgentLabelAndDeskPinLayer` — rank outfit + `AgentID · short title` + connection desk pin per worker.
- `HelperSpriteClusterManager` — max `3` helper sprites + `+N` pill per lead desk.
- `OfficeInteractionController` — hover status, click-through to inspector/inbox/station summaries.
- `PaperAndParcelFlowVisuals` — CEO inbox paper stack + Front Desk parcel stack.
- `formatAgentOfficeTag` — `A0014 · print page`, clamped to 22 characters (matches Task 124 `formatAgentTag`).
- `roomForWorker`, `overheadIconFor`, `resolveConnection`, `ROOM_IDS`, `placeAgentLabels`, `formatOfficeStatusLine`.
- `OfficeCanonicalSnapshot` — integrators populate this snapshot directly from live `state.db` rows (no duplicate adapter in this subtree).

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `apps/renderer/src/index.ts` from this task. When an integrator owns that barrel, re-export:

```ts
export {
  OfficeCastProjector,
  OfficeInteractionController,
  HelperSpriteClusterManager,
  PaperAndParcelFlowVisuals,
  formatAgentOfficeTag,
  ROOM_IDS,
} from "./office/cast/index.js";
```

- **Task 162 `OfficePixiViewport`:** mount cast sprites from `OfficeCastProjection.sprites` at desk anchors for each `roomId`.
- **Task 124 Board:** share `formatAgentOfficeTag` with `formatAgentTag` (identical clamp rules).
- **Task 125 `BoardHealthSignalEngine`:** pass as `OfficeCastHealthPort` for overhead icons.
- **Task 126 `WorkerInspectorPanel`:** wire `WorkerInspectorPort.open`.
- **Task 127 Calm Inbox:** wire `CalmInboxPort.focusTopActionable` on CEO tray click.

## Dependency Intents (New Packages Requested)

No package.json or lockfile edits from this task.

## Contract Change Requests

None.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-163-office-seated-cast-tags-flows`:

- `pnpm --filter @ef-harness/renderer typecheck` — pass.
- `pnpm --filter @ef-harness/renderer lint` — pass.
- `pnpm --filter @ef-harness/renderer test -- office-cast` — pass (17 tests).
- `node scripts/verify-harmony.mjs --task 163` — pass (`harmony ok for Task-163`).

## Known Limitations / Follow-Ups

- Task 162 owns Pixi viewport + desk anchor coordinates; this task emits logical `roomId` + `deskIndex` only.
- Task 164 owns walk queues; overhead icons and tags update on frame 0 here (state-beats-motion for static seated v1).
- ACCEPTED/terminal tasks remain clickable via `OfficeInteractionController` but are not painted as active seated sprites.