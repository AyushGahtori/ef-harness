---
task_id: "Task-165"
branch: "task/165-office-accessibility-auto-fallback"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/renderer/src/office/a11y/**"
  - "apps/renderer/tests/office-a11y/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 165 handoff

`agent-worktree create` copies this file to `.agent-handoffs/task-NNN.md` and sets `status` to `in_progress`. Flip `status` back to `ready_for_integration` only after the verification section is filled in. Commit stays on `task/165-office-accessibility-auto-fallback`.

## Exports Provided

From `apps/renderer/src/office/a11y/index.ts`:

- `OfficeReducedMotionAdapter`, `OfficeReducedMotionSnapshot`
- `OrangePressureAutoBoardFallback`, `ORANGE_FALLBACK_BANNER`, `GREEN_RECOVERY_OFFER`, `OrangeFallbackSnapshot`
- `OfficeSemanticMirrorTree`, `MirrorFocusNode`, `MirrorKeyDecision`
- `HotDeskOverflowAggregator`, `hotDeskOverflowLabel`, `rankWorkersForBullpen`, `BULLPEN_VISIBLE_DESK_CAP`
- `OptionalSoftChimesController`, `ChimeSettings`, `ChimePlayback`
- `DebouncedAriaLive`
- `detectHighContrastMode`, `HighContrastGuidance`
- `toggleOfficeBoardView`, `OfficeBoardToggleResult`
- `reduceOfficeFocusTrap`, `FocusTrapDecision`
- `OfficeA11yCoordinator`, `OfficeA11yCoordinatorOptions`, `OfficeA11ySnapshot`
- Shared types and constants (`OFFICE_LOGICAL_TAB_ROOMS`, `OFFICE_ROOM_LABEL`, port interfaces)

## Shared Wiring Needs (Root / Index Barrels)

- `Task 123`: hook `OfficeReducedMotionAdapter.suggestedDefaultTab` into build-phase preset auto-fallback.
- `Task 118`: wire real `PressureMachinePort` into `OrangePressureAutoBoardFallback`.
- `Task 124` / shell: mount `OfficeA11yCoordinator` in center workspace and connect Pixi/camera/inspector ports.

## Dependency Intents (New Packages Requested)

None (uses existing workspace `axe-core` / `playwright` from monorepo devDependencies for tests).

## Contract Change Requests

None.

## Exact Verification Commands & Results

```
pnpm --filter @ef-harness/renderer typecheck  → pass
pnpm --filter @ef-harness/renderer lint        → pass
pnpm --filter @ef-harness/renderer test -- office-a11y → 6 files, 11 tests pass
node scripts/verify-harmony.mjs --task 165     → harmony ok for Task-165 (includes root typecheck, lint, test)
```

## Known Limitations / Follow-Ups

- Semantic mirror HTML is generated server-side for tests; production shell must attach keyboard handlers and re-render on roving focus.
- Orange manual override keeps static reduced-motion caps until pressure recovers (see `OrangePressureAutoBoardFallback`).