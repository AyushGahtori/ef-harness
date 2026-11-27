# Pass 05 — Chunk 001 Audit Report (`apps/renderer` Shell, Phase Presets, `apps/desktop` Pop-Out Windows, 7-Lane Board Cockpit & Health Signals — `Tasks 122–125`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-05`
- **Chunk:** `chunk-001`
- **Units Audited (4):**
  - `Task 122` (`task/122-single-app-shell-framework` @ `2c6aeff`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-122-single-app-shell-framework`, unmerged, clean)
  - `Task 123` (`task/123-phase-presets-popout-windows` @ `7a522a6`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-123-phase-presets-popout-windows`, unmerged, clean)
  - `Task 124` (`task/124-board-cockpit-seven-lanes` @ `3bb233b`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-124-board-cockpit-seven-lanes`, unmerged, clean)
  - `Task 125` (`task/125-board-health-signals-explainer` @ `20d6ff1`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-125-board-health-signals-explainer`, unmerged, clean)
- **Governing Architecture Documents:** `app-shell-and-governor.md`, `desktop-app.md`, `build-cockpit.md`, `execution-capacity.md`, `prompt-contracts.md`, `kernel-schema-and-protocol.md`, `schema/state.sql`, `schema/telemetry.sql`, `desktop-app.mmd`, `cockpit-and-office.mmd`.

## 2. Files Directly Inspected
- `schema/state.sql` (`195–320`)
- `apps/renderer/{package.json,src/index.ts}` (`task-122`)
- `apps/renderer/src/shell/{shell.ts,ports.ts,daemon-store.ts}` (`Task 122`)
- `apps/renderer/src/presets/phase-workspace-controller.ts` + `apps/desktop/src/windows/{pop-out-window-coordinator.ts,shared-harnessd-stream.ts,electron-ports.ts}` (`Task 123`)
- `apps/renderer/src/cockpit/board/{map-task-to-board-lane.ts,state-db-adapter.ts,daemon-store-port.ts}` (`Task 124`)
- `apps/renderer/src/cockpit/health/{explainer.ts,board-slot.ts,telemetry-log.ts}` (`Task 125`)

## 3. Verified Local Strengths
- `SingleAppShell` (`122`) enforces the 4-zone spatial layout (48px fixed Top Bar with permanent `Stop` control, resizable Left Rail & Right Inspector clamped so Center Workspace stays `>= 420 px`, `16 ms` rAF event batching, `stream_epoch` snapshot resync, WCAG AA light/dark tokens, and `UiLatencyHeartbeatMonitor` skipping hidden documents).
- `PhaseLayoutPresetManager`, `NonDisruptivePhaseSwitchBanner`, `PopOutWindowCoordinator`, and `DisconnectedMonitorBoundsGuard` (`123`) enforce non-focus-stealing phase banners, `<= 3` singleton pop-out windows with automatic close re-docking, and `>= 120 × 80 px` connected `workArea` intersection recovery across monitor unplug and DPI changes.
- `BoardCockpitView`, `mapTaskToBoardLane`, `DeterministicStatusLineFormatter`, `FeatureSwimlaneGrouper`, and `VirtualizedLaneColumn` (`124`) map canonical `schema/state.sql` `task_states` to the exact 7 lanes (`Queued`, `Working`, `Waiting on You`, `Held`, `Verifying`, `Integrating`, `Done`), render zero-LLM status lines, and virtualize 500 tasks in `< 10 ms`.
- `BoardHealthSignalEngine` and `OnDemandCockpitExplainer` (`125`) detect all 5 health signals (`5-min` stuck clock, `3×` loop, `429` countdown, allowance reset, escalation/retry), suppress false stuck alarms during Pool-2/Inbox/hold/backoff waits, cache explanations by `(taskId, lastEventSeq)`, and fall back deterministically when offline.

## 4. Local Implementation Defects Discovered
1. **Undeclared `react` & `react-dom` Dependencies in `apps/renderer/package.json` (`Task 122` `shell.ts:1-2` vs `apps/renderer/package.json:20-28` — `F-063`):** `shell.ts` imports `"react"` and `"react-dom/server"`, which are completely absent from `apps/renderer/package.json` (`dependencies` lists only `@ef-harness/shared-contracts`).
2. **`SharedHarnessdStream.publish` Throws on Daemon Restart / Epoch Reset (`Task 123` `apps/desktop/src/windows/shared-harnessd-stream.ts:18-23` — `F-063`):** `if (event.seq <= last) throw new Error(...)` has no `streamEpoch` tracking and stores an unbounded `events[]` array in memory, crashing multi-window routing whenever `harnessd` restarts with a new `stream_epoch` (`seq = 1`).

