---
task_id: "Task-131"
branch: "task/131-electron-desktop-lifecycle"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/desktop/src/lifecycle/**"
  - "apps/desktop/tests/lifecycle/**"
  - "apps/daemon/src/lifecycle/**"
  - "apps/daemon/tests/lifecycle/**"
  - ".agent-handoffs/task-131.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 131 handoff

Electron desktop lifecycle: tray while building, the 3-choice quit dialog, Windows power suspend/resume/lock/shutdown, opt-in power-save blocking, opt-in start-at-sign-in, single-instance focus, renderer reload, and the detached `harnessd` shutdown handshake. Commit stays on `task/131-electron-desktop-lifecycle`.

## Exports Provided

Desktop public entry: `apps/desktop/src/lifecycle/index.ts`.

- `SystemTrayController` — tray icon, green/amber/neutral badge, menu (`Open EF Harness`, live status, `Pause Build`, `Stop Build`, `Quit`), click/double-click restore, first-hide toast, finish and `P0` notifications.
- `QuitWhileBuildingDialog` — exact choices `Keep building in background (Minimize to tray)`, `Pause safely & Quit`, `Cancel (Stay open)`. Idle quit shows no dialog and finishes in under 1s. Background sync keeps `harnessd` up.
- `PowerMonitorSleepReconciler` — `suspend` pauses claiming, checkpoints, and stuck clocks; `resume` compensates sleep, calls `reconcileAfterWake()`, and holds Welcome-Back when sleep is over 30 minutes or the network/repo/provider/local environment is unhealthy. `shutdown` flushes checkpoints, `wal_checkpoint(PASSIVE)` then `wal_checkpoint(TRUNCATE)`, and terminates Job Object children. Lock, unlock, on-battery, and on-ac are forwarded, including the optional Eco-on-battery cap.
- `OptionalPowerSaveBlocker` — setting label `Prevent sleep during active build`. Off by default. Calls `powerSaveBlocker.start('prevent-app-suspension')` only while `state === 'BUILDING'` and releases on `DONE`, `PAUSED`, `STOPPED`, `WAITING_ON_USER`, opt-out, or battery below 20%.
- `StartAtSignInManager` — setting label `Start EF Harness when Windows signs in`. Off until `setEnabled(true)`, which calls `setLoginItemSettings({ openAtLogin, args: ['--hidden-tray'] })`.
- `SingleInstanceLock` plus `parseLaunchArgs` — `requestSingleInstanceLock()`. A second launch focuses the existing window and forwards `--project`, a positional path, and a deep link. The duplicate process exits. `--hidden-tray` starts the primary instance hidden.
- `RendererCrashRecovery` — `render-process-gone` and `unresponsive` offer `Reload UI`, leave `harnessd` alive, and resync `stream_epoch` with zero lost build progress in under 1s.
- `WindowClosePolicy` — the window X button, while a build is active, offers minimize-to-tray with `Don't ask again`. It does not abort the build. Idle X quits.
- `DesktopLifecycleCoordinator` — wires the pieces. `bindElectronLifecycleHost` adapts an injected Electron `app`, `powerMonitor`, `powerSaveBlocker`, `Tray`, and `BrowserWindow` without this package importing `electron`.
- `DaemonLifecycleClient` — `POST /lifecycle/shutdown` and `POST /lifecycle/power` over a `NamedPipeRequestPort`.

Daemon public entry: `apps/daemon/src/lifecycle/index.ts`.

- `DaemonShutdownCoordinator` — `drain_and_exit` versus `detach_ui_keep_running`. Drain budget is at most 10s (1s when `idle: true`), then SQLite `PASSIVE` + `TRUNCATE`, Job Object cleanup, and exit only when orphaned pids are 0. Detach leaves the build processes running.
- `LifecycleRouter` — `POST /lifecycle/shutdown` and `POST /lifecycle/power`. `LISTENS_ON_LOCALHOST` is false. No TCP listener.
- `PowerLifecycleHandler` — daemon-side suspend/resume/lock/battery/shutdown applied when the desktop notifies harnessd.
- `NodeSqliteCheckpoint` / `runWalCheckpoint` — real `node:sqlite` `PRAGMA wal_checkpoint`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit the frozen app barrels in this task. Integration should add:

- `apps/desktop/src/index.ts` re-exports `./lifecycle/index.ts` (at least `DesktopLifecycleCoordinator`, `bindElectronLifecycleHost`, `SystemTrayController`, `QuitWhileBuildingDialog`, `PowerMonitorSleepReconciler`, `OptionalPowerSaveBlocker`, `StartAtSignInManager`, `SingleInstanceLock`, `RendererCrashRecovery`, `DaemonLifecycleClient`).
- `apps/daemon/src/index.ts` re-exports `./lifecycle/index.ts` (at least `DaemonShutdownCoordinator`, `LifecycleRouter`, `PowerLifecycleHandler`).

Task 067 bootstrap (`apps/desktop/src/bootstrap/main.ts`) should construct `DesktopLifecycleCoordinator`, call `attach(bindElectronLifecycleHost(electron))`, route the window `close` event to `handleWindowClose` (minimize-to-tray), and route Alt+F4, File → Quit, and tray Quit through `requestQuit`. Electron's `close` event does not distinguish the X button from Alt+F4, so the accelerator must call `requestQuit('alt+f4')` directly. The shell (Task 122) renders `currentQuitPrompt()` / `currentClosePrompt()` and calls `resolveQuit`, `confirmMinimize`, `setKeepInTray`, `setPreventSleepDuringActiveBuild`, `setEcoOnBattery`, and `setStartAtSignIn`. No new root dependency is required: Electron is injected.

## Dependency Intents (New Packages Requested)

None. Do not add `electron` to either app `package.json`. The host is structural so this branch stays installable from the frozen lockfile.

## Contract Change Requests

None for `schema/` or `packages/shared-contracts`. The lifecycle HTTP-shaped messages are local to these two apps and should stay on the named pipe:

- `POST /lifecycle/shutdown` body `{ mode: 'drain_and_exit' | 'detach_ui_keep_running', reason: string, deadlineMs?: number, idle?: boolean }`.
- `POST /lifecycle/power` body is the `LifecyclePowerEvent` union (`suspend`, `resume`, `shutdown`, `on-battery`, `on-ac`, `lock-screen`, `unlock-screen`).

`state.db` stays owned by `harnessd`. The desktop process must not open it.

## Sibling ports to swap

These classes in `apps/desktop/src/lifecycle/local-ports.ts` and `apps/daemon/src/lifecycle/local-ports.ts` are the stand-ins. Replace the port, not the lifecycle policy:

| Port | Swap to | Used for |
| --- | --- | --- |
| `NamedPipeRequestPort` / `DaemonLifecycleClient` | Task 031 `NamedPipeClient` mounted on `LifecycleRouter` | Shutdown and power RPCs. No localhost listen. |
| Electron `attach` | Task 067 `apps/desktop/src/bootstrap/main.ts` | `requestSingleInstanceLock`, tray, `powerMonitor`, `before-quit`, `render-process-gone`. |
| `ImmediateKernelStopPort` | Task 114 `ImmediateKernelStopController.pauseSafely` / `stopNow` | Pause safely & Quit, tray Pause, tray Stop. `graceMs` is 10000 on quit. |
| `PopOutWindowPort` | Task 123 `PopOutWindowCoordinator` | `closeAll('primary-quit')` on idle/pause quit. `closeAll('keep-building')` when the quit choice destroys renderers. Window-X minimize leaves pop-outs open. |
| `ColdOpenReconcilerPort.reconcileAfterWake` | Task 130 `ColdOpenReconciler.reconcileAfterWake` | Resume. Bands are `under_10_min`, `between_10_and_30_min` (`<= 30 min`), and `over_30_min` (`> 30 min`). |
| `SleepSkewGuardPort` | Task 020 `SleepSkewGuard` | Resume must keep `spuriousLeaseExpiries` at 0. |
| `StuckClockPort` | Task 125 stuck-clock service | Suspend pauses timers. Resume must not add sleep duration. `LocalStuckClockGuard` is the stand-in. |
| `HardwareGovernorPort` | Task 118 hardware governor | `on-battery` / `on-ac`, optional `ecoCap: 'eco'`. |
| `EventStreamReconnectPort` | Task 032 `ClientStateSyncer` | Reload UI and tray restore. `lostEvents` must stay 0. |
| `WindowsJobObjectPort` | Task 041 `WindowsJobSupervisor` | `terminateJobObject` then verify zero orphaned pids before exit. |
| `SqliteCheckpointPort` | Daemon `state.db` via `NodeSqliteCheckpoint` | `PRAGMA wal_checkpoint(PASSIVE)` then `PRAGMA wal_checkpoint(TRUNCATE)`. |

Follow-up for the integrator: `PowerMonitorSleepReconciler` both calls its sqlite/checkpoint/job ports and sends `notifyPower({ type: 'shutdown' })`. `PowerLifecycleHandler` runs `DaemonShutdownCoordinator` again when that event arrives. Checkpointing twice is safe, but only the daemon should touch `state.db`. Wire the desktop ports as the named-pipe calls into `LifecycleRouter`, and do not also run a second in-process SQLite connection in Electron.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-131-electron-desktop-lifecycle`.

- `pnpm --filter @ef-harness/desktop test -- lifecycle` — pass, 6 files, 26 tests. Covers the 3 quit choices, idle quit with and without background sync, verification/merge-queue gating, 4-hour offline Welcome-Back (`Paused while laptop slept (4h) · Offline — Resume when back online`), 2-hour stuck-clock compensation, the 30-minute boundary, shutdown WAL order, power-save release, tray badges, window-X minimize with `Don't ask again`, single-instance focus, `--hidden-tray`, start-at-sign-in default off, and renderer reload with `harnessd` still alive.
- `pnpm --filter @ef-harness/daemon test -- lifecycle` — pass, 1 file, 7 tests. Covers drain within 10s, detach without killing children, idle quit under 1s, a real `node:sqlite` WAL checkpoint that leaves `stream_epoch` readable, sleep compensation, and `POST /lifecycle/shutdown` without a localhost listener.
- `pnpm --filter @ef-harness/desktop typecheck` — pass.
- `pnpm --filter @ef-harness/daemon typecheck` — pass.
- `pnpm --filter @ef-harness/desktop lint` — pass.
- `pnpm --filter @ef-harness/daemon lint` — pass.
- `node scripts/verify-harmony.mjs --task 131` — pass (`harmony ok for Task-131`).

## Known Limitations / Follow-Ups

- Settings and the quit dialog are main-process controllers. This task does not render them in `apps/renderer`. Task 122 should bind the labels exported here.
- Sibling implementations are not on this foundation base. The local ports above are the swap points.
- `powerMonitor` exists only in the Electron main process. `harnessd` learns about suspend, resume, lock, battery, and OS shutdown through `POST /lifecycle/power`.
- Start-at-sign-in reads the current login-item flag and does not force it off if the user already enabled it in a previous session.
- Welcome-Back copy for a healthy sleep just over 30 minutes rounds to the nearest minute (`Paused while laptop slept (30m) · Welcome back`). The 4-hour offline string is exact.
