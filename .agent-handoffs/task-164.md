---
task_id: "Task-164"
branch: "task/164-office-animation-director-v2"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/renderer/src/office/director/**"
  - "apps/renderer/tests/office-director/**"
  - ".agent-handoffs/task-164.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 164 handoff

Truthful Office Animation Director v2: per-character bounded queues, burst collapse, state-beats-motion, lag teleport, dwell smoothing, A* pathfinding, frame budget monitor, parcel courier polish, and deterministic virtual-clock stress tests.

## Exports Provided

From `apps/renderer/src/office/director/index.ts`:

- `TruthfulAnimationDirector` — animation director port with truthful motion laws
- `AStarTilePathfinder` — tile-grid A* with room path cache and snap fallback
- `BurstCollapseEventQueue` — per-agent burst collapse queue (`maxQueueLen = 2`)
- `OfficeFrameBudgetMonitor` — 60fps active / idle throttle / hidden zero-tick budget
- `ParcelCourierAnimator` — cosmetic parcel/paper corridor micro-animations
- `DIRECTOR_LIMITS`, `OFFICE_ROOM_IDS` — shared constants
- Types: `CastProjection`, `CharacterMotionSnapshot`, `DirectorTelemetry`, `AnimationDirectorPort`, etc.
- Test helpers: `InMemoryOfficeCastProjector`, `LocalWalkableGridPort`, `createSyntheticOfficeWalkableGrid`

## Shared Wiring Needs (Root / Index Barrels)

None — subtree is self-contained under `apps/renderer/src/office/director/**` until Task 162/163 integration wires cast/grid from renderer bootstrap.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None.

## Exact Verification Commands & Results

| Command | Result |
|---------|--------|
| `pnpm --filter @ef-harness/renderer test -- office-director` | PASS (7 tests) |
| `pnpm --filter @ef-harness/renderer typecheck` | PASS |
| `pnpm --filter @ef-harness/renderer lint` | PASS |
| `node scripts/verify-harmony.mjs --task 164` | PASS (with handoff ready) |

## Known Limitations / Follow-Ups

- `InMemoryOfficeCastProjector` / `LocalWalkableGridPort` are director-local stand-ins until Task 162 `TiledFloorPlanLoader` and Task 163 `OfficeCastProjector` land; director consumes those ports via injectable options.
- Synthetic walkable grid is a deterministic Task 162 stand-in for unit tests, not the production floorplan asset.