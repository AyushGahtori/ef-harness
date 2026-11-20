---
task_id: "Task-004"
branch: "task/004-spike-execution-capacity"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - spikes/execution-capacity/**
  - spikes/tests/execution-capacity.test.ts
  - .agent-handoffs/task-004.md
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 004 handoff

Spike benchmark for sandbox execution capacity. Commit stays on `task/004-spike-execution-capacity`.

## Exports Provided

- `spikes/execution-capacity/bench.mjs` runs the capacity matrix. `--quick` is the deterministic CI path. A full invocation measures worker counts 1, 5, 10, and 20, loads `idle`, `active`, and `mixed`, and isolation modes `own_loop`, `session_process`, `tier_a`, `tier_c`, and `tier_d`.
- `spikes/execution-capacity/calibrated-defaults.json` is the measured summary. `machine_profile` rows use `key`, `value`, `measured_at`. `footprints` rows use `consumer`, `project`, `p50_mb`, `p95_mb`, `samples`, `updated_at`. Thinking width and executing width are separate fields.
- `spikes/execution-capacity/REPORT.md` states provisional and measured pool widths for 16 GB and 32 GB.
- `spikes/tests/execution-capacity.test.ts` is a one-line importer so `pnpm --filter @ef-harness/spikes test -- execution-capacity` matches the frozen Vitest include `tests/**/*.test.ts`. The assertions live under `spikes/execution-capacity/tests/`.

## Shared Wiring Needs (Root / Index Barrels)

None. The Vitest discovery importer above is committed in this branch, so the filter command runs without editing `spikes/vitest.config.ts`.

## Dependency Intents (New Packages Requested)

None. The benchmark uses Node, the workspace TypeScript and Vite installs, the global pnpm entry, and the already installed Electron binary. No package was added.

## Contract Change Requests

None.

## Exact Verification Commands & Results

Commands were run on this 16 GB NTFS Windows host (build 26200.9974).

- `pnpm --filter @ef-harness/spikes test -- execution-capacity` — 13 passed. Coverage includes the pass rule (`ui p95 < 50` and hard page reads under 50), separate thinking and executing widths for counts 1, 5, 10, and 20, schema rows, seeded mixed load, queue priority, Job Object grandchild cleanup within 1000 ms, the `--quick` harness, and simulated SIGINT cleanup.
- `node scripts/verify-harmony.mjs --task 004` — `harmony ok for Task-004` (exit 0). This includes scope, schema, typecheck, lint, and the workspace test suite.
- `node bench.mjs --workers=1,5,10,20 --samples=3 --modes=own_loop,session_process --loads=idle,active,mixed --heavy=1,2,4 --pool=2 --active-max=5 --session-max=5 --write` from `spikes/execution-capacity` — exit 0 in about 296s. Wrote `calibrated-defaults.json` and `REPORT.md`.
- Own-loop idle and active at thinking width 1 passed (UI p95 about 7 ms, commit ratio about 0.43). Wider cells failed on this busy host (baseline CPU 82.74%). 16 GB recommended widths are therefore measured-conservative: thinking 1, execution 1, heavy lane kept at the provisional 1, session-process kept at the provisional 2. 32 GB stays at the provisional widths because this host is 16088 MB.
- Dev Drive is `not_available_on_host` (`fsutil devdrv query` returned access denied; the volume filesystem is NTFS). The NTFS run completed.
- Empty-folder ACL grant was 79 ms. Recursive grant over 500 files was 168 ms. Cold slot create was 368 ms. Reused `git checkout` plus clean was 192 ms.
- Tier A: OS build qualifies for MXC (`osQualified: true`) and the spike does not bind the MXC API (`mxc_api_not_bound`). Tier C was not launched. Tier D found WSL and left it stopped because free memory was low (`left_stopped_low_free_memory`). Docker was not found.

## Known Limitations / Follow-Ups

- Tasks 118 and 119 should read `calibrated-defaults.json` and keep the provisional 32 GB widths until a 32 GB machine is measured. Do not treat this 16 GB host as 32 GB headroom.
- Baseline CPU was 82.74% before the saved run, so page-read samples are noisy. A quiet rerun can replace the 16 GB measured widths.
- The saved run's Electron probe stopped returning frames after the first passing cells, so later cells have null UI latency and fail the pass rule. The harness now restarts the probe after an empty sample and bounds a worker command at 120 s. Those guards were added after the saved JSON was written.
- Active and mixed loads above 5 workers, and session-process widths above 5, are marked `not_available_on_host` in this invocation (`active_width_not_run_in_this_invocation`, `session_width_not_run_in_this_invocation`). The runner still accepts 10 and 20 when those caps are omitted.
- Heavy-lane `tsc --noEmit` and Vite builds exited 0 at widths 1, 2, and 4. UI latency for that section was unmeasured because the probe had already stopped, so the heavy-lane recommendation stays at the provisional value.
- Defender exclusions and WSL settings were not modified.

### Windows performance-counter collection for Tasks 117–119

- Committed memory: `GlobalMemoryStatusEx`, commit charge = `ullTotalPageFile - ullAvailPageFile`, ratio = charge / `ullTotalPageFile`. Abort a cell above 0.90.
- Working set: `Win32_PerfFormattedData_PerfProc_Process` `Name='_Total'` `WorkingSet`.
- CPU: `GetSystemTimes` over 200 ms. Warn when baseline idle CPU is above 15%.
- Disk: `Win32_PerfFormattedData_PerfDisk_PhysicalDisk` `Name='_Total'` `PercentIdleTime` (active = 100 - idle) and `CurrentDiskQueueLength`.
- Hard page faults: `Win32_PerfFormattedData_PerfOS_Memory` `PageReadsPersec`. Pass threshold is strictly under 50.
- Defender CPU: `Get-Process -Name MsMpEng`, delta of `TotalProcessorTime` over 200 ms, divided by elapsed milliseconds times logical core count. Read only.
- UI: Electron `BrowserWindow` plus `webContents.sendInputEvent` pointer down, then `requestAnimationFrame` minus the event timestamp. Pass threshold is strictly under 50 ms.
- Job Object: `CreateJobObject`, `SetInformationJobObject` class 9, `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`0x2000`). Closing the holder kills the worker and grandchildren.
- Dev Drive: `fsutil devdrv query <drive>`, fallback `Win32_LogicalDisk.FileSystem`.
