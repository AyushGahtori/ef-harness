---
task_id: "Task-133"
branch: "task/133-diagnostics-health-bundle-exporter"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/daemon/src/diagnostics/**"
  - "apps/daemon/tests/diagnostics/**"
  - "apps/renderer/src/diagnostics/**"
  - "apps/renderer/tests/diagnostics/**"
  - ".agent-handoffs/task-133.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 133 handoff

Diagnostics metrics, local crash-dump retention, the previewable redacted support bundle, telemetry pruning, self-check, and the Diagnostics Health view are implemented on this branch. Sibling tasks are not in the foundation base, so their contracts are local ports. Swap those ports at integration time. Do not merge this branch.

## Exports Provided

Daemon (`apps/daemon/src/diagnostics/index.ts`):

- `DiagnosticsMetricsAggregator` reads `telemetry.db` plus the live ring buffer and returns a 24 hour `DiagnosticsSnapshot` (SQLite file/WAL sizes, schema versions, `PRAGMA quick_check`, write `p50`/`p95`/`p99` against the 50 ms SLO, busy retries, RAM/commit/disk/AV/UI sparklines, pressure history, pool 1/2/3 utilization, learned footprints, provider latency/`429`/AIMD, worker pass/retry/stuck/loop, conformance, CAS bytes, archived zstd bytes, active worktrees, last verified backup).
- `TelemetryRetentionSweeper` deletes 1 Hz hardware samples (`hw_1hz`, `hw_minute`) and other high-frequency rows older than 7 days, folds them into lightweight `hw_daily` / `sqlite_daily` rows, and deletes daily aggregates older than 90 days. It then `VACUUM`s.
- `CrashDumpIndexer` and frozen `LOCAL_CRASH_REPORTER` (`uploadToServer: false`, no submit URL). `index()` keeps at most 10 dumps and at most 50 MB across the Electron minidump directory and the daemon crash-log directory.
- `RedactedDiagnosticsBundleExporter`, `stageBundleEntries`, `assertBundleEntryName`, `BUNDLE_FILE_ORDER`.
- `DiagnosticsSelfCheck` and `classifyDiskHeadroom` (15 GB / 5 GB / 2 GB).
- `buildRedactedSummaryMarkdown`, `copyRedactedSummary`.
- `runSafeCacheCleanup` (calls the Task 028 pin-safe GC port and returns `reclaimedBytes` / `pinnedKept`).
- `rebuildTelemetryDatabase` recreates only `telemetry.db` (and its `-wal` / `-shm`).
- `LocalPacketSecurityRedactor`, `scrubDiagnosticsText`, `ArrayLogReader`.
- `readStoredZip` / `writeStoredZip` (stored-method ZIP, CRC checked).

Renderer (`apps/renderer/src/diagnostics/index.ts`):

- `DiagnosticsHealthView` and `renderHealthDocument(model, "light" | "dark")`.
- The view renders SVG sparklines with visible numeric min/max/latest text, `tabular-nums` tables, Run Self-Check, Run safe cache cleanup, Export Diagnostics Bundle, the unchecked-by-default sanitized-graph checkbox, per-file read-only preview, Save .zip, Copy Redacted Summary for GitHub Issue, and Rebuild Telemetry DB.
- When telemetry cannot be read, the view shows the exact string `telemetry.db unavailable — click Rebuild Telemetry DB`.

Telemetry kinds written and read in `telemetry.db` (`schema/telemetry.sql` table, not a schema edit): `hw_1hz`, `hw_minute`, `sqlite_write`, `provider`, `worker`, `conformance`, `storage`, `backup`, `hw_daily`, `sqlite_daily`.

Bundle allowlist, in order: `system-summary.json`, `metrics-24h.json`, `governor-timeline.json`, `daemon-logs-redacted.txt` (last 2,000 lines), `schema-health.json`, and `graph-structure.json` only when `includeSanitizedGraph` is true. Graph JSON keeps `nodeCount`, `id`, and `state` only. Preview bytes are the UTF-8 bytes written into the ZIP.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit the frozen barrels in this task. Integration should add:

`apps/daemon/src/index.ts`

```ts
export {
  ArrayLogReader,
  CrashDumpIndexer,
  DiagnosticsMetricsAggregator,
  DiagnosticsSelfCheck,
  LOCAL_CRASH_REPORTER,
  LocalPacketSecurityRedactor,
  RedactedDiagnosticsBundleExporter,
  TelemetryRetentionSweeper,
  buildRedactedSummaryMarkdown,
  copyRedactedSummary,
  rebuildTelemetryDatabase,
  runSafeCacheCleanup,
} from "./diagnostics/index.js";
```

`apps/renderer/src/index.ts`

```ts
export { DiagnosticsHealthView, renderHealthDocument } from "./diagnostics/index.js";
export type { DiagnosticsHealthActions, DiagnosticsHealthModel, DiagnosticsTheme } from "./diagnostics/index.js";
```

Mount `DiagnosticsHealthView` in the Diagnostics workspace tab (Task 122). The shell owns the action callbacks:

- `runSelfCheck` -> `DiagnosticsSelfCheck.run()`
- `exportBundle` -> `RedactedDiagnosticsBundleExporter.createPreview()`
- `saveZip` -> `preview` then `saveZip()` to the user-chosen local path
- `runSafeCacheCleanup` -> `runSafeCacheCleanup(pinSafeGc)`
- `copySummary` -> `copyRedactedSummary(buildRedactedSummaryMarkdown(...), clipboard)`
- `rebuildTelemetry` -> `rebuildTelemetryDatabase(telemetryPath)`
- `setIncludeSanitizedGraph` -> request flag, default false

Map `DiagnosticsSnapshot` into `DiagnosticsHealthModel` in the shell. The renderer cannot import the daemon: both are layer 5. Field names match on purpose.

No root `package.json`, lockfile, workspace, tsconfig, eslint, or package `package.json` edits.

## Dependency Intents (New Packages Requested)

None. SQLite uses `node:sqlite`. ZIP and CRC use `node:zlib` / `node:fs`. The renderer axe test loads the existing root devDependency `axe-core` by file path because `apps/renderer/package.json` is frozen and cannot gain a dependency.

## Contract Change Requests

None. The local ports below are the integration seam.

Swap these ports when the sibling branches land:

| Port in this task | Replace with |
| --- | --- |
| `PacketSecurityRedactorPort` / `LocalPacketSecurityRedactor` | Task 011 `SecretRedactor` (`PacketSecurityRedactor`). Pass it as `request.redactor` and as the summary `scrub` function. This task still runs the second PII pass (Windows user paths, repo folder names, emails, hostnames) and the post-redaction canary assertion. |
| `telemetry.db` path + kinds above | Task 014 `TelemetryDbRepo`. The aggregator already opens that file read-only with `node:sqlite`. |
| `SeekableZstdLogReaderPort` / `ArrayLogReader` | Task 029 `SeekableZstdLogReader`. Feed `readLastLines(2000)` into `daemonLogLines`. |
| `HardwareRingBufferPort` | Task 117 `WindowsResourceTelemetryCollector` ring buffer (`readSince`). |
| `PressureHistoryPort`, `LearnedFootprintPort` | Task 118 `PressureHysteresisStateMachine` and `LearnedFootprintStore`. |
| `BackupStatusPort.lastVerifiedAt` | Task 016 last verified backup timestamp. |
| `PinSafeCacheGcPort` | Task 028 pin-safe GC. `runSafeCacheCleanup` is the button adapter. |
| `ProviderHealthPort` | Task 140 live AIMD / connection overlay. 24 hour totals still come from `telemetry.db` kind `provider`. |
| `ConformancePort` | Task 151 foreign-adapter conformance overlay. History is kind `conformance`. |
| `StorageHygienePort` | Live CAS / zstd / worktree counts when kind `storage` is absent. |
| `NamedPipeProbePort`, `MinGitProbePort`, `DpapiProbePort`, `DiskHeadroomProbePort`, `PortLeaseProbePort` | Real named-pipe RTT, bundled MinGit `--version`, Task 120 DPAPI unlock, Task 117 disk free bytes, and the port-lease table. SQLite `PRAGMA quick_check` is already real and read-only. |
| `ClipboardPort` | Shell clipboard. |

`LOCAL_CRASH_REPORTER` must stay `uploadToServer: false`. Do not add a submit URL.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-133-diagnostics-health-bundle-exporter`.

- `pnpm --filter @ef-harness/daemon typecheck` — pass (`tsc -b`, exit 0).
- `pnpm --filter @ef-harness/renderer typecheck` — pass (`tsc -b`, exit 0).
- `pnpm --filter @ef-harness/daemon lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/renderer lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/daemon test -- diagnostics` — pass, 4 files, 19 tests. Covers 24 h aggregation (SQLite p99, governor pressure, pool slots, CAS sizes), SLO breach, corrupt/locked `telemetry.db` leaving `state.db` bytes unchanged, 7-day sample pruning and 90-day daily aggregates, 60-day store under 50 MB, canary/path/email/hostname redaction, preview bytes equal to ZIP entries (`tar` and an independent ZIP reader), allowlist rejection of `state.db` / source / `.env` / HAR / vault / prompts, graph opt-in strip, 40-dump and 15-dump cap at 10, 50 MB dump cap, `uploadToServer: false`, self-check under 2 s with MinGit and DPAPI faults, and no network client in `apps/daemon/src/diagnostics`.
- `pnpm --filter @ef-harness/renderer test -- diagnostics` — pass, 1 file, 3 tests. Light and dark documents include tabular numeric summaries and the required controls. The unavailable copy is exact. Both themes pass axe-core 4.14 with zero violations.
- `node scripts/verify-harmony.mjs --task 133` — pass (`harmony ok for Task-133`, exit 0). This also runs the workspace `typecheck`, `lint`, and `test` scripts.

## Known Limitations / Follow-Ups

- `LocalPacketSecurityRedactor` redacts registered canaries (length >= 8), `Bearer` tokens, and `authorization` / `api-key` assignments to `[REDACTED_SECRET]`. Task 011 still owns PEM, cloud-key patterns, and encoded/split-buffer variants. The exporter fails closed if a registered canary or Windows username remains after both passes.
- Crash indexing is a directory scan (`index()`), not a filesystem watcher. Electron minidumps are recognized from a sibling `.json` sidecar or a `EF-CRASH` header; otherwise the summary is `binary minidump` and the process type comes from the file name (`main` / `renderer` / `daemon` / `converter`).
- One-hertz samples may be stored as individual `hw_1hz` rows or as `hw_minute` batches of 60 samples. Both are pruned after 7 days. The size proof inserts 8 days of minute batches plus 60 daily aggregates and checks the file is under 50 MB after the sweep.
- The renderer duplicates the snapshot shape instead of importing the daemon. A later shared-contracts type can replace both copies; no schema change is required for that.
- axe-core runs in the renderer test through a local document adapter because `jsdom` is not installed and `apps/renderer/package.json` cannot take a new dependency. The product view is a string of accessible HTML for the shell to mount.
- Self-check probe implementations for the named pipe, MinGit, DPAPI, disk free bytes, and port leases are injected. The runner bounds each probe (default 400 ms) so a hung probe still finishes inside the 2 second budget. Disk thresholds and SQLite `quick_check` are implemented here.
- Diagnostics never open a network socket. Exports are written only to a caller-supplied local path.
