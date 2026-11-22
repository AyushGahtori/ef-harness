---
task_id: "Task-117"
branch: "task/117-governor-windows-telemetry"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/governor/src/telemetry/**"
  - "packages/governor/tests/telemetry/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 117 handoff

Windows resource telemetry collector for the hardware governor. Commit stays on `task/117-governor-windows-telemetry`.

Import from `packages/governor/src/telemetry/index.ts`. The package barrel is intentionally unchanged.

## Exports Provided

- `WindowsResourceTelemetryCollector` — adaptive `1s` / `5s` / `0 Hz` sampler. `sampleOnce`, `start`, `stop`, `setBuildActive`, `suspend`, `resume`, `retainedBytes`, `close`. Overlays `UiLatencyHeartbeatMonitor` and `MemoryNotificationWatcher`, flushes bounded metric rows, and fills Job Object gaps through `WindowsJobSupervisor.queryJobAccounting` when a named open fails.
- `openWindowsResourceTelemetryCollector` — connects the Win32 helper on Windows and otherwise uses the POSIX fallback.
- `ResourceTelemetryProvider` — `kind` plus `sample` / `close`.
- `Win32NativeTelemetryProvider` — production Windows provider. One warm helper request per sample. Per-metric failures become `metricUnavailable` and do not drop the other signals.
- `PosixFallbackTelemetryProvider` — `os` memory and `fs.statfs` for both volumes. Commit charge, the low-memory notification, DXGI, Defender, and Job Objects are marked unavailable.
- `SyntheticTelemetryProvider` — deterministic frames. `scenario` / `playlist` cover `low-memory`, `commit-exhaustion`, `split-drive`, and `defender-contention`.
- `HardwareSnapshotSchema` — `parse` / `safeParse` for `ef.governor.hardware_snapshot.v1`.
- `MemoryNotificationWatcher` and `ManualLowMemorySource` — instant low-memory signal. The Win32 helper also emits `low-memory` when `QueryMemoryResourceNotification` changes.
- `UiLatencyHeartbeatMonitor` — `1 Hz` input-to-paint heartbeats. Foreground interacting samples above `50 ms` raise pressure after the sustain count (default 2). `documentHidden` frames are ignored, including a `1000 ms` background `rAF`.
- `MemoryTelemetryDbRepo` — bounded stand-in for Task 014 until the real database is wired. Cap is 2000 rows.
- `PollSubprocessGuard` — sample ticks cannot spawn `powershell.exe`, `cmd.exe`, or `wmic.exe`.
- Snapshot builders and constants: `memorySample`, `diskSample`, `defenderSample`, `gpuFallback`, `ACTIVE_POLL_MS` (1000), `IDLE_POLL_MS` (5000), `MAX_SAMPLE_MS` (5), `MAX_COLLECTOR_RAM_BYTES` (15 MB), `DEFENDER_CONTENTION_CPU_PERCENT` (25), disk floors `15 / 5 / 2 GB`, commit floor `1 GB` or `95%` used.

`HardwareSnapshot` carries physical bytes (`ullTotalPhys` / `ullAvailPhys`), commit bytes (`ullTotalPageFile` / `ullAvailPageFile`), `lowMemoryNotification`, per-job `peakJobMemoryUsedBytes`, `currentWorkingSetBytes`, `totalUserTimeMs`, `totalKernelTimeMs`, and `activeProcessCount`, GPU budget/usage or `{ gpuAvailable: false, sharedVramBudgetBytes }`, workspace and AppData volumes plus disk queue length and busy percent, and Defender `MsMpEng.exe` CPU with `settingsMutated: false`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/governor/src/index.ts` and `packages/governor/package.json` are frozen. Integration should re-export the telemetry barrel.

In `packages/governor/package.json` `exports`:

```json
"./telemetry": {
  "types": "./dist/telemetry/index.d.ts",
  "import": "./dist/telemetry/index.js"
}
```

In `packages/governor/src/index.ts`:

```ts
export {
  HardwareSnapshotSchema,
  MemoryNotificationWatcher,
  MemoryTelemetryDbRepo,
  PosixFallbackTelemetryProvider,
  SyntheticTelemetryProvider,
  UiLatencyHeartbeatMonitor,
  Win32NativeTelemetryProvider,
  WindowsResourceTelemetryCollector,
  defaultAppDataPath,
  openWindowsResourceTelemetryCollector,
} from "./telemetry/index.js";
export type {
  ActiveJobSlot,
  HardwareSnapshot,
  ResourceTelemetryProvider,
  TelemetryDbRepo,
  WindowsJobSupervisor,
  WindowsResourceTelemetryCollectorOptions,
} from "./telemetry/index.js";
```

## Dependency Intents (New Packages Requested)

None. The Windows provider shells out only once, at startup, to `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` to compile `win32-helper.cs` into a cached helper under `%TEMP%`. Sample ticks talk to that already-running process over stdin/stdout. No package is added.

An in-process N-API addon can replace `Win32HelperClient` later without changing `ResourceTelemetryProvider`. That addon is optional, not required to build this task.

## Contract Change Requests

None. Sibling branches are not merged. Local ports stand in for them:

- `TelemetryDbRepo.enqueue` / `flush` matches Task 014 `TelemetryDb` (`attempt`, `ts`, `kind`, `data` → `{ accepted, dropped }`). `kind` for these rows is `metric`. Pass the real `TelemetryDb` when it is on the branch. `attempt` is always present here (`string | null`); Task 014 also accepts it omitted.
- `WindowsJobSupervisor.listActiveJobs` returns `{ id, name, role }`. `name` must be the Win32 Job Object name from Task 040 `WindowsJobManager` so this collector can `OpenJobObject` and `QueryInformationJobObject` (`JobObjectExtendedLimitInformation`, `JobObjectBasicAccountingInformation`, working set). Task 041 exposes `WindowsJobManagerPort` (`createJob`, `assignProcess`, `queryJobAccounting`, `terminateJob`) and does not list names. If the name cannot be opened, the collector calls optional `queryJobAccounting` and keeps the rest of the snapshot.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-117-governor-windows-telemetry`.

- `pnpm --filter @ef-harness/governor typecheck` — pass.
- `pnpm --filter @ef-harness/governor lint` — pass.
- `pnpm --filter @ef-harness/governor test -- telemetry` — pass, 4 files, 18 tests. Live Windows sample matched `os.totalmem()`, read both volumes against `statfs`, queried a real Job Object (`activeProcessCount` and `peakJobMemoryUsedBytes` > 0), returned a DXGI result without throwing (`gpuAvailable` or `sharedVramBudgetBytes`), kept Defender `settingsMutated` false, and stayed under `5 ms` with `sampleProcessStarts` unchanged.
- `node scripts/verify-harmony.mjs --task 117` — pass (`harmony ok for Task-117`). This also runs repository `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- This worktree was created from `649773097c387ae534b686ea5825f449f843aa7c`. `harness/integration` at `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` fails `pnpm install --frozen-lockfile` because `packages/shared-contracts/package.json` adds `zod` without a lockfile update.
- PDH disk queue, disk busy percent, and `MsMpEng` CPU are refreshed about once a second on a helper background thread. A sample reads the latest cached counters so the tick itself stays under `5 ms` and does not spawn a process.
- Integrated or missing GPUs return `gpuAvailable: false` and `sharedVramBudgetBytes`. Discrete adapters use `IDXGIAdapter3::QueryVideoMemoryInfo`.
- The collector does not open `telemetry.db` itself. Wire Task 014 `TelemetryDb` through `TelemetryDbRepo`.
- Job accounting for unnamed jobs needs the `queryJobAccounting` fallback. Named jobs are queried here.
- Defender observation is read-only. The exclusion tip is text only.