## 5. Cross-Unit Contract & Seam Mismatches
1. **Renderer/Desktop IPC & Governor Casing Mismatches (`122` & `123` vs `009`, `032`, `067`, `118` — `F-063`):**
   - `122` (`shell/ports.ts:10-36`) invents `BridgePayload` (`kind: "events.subscribe" | "snapshot.get" | "rpc"` with `method: "build.stop" | "build.pause" | "build.resume"`, no `op_id`) and expects a `NamedPipeClient` inside `apps/renderer`, whereas `009`/`032`/`067` use `MessagePort` preload bridges carrying `run.stop` / `run.pause` / `run.resume` (with `op_id`), `project.open`, and `stream.credit`.
   - `122` (`shell/daemon-store.ts:56-64`) checks lowercase `"green" | "yellow" | "orange" | "red"`, silently dropping uppercase `"GREEN" | "YELLOW" | "ORANGE" | "RED"` emitted by `118` `PressureHysteresisStateMachine` (`F-055`).
   - `123` `PhaseWorkspaceController` (`presets/phase-workspace-controller.ts:57,153`) calls `shell.applyPreset(...)`, which does not exist on `122` `ShellLayoutContext`, and `123` `PopOutWindowCoordinator` is unwired from `067` `apps/desktop` (`F-027` single-port bug).
2. **`122` `DaemonStore` ↔ `124` `BoardCockpitView` ↔ `125` `BoardHealthSignalEngine` & `009` `CockpitExplainerOutputSchema` (`F-064`):**
   - `122` `DaemonStore` stores `WorkerView[]` (`{ id, status, detail, updatedSeq }`), while `124` `BoardCockpitView` requires `DaemonStoreSnapshot = { revision, tasks: BoardTaskRecord[], capacity: ThreePoolCapacitySnapshot }` (`StateDbBoardRow`, never emitted by `apps/daemon` `066`).
   - `125` defines a local class `CockpitExplainerV1Schema` instead of `@ef-harness/shared-contracts` `CockpitExplainerOutputSchema` (`009`), leaves `attachHealthSlots` unwired from `124` `BoardCockpitView`, and logs health metrics only to `InMemoryTelemetryLog` instead of forwarding to `harnessd` `telemetry.db`.

## 6. Shared-File & Ownership Conflicts
- `apps/renderer/src/index.ts`, `apps/renderer/package.json`, `apps/desktop/src/index.ts`, and `apps/desktop/src/main.ts` (`067`) must be unified across `122`–`128`, `131`–`133`, `141`, and `153`–`165`.

## 7. Runtime Wiring Gaps
- Add `react`, `react-dom`, `@types/react`, `@types/react-dom` to `apps/renderer/package.json`; wire `067` `apps/desktop` multi-window `MessagePort` fan-out (`F-027`) + `123` `PopOutWindowCoordinator` + `DisconnectedMonitorBoundsGuard`; add `StateDbBoardRow` + `ThreePoolCapacitySnapshot` projection to `apps/daemon` (`066`) and `122` `DaemonStore`; and mount `123` presets, `124` Board, and `125` Health Signals inside `122` `SingleAppShell`.

## 8. Architecture & Security Violations
- None (`122`–`125` cleanly respect Electron renderer `contextIsolation` with zero `node:sqlite` or raw Node FS imports, unlike `141` `F-058`).

## 9. Test Coverage & Verification Gaps
- Unit tests in `122`–`125` test against `MemoryNamedPipeClient`, `InMemoryWindowFactory`, `InMemoryDaemonStore`, and `FakeModelAdapter` without exercising `067` preload IPC or `122`→`124`→`125` composition.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-063` (`HIGH`):** `SingleAppShell` (`122`) & `PopOutWindowCoordinator` (`123`) Undeclared `react`/`react-dom` Dependencies, Incompatible `BridgePayload` vs `009`/`032`/`067` IPC Protocol, Governor Casing Drop, `SharedHarnessdStream` Epoch-Reset Crash & `applyPreset` Mismatch.
- **`F-064` (`HIGH`):** `BoardCockpitView` (`124`) & `BoardHealthSignalEngine` (`125`) Disconnected `DaemonStore` Snapshot Shapes, Missing `StateDbBoardRow` Daemon Projection, Duplicate `CockpitExplainerV1Schema` & In-Memory Telemetry Sink.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`122, 123, 124, 125`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and `schema/state.sql`.
- [x] Cross-checked against `009`, `032`, `066`, `067`, `114`, `118`, `119`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-063`–`F-064`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-05/chunk-002`: `Tasks 126–128, 131–133` (`apps/renderer` Worker Inspector `126`, Calm Inbox `127`, Budget Wind-Down & Stop Card `128`, plus `apps/desktop` & `apps/daemon` lifecycle/tray/power `131`, component downloader/updater `132`, diagnostics & redacted bundle exporter `133`).
