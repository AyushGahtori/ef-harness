---
task_id: "Task-122"
branch: "task/122-single-app-shell-framework"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/renderer/src/shell/**"
  - "apps/renderer/tests/shell/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 122 handoff

Single app shell on `task/122-single-app-shell-framework`. The four zones stay mounted across Discover, Plan, Build, and Ship. Sibling branches are not in this base; their contracts are local ports below.

## Exports Provided

Import from `apps/renderer/src/shell/index.ts` (not re-exported from the package barrel in this commit):

- `SingleAppShell`, `SingleAppShellView`, `createConnectedShell`
- `ShellLayoutContext`
- `DaemonStore`, `DaemonStoreProvider`, `createDaemonSnapshot`
- `FixedTopBar`, `CollapsibleLeftRail`, `CenterWorkspaceTabs`, `CollapsibleInspectorShell`
- `ShellKeyboardShortcuts`, `commandForKey`
- `UiLatencyHeartbeatMonitor`, `createHostClock`, `ManualClock`
- Slot types: `ShellSlotRegistry`, `CenterTabSlot`, `InspectorSlot`, `LeftRailInboxSlot`, `PhasePresetSlot`, `PhaseLayoutHints`
- Security: `ELECTRON_RENDERER_SECURITY`, `securityPolicyFindings`, `sourceSecurityFindings`
- Layout: `resolveLayout`, `layoutHoldsCenter`, pane constants (`TOP_BAR_HEIGHT_PX` 48, left 300-420, inspector 340-480, center minimum 420)
- Accessibility: `auditShellHtml` (axe-core rule catalog)

Slot registry on `SingleAppShell.registerSlots`:

- `center.office` Task 162, `center.board` Task 124, `center.canvas` Task 153, `center.spec-plan` Task 159, `center.preview` Task 160, `center.ship` Task 178, `center.diagnostics` Task 133
- `inspector.worker` Task 126, `inspector.canvas-node` Task 154, `inspector.chosen-for-you` and `inspector.diff` for Chosen-For-You / diff inspection
- `inbox` Task 127 (`LeftRailInboxSlot`). The shell keeps the filter chrome (`All`, `Needs You (N)`, `Chat`) and the unread badge. Unread ignores `fyi`.
- `phasePreset` Task 123. `phaseHints()` returns hints only. The shell does not apply them, so a phase change never yanks the center tab or the composer.

`ShellLayoutContext` exposes phase, center tab, focus mode, composer draft, connection, and resolved pane flags. `DaemonStoreProvider` exposes `getSnapshot` / `subscribe` over the gap-free store.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `apps/renderer/src/index.ts` in this task. Integration should add a barrel re-export of the shell public API from `./shell/index.js`:

- Values: `SingleAppShell`, `SingleAppShellView`, `ShellLayoutContext`, `DaemonStoreProvider`, `FixedTopBar`, `CollapsibleLeftRail`, `CenterWorkspaceTabs`, `CollapsibleInspectorShell`, `ShellKeyboardShortcuts`, `createHostClock`, `ELECTRON_RENDERER_SECURITY`
- Types: `ShellSlotRegistry`, `CenterTabSlot`, `InspectorSlot`, `LeftRailInboxSlot`, `PhasePresetSlot`, `ShellViewModel`, `DaemonSnapshot`

`ShellLayoutContext` is a class. Export the class value and let callers use `InstanceType<typeof ShellLayoutContext>` if a separate type alias would collide.

No `packages/*/src/index.ts` barrel changes. The renderer must not import sibling packages until those barrels exist.

Host wiring for a real window:

- Pass `createHostClock` around the browser `requestAnimationFrame` and `document.hidden`.
- Persist `ShellPanePreferences` through `ShellPreferenceStore` (Electron store / `global.db`, keyed by `windowId`). The shell writes requested widths and user-collapsed flags, theme, and focus mode. Force-collapse and overlay are derived and are not stored. Composer drafts stay in session memory.
- Forward `UiLatencyHeartbeatMonitor` samples to Task 117 through `HardwareGovernorLatencySink.ingestUiLatency` (p95, 1 Hz, skipped while `document.hidden`).

## Dependency Intents (New Packages Requested)

`apps/renderer/package.json` is frozen. These packages already exist as root devDependencies and resolve by walking up `node_modules`; declare them on `@ef-harness/renderer` at integration so the package does not rely on that walk:

- `react` and `react-dom` (views are `createElement` calls; markup is `renderToStaticMarkup`)
- `axe-core` (rule catalog for `auditShellHtml`)

Requested when the frozen `apps/renderer/vitest.config.ts` and `apps/renderer/tsconfig.json` can change:

- `jsdom` (or `happy-dom`)
- `@testing-library/react` and `@testing-library/user-event`

No new runtime package is required for the shell to typecheck or test on this base. Do not edit `package.json`, `pnpm-lock.yaml`, or `tsconfig`.

## Contract Change Requests

None for `schema/` or `packages/shared-contracts`.

Local ports to swap when sibling branches land:

- `NamedPipeClient` and `EventStreamSubscriber` swap to Task 032 `packages/ipc` client sync (`ClientStateSyncer` / event subscribe). Gap rule is `seq === lastApplied + 1`. Duplicate seq is ignored. A gap or new `streamEpoch` sets reconnecting and sends `snapshot.get`. Live events are held until the snapshot.
- `PreloadBridge` and `PreloadNamedPipeClient` swap to the Task 067 preload `MessagePort`. Renderer messages are structured clones on the bridge. No raw ipc renderer, no `node:fs`, `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, CSP `default-src 'self'`.
- `ImmediateKernelStopController` swaps to Task 114. `BridgeKernelStopController` posts `build.stop` / `build.pause` / `build.resume`. Stop keeps checkpoints (`preservedCheckpoints`, `destructive: false`) and returns in the same turn. Resume is the top-bar Resume control.
- `PressureHysteresisStateMachine` swaps to Task 118. The shell reads `snapshot()` and `subscribe`. It does not reimplement the 10s/30s hysteresis.
- `HardwareGovernorLatencySink` swaps to Task 117. 1 Hz p95 heartbeat.
- `ShellPreferenceStore` swaps to Electron store / `global.db`. See `ShellPanePreferences`.

