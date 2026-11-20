# Execution capacity spike

Measured on Windows 10 Home Single Language build 26200.9974, 16088 MB RAM, 12 cores, filesystem NTFS.
Dev Drive column: `not_available_on_host`. GPU: Intel(R) UHD Graphics; NVIDIA GeForce RTX 4050 Laptop GPU.

## Three pools stay separate

Thinking width and executing width are different axes. An own-loop cell can have many in-process thinking slots and a small warm execution pool. A session-process cell keeps one process tree per session, so its thinking count and executing count are recorded separately even when the numbers match.

## Provisional versus measured widths

### 16 GB

- **thinking:** provisional 12, measured 1, recommended 1 (measured_largest_pass_below_failure).
- **execution:** provisional 2, measured 1, recommended 1 (measured_largest_pass_below_failure).
- **heavyLane:** provisional 1, measured none, recommended 1 (provisional_no_passing_cell).
- **sessionProcess:** provisional 2, measured none, recommended 2 (provisional_no_passing_cell).
- **services:** provisional 2 environments plus preview, measured none, recommended 2 environments plus preview (provisional_service_processes_not_hosted_in_this_spike).

### 32 GB

- **thinking:** provisional 20, measured none, recommended 20 (provisional_not_measured_on_host).
- **execution:** provisional 4, measured none, recommended 4 (provisional_not_measured_on_host).
- **heavyLane:** provisional 2, measured none, recommended 2 (provisional_not_measured_on_host).
- **sessionProcess:** provisional 5, measured none, recommended 5 (provisional_not_measured_on_host).
- **services:** provisional 4 environments plus preview, measured none, recommended 4 environments plus preview (provisional_service_processes_not_hosted_in_this_spike).

A RAM class that this host cannot represent directly keeps the provisional defaults. A larger host must not be treated as 16 GB headroom; that class uses scale annotation and stays conservative when the provisional width was not measured under pressure.

## Pass rule

A cell is `PASS` only when UI input-to-paint p95 is strictly under 50 ms and hard page reads (`Memory\Page Reads/sec`) stay under 50. Commit charge above 90% is `FAIL_OOM_GUARD`.

## Cells

| Mode | Load | Thinking | Executing | Verdict |
| --- | --- | --- | --- | --- |
| own_loop | idle | 1 | 1 | PASS |
| own_loop | active | 1 | 1 | PASS |
| own_loop | mixed | 1 | 1 | FAIL |
| own_loop | idle | 5 | 2 | FAIL |
| own_loop | active | 5 | 2 | FAIL |
| own_loop | mixed | 5 | 2 | FAIL |
| own_loop | idle | 10 | 2 | FAIL |
| own_loop | active | 10 | 2 | not_available_on_host |
| own_loop | mixed | 10 | 2 | not_available_on_host |
| own_loop | idle | 20 | 2 | FAIL |
| own_loop | active | 20 | 2 | not_available_on_host |
| own_loop | mixed | 20 | 2 | not_available_on_host |
| session_process | idle | 1 | 1 | FAIL |
| session_process | active | 1 | 1 | FAIL |
| session_process | mixed | 1 | 1 | FAIL |
| session_process | idle | 5 | 5 | FAIL |
| session_process | active | 5 | 5 | FAIL |
| session_process | mixed | 5 | 5 | FAIL |
| session_process | idle | 10 | 10 | not_available_on_host |
| session_process | active | 10 | 10 | not_available_on_host |
| session_process | mixed | 10 | 10 | not_available_on_host |
| session_process | idle | 20 | 20 | not_available_on_host |
| session_process | active | 20 | 20 | not_available_on_host |
| session_process | mixed | 20 | 20 | not_available_on_host |

## Heavy lane

- Width 1: UI p95 unmeasured ms, commit ratio 0.3739, spike 0 bytes.
- Width 2: UI p95 unmeasured ms, commit ratio 0.3738, spike 0 bytes.
- Width 4: UI p95 unmeasured ms, commit ratio 0.3684, spike 0 bytes.

## ACL and slot reset

Empty-folder grant 79 ms (disk queue 13). Recursive grant over 500 files 168 ms (disk queue 0).
Cold slot create 368 ms. Reused slot `git checkout` + clean 192 ms.

## Collection APIs

- Committed memory: `GlobalMemoryStatusEx` (`ullTotalPageFile - ullAvailPageFile`).
- Working set: `Win32_PerfFormattedData_PerfProc_Process` where `Name='_Total'`, property `WorkingSet`.
- CPU: `GetSystemTimes` idle, kernel, and user deltas over 200 ms.
- Disk active time and queue: `Win32_PerfFormattedData_PerfDisk_PhysicalDisk` where `Name='_Total'`, `PercentIdleTime` and `CurrentDiskQueueLength`.
- Hard page faults: `Win32_PerfFormattedData_PerfOS_Memory` property `PageReadsPersec`.
- Defender CPU: `Get-Process MsMpEng` `TotalProcessorTime` over 200 ms, divided by elapsed time and logical core count. No exclusion is written.
- Dev Drive: `fsutil devdrv query`, with `Win32_LogicalDisk.FileSystem` when that query is denied. A denied or non-Dev-Drive volume is `not_available_on_host` and the NTFS run continues.
- UI input-to-paint: an Electron `BrowserWindow` sends a pointer input and records `requestAnimationFrame` time minus the input timestamp. The first frame is a warm-up.
- Sandbox launch: time to ready for a worker inside a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`0x2000`).
- Slot reset: cold `git init` plus commit, versus `git checkout -- .` and `git clean -fd` on the reused slot.

## What this spike did not change

Defender exclusions were not added. WSL settings were not edited. Template commands ran offline from the local tree and a hard-linked store file.

## Warnings

- Baseline idle CPU is 82.74%, above 15%. Repeated samples are still taken; treat a single noisy cell cautiously.
