---
task_id: "Task-123"
branch: "task/123-phase-presets-popout-windows"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - apps/renderer/src/presets/**
  - apps/renderer/tests/presets/**
  - apps/desktop/src/windows/**
  - apps/desktop/tests/windows/**
  - .agent-handoffs/task-123.md
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 123 handoff

Phase layout presets for Discover, Plan, Build, and Ship, the non-disruptive phase-switch banner, multi-monitor pop-out windows, and disconnected-monitor bounds recovery. Commit stays on `task/123-phase-presets-popout-windows`.

## Exports Provided

Do not import across `apps/renderer` and `apps/desktop`. Both sit on layer 5. Wire them through the ports below.

Renderer, from `apps/renderer/src/presets/index.ts`:

- `PhaseLayoutPresetManager` — `apply(phase, environment)` returns the exact rail, center, and inspector for `discover`, `plan`, `build`, and `ship`. `customize` stores a per-project, per-phase override. `setBuildTab(projectId, "office" | "board")` records `preferredBuildTab`. `llmCalls` is `0`.
- `NonDisruptivePhaseSwitchBanner` — `announce`, `accept`, `stay`, `handleKey`. Announce never changes the active tab, focus, or composer text. Copy is `Plan is ready to review → Switch to Plan`, `Build complete — Ready to Ship → Switch to Ship`, or `Switch to the ${Phase} layout?`. Stay label is `Stay here`. Placement is `top-of-center`, `blocking: false`.
- `PhaseWorkspaceController` — `open`, `type`, `inspect`, `backendTransition`, `acceptBanner`, `stay`, `pressKey`. Backend transitions leave the snapshot unchanged. Enter accepts only when the composer is blurred and the user is not inspecting. A switch click applies the target preset.
- `PhasePreferenceMemory` — `serialize` / `restore`. Automatic Board fallback is not stored. An explicit Office or Board choice survives a new session.
- Local ports, swapped at integration: `LocalDiscoverRail`, `LocalPlanPreviewCenter`, `LocalShellLayoutContext`, `defaultPresetPorts`.

Discover rail: expanded, wide, sections `chat`, `questions`, `stage-chip`, `honest-readiness-count`. Center `architecture-canvas`. Inspector collapsed until a `box` selection.

Plan rail: compact `chat`. Center `plan-preview` + `spec-tree` with `Planned Phase 0`, `Wave 1`, `Projected Waves 2+`, `Crew Preset`, `Chosen for you`, and prominent `Start build`. Inspector opens on a task or feature.

Build rail: `calm-inbox` + `chat` collapsed to recent messages. Center defaults to animated `office`. Quick toggles are `Board`, `Canvas` (`architecture-canvas`), and `Live Preview`. First build with `prefersReducedMotion` or governor `orange`/`red` uses `board` and does not persist that fallback. An explicit Office preference under those constraints uses `static-seated` Office. Inspector opens on a worker (`smooth`, or `instant` when reduced motion is on).

Ship rail: `checklist` + `approvals`. Center `landing-summary`, `pr-ci-loop`, `deploy-pipeline`. Inspector panels `diff`, `ci-logs`, `effect-receipts` open on a run.

Every preset keeps fixed regions `top-bar` and `composer`.

Desktop, from `apps/desktop/src/windows/index.ts`:

- `DisconnectedMonitorBoundsGuard` — `recover(saved, event)`. DIP bounds. A window must intersect a connected `workArea` by at least `120 × 80` (`MIN_VISIBLE_WIDTH` / `MIN_VISIBLE_HEIGHT`) and keep the top-bar Stop button inside that work area (`TOP_BAR_HEIGHT` 48, `STOP_BUTTON_WIDTH` 64, top-right of the window). Otherwise it recenters on the primary work area with `width <= workArea.width` and `height <= workArea.height`. `display-metrics-changed` slides instead of recentering when the window still overlaps a display but the Stop button is clipped. Helpers: `isTopBarStopVisible`, `stopButtonRect`, `intersectionSize`.
- `PopOutWindowCoordinator` — `popOut`, `dockBack`, `restore`, `onPrimaryWindowClose`, `restoreFromTray`, `setTheme`, `setFocusMode`, `routeCanvasEntity`, `centerWorkspaceTabs`, `daemonSnapshot`. Window ids are `popout:preview`, `popout:office`, `popout:board`, `popout:canvas`, `popout:inspector`. Cap is `MAX_POP_OUT_WINDOWS` (`3`). A second request for the same view calls `focus()` and does not create another window. Dock label is `Dock back into main window`. Closing a pop-out puts that tab back on `centerWorkspaceTabs`. Theme and focus mode update the main window and every pop-out in the same call.
- `SharedHarnessdStream` — the only daemon event log. Main and pop-outs subscribe; `daemonSnapshot().events` is that one array.
- `popOutWindowId`.
- Local ports, swapped at integration: `InMemoryScreenPort`, `InMemoryWindowFactory`, `InMemoryWindow`, `InMemoryMainShell`, `InMemoryTrayLifecycle`.

Closing the primary window while `shell.isBuilding()` is true calls `TrayLifecyclePort.minimizeToTray("building")` and hides the main window. Pop-outs stay open. Closing while idle destroys every pop-out and does not minimize to the tray. A canvas entity click sets the main composer target and inspector selection with `focusStolen: false` and does not focus the main window.

Startup `restore` and live `display-removed` / `display-metrics-changed` both go through the bounds guard before `setBounds`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `apps/renderer/src/index.ts` or `apps/desktop/src/index.ts` on this branch. Integration should add:

```ts
export {
  LocalDiscoverRail,
  LocalPlanPreviewCenter,
  LocalShellLayoutContext,
  NonDisruptivePhaseSwitchBanner,
  PhaseLayoutPresetManager,
  PhasePreferenceMemory,
  PhaseWorkspaceController,
  defaultPresetPorts,
} from "./presets/index.js";
export type {
  AppliedPhasePreset,
  BannerPresentation,
  BuildTabPreference,
  PhaseEnvironment,
  PhaseTransition,
  PresetPorts,
  ShellLayoutContextPort,
} from "./presets/index.js";
```

```ts
export {
  DisconnectedMonitorBoundsGuard,
  InMemoryMainShell,
  InMemoryScreenPort,
  InMemoryTrayLifecycle,
  InMemoryWindowFactory,
  PopOutWindowCoordinator,
  SharedHarnessdStream,
  popOutWindowId,
} from "./windows/index.js";
export type {
  ConnectedDisplay,
  MainShellPort,
  PopOutResult,
  PopOutView,
  SavedWindowPlacement,
  ScreenPort,
  TrayLifecyclePort,
} from "./windows/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or app `package.json` change.

Tab to pop-out id, wired by the shell (not imported across layer 5):

- `live-preview` → `popout:preview`
- `office` → `popout:office`
- `board` → `popout:board`
- `architecture-canvas` → `popout:canvas`
- worker inspector → `popout:inspector`

Swap the local ports when those siblings are on the integration branch:

- `LocalShellLayoutContext` → Task 122 `ShellLayoutContext` / `SingleAppShell`
- `LocalPlanPreviewCenter` → Task 108 `PlanPreviewBuilder` mounted in the plan-preview slot. This task only reserves the chrome (`Planned Phase 0`, `Wave 1`, `Projected Waves 2+`, crew preset, Chosen for you, Start build).
- `LocalDiscoverRail` → the shell's stage chip and honest readiness count
- `InMemoryScreenPort` and `InMemoryWindowFactory` → Task 067 Electron `screen` and `BrowserWindow`
- `InMemoryTrayLifecycle` → Task 131 tray minimize while a build is running
- `InMemoryMainShell.redock` / `routeEntity` → Task 122 center tabs, composer target, and inspector
- Office / Board / Canvas / Live Preview / Ship surfaces → Tasks 162, 124, 153, 160, 101, 178, and 179. Presets name the slots; they do not render those views.

## Dependency Intents (New Packages Requested)

None. Renderer and desktop foundation packages do not depend on React or Electron, and those `package.json` files stay frozen. The modules are plain TypeScript. Electron `screen` and `BrowserWindow` are consumed through `ScreenPort`, `WindowFactory`, and `ManagedWindow`.

## Contract Change Requests

None. No schema, shared-contract, or barrel change on this branch.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-123-phase-presets-popout-windows`.

- `pnpm --filter @ef-harness/renderer typecheck` — pass
- `pnpm --filter @ef-harness/renderer lint` — pass
- `pnpm --filter @ef-harness/renderer test -- presets` — pass, 2 files, 16 tests
- `pnpm --filter @ef-harness/desktop typecheck` — pass
- `pnpm --filter @ef-harness/desktop lint` — pass
- `pnpm --filter @ef-harness/desktop test -- windows` — pass, 2 files, 17 tests
- `node scripts/verify-harmony.mjs --task 123` — pass, `harmony ok for Task-123`

## Known Limitations / Follow-Ups

- Layout and windows are controller and port models. Task 122 still mounts them in the real shell. There is no React tree and no Electron process on this branch.
- `PlanPreviewBuilder` data, Office sprites, Board lanes, Architecture Canvas, Live Preview, and the Ship PR/CI/deploy views are slots. Sibling tasks render them.
- `preferredBuildTab` is only `office` or `board`. Choosing Canvas or Live Preview is a Build-phase center override and does not erase the last Office/Board choice.
- An automatic Board fallback (reduced motion, or governor orange/red, with no explicit choice) is recomputed on the next `apply`. It is not written into preference memory.
- Enter accepts the banner only when the user is outside the composer and not inspecting. The switch control accepts on click in every case. Announce itself never switches.
- While a build is running, closing the primary window trays that window and leaves pop-outs open. Idle close destroys pop-outs and does not re-dock them, because the app is quitting. Closing one pop-out while the main window stays up always re-docks that tab.
- Bounds math is DIP. The Stop button is the top-right 64 by 48 DIP of the window. A work area smaller than 120 by 80 cannot satisfy the on-screen invariant and throws `DisconnectedMonitorError`.