Center tab ids: `office`, `board`, `canvas`, `spec-plan`, `preview`, `ship`, `diagnostics`. All seven panels stay mounted (`data-mounted="true"`).

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-122-single-app-shell-framework`:

- `pnpm --filter @ef-harness/renderer typecheck` — exit 0 (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/renderer lint` — exit 0 (`eslint .`).
- `pnpm --filter @ef-harness/renderer test -- shell` — exit 0. Vitest v5.1.1: 2 files, 20 tests passed (`tests/shell/single-app-shell.test.ts`, `tests/shell/security.test.ts`).
- Covered by those tests: 4-zone layout, 48px top bar, fixed Stop, governor pill, `$1.42 / $10` and `14% of 5h window` breakdown, light/dark/system theme, pane clamp at 1024x768 and overlay at 700px, width persistence, scroll/filter/scratch/composer retention, 200-event / 50-worker single-frame batch (`commitCount === 1`, input-to-paint 15ms, flush work under 16ms, 0 dropped), `stream_epoch` resync and disconnect banner without losing the draft, Stop on every phase and center tab under 100ms with checkpoints preserved, Resume, Ctrl+Shift+Backspace confirmation, Ctrl+1..4 / Ctrl+B / Ctrl+I / Ctrl+. / Esc / arrow tabs / Ctrl+Space, axe-core serious/critical count 0 in light and dark, heartbeat silence while hidden, CSP and source scan.
- `node scripts/verify-harmony.mjs --task 122` — exit 0. Output: `harmony ok for Task-122`.

## Known Limitations / Follow-Ups

- Frozen `vitest.config.ts` uses `environment: "node"` and `tsconfig` includes only `src/**/*.ts` with no `jsx` option. Views are React `createElement` components rendered with `react-dom/server`. `auditShellHtml` loads axe-core's real rule catalog and checks the shell fragment (button name, contrast, landmarks, duplicate ids, nested interactive, aria values, scroll focus, labels). It does not call `axe.run(document)`. `document-title` and `html-has-lang` belong to the Electron document from Task 067, not this fragment. Swap to `axe.run` plus Testing Library after jsdom is declared and the vitest environment can change.
- Simulated frames advance 15ms (`SIMULATED_FRAME_MS`) so input-to-paint stays under the 16ms ceiling. Production should pass `createHostClock` around `requestAnimationFrame`. One store notification, and one React `renderToStaticMarkup`, runs per frame.
- Composer draft, rail scroll, inbox filter, and per-tab scratch are session state. They survive tab switches, collapse, and snapshot replace. They are not written to `ShellPreferenceStore`.
- Task 123 phase presets are not applied automatically.
- Stop click is immediate. Ctrl+Shift+Backspace opens a confirmation, then the same non-destructive stop. Both require a live connection and `run === "running"`. While reconnecting, Stop, Pause, Resume, and Send stay visible and disabled; the message field still accepts draft text.
- `MemoryNamedPipeClient` does not open a Windows pipe. `MemoryPressureHysteresis` does not implement Task 118 timers.
