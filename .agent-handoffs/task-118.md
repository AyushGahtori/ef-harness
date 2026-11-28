---
task_id: "Task-118"
branch: "task/118-governor-hysteresis-footprints"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/governor/src/admission/**"
  - "packages/governor/tests/admission/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 118 handoff

Hardware governor admission: calibration, learned footprints, 10s/30s pressure hysteresis, heavy-lane semaphore, Whisper GPU priority, and the 15/5/2 GB disk guard. Commit stays on `task/118-governor-hysteresis-footprints`.

## Exports Provided

Import from `packages/governor/src/admission/index.ts` until the package barrel is wired:

- `MachineCalibrationRunner`, `CalibrationProfile`, `MachineHardwareProbe`, `CalibrationBudgetExceededError`
- `LearnedFootprintStore`, `FootprintRecord`, `footprintSchemaColumns`
- `PressureHysteresisStateMachine`, `PressureShiftEvent`, `PressureLevel` (`GREEN` | `YELLOW` | `ORANGE` | `RED`)
- `HeavyLaneSemaphore`, `maxHeavyPermits`, `HEAVY_LANE_PRIORITY_WEIGHT`
- `GpuWhisperPriorityArbiter`, `WHISPER_VRAM_MB`
- `DiskHeadroomGuard`, `DiskHeadroomView`
- `MemoryFootprintAdmission` (footprint check before spawn)
- `SyntheticTelemetryProvider`, `HardwareSnapshot`, `ResourceTelemetryProvider`, `JobObjectFootprintReading` (local ports)
- `GlobalDbPort`, `InMemoryGlobalDb` (local port of `global.db` `machine_profile` + `footprints`)
- `desiredLevel`, `actionsFor`, `concurrencyCaps`, `COMMAND_CLASS_DEFAULT_MB`

Behavior callers can rely on:

- Enter a worse pressure level after `>= 10_000` ms. Recover only after `>= 30_000` ms below the recovery margin (leave RED at `>= 8%` free and commit `<= 90%`, leave ORANGE at `>= 15%` free, leave YELLOW only above `25%` free). `LowMemoryResourceNotification` and disk `< 2 GB` enter `RED` in `0` ms.
- `GREEN` keeps the calibrated warm-slot cap and Office animations. `YELLOW` reduces that cap by 1 (floor 1) and defers background indexing, GC, and non-critical prewarm. `ORANGE` caps warm slots at 1, pauses background work, waits before another heavy job, and emits `governor.orange_entered` for the Office-to-Board fallback. `RED` halts new launches, pauses non-essential local models, and surfaces a RAM/Disk/GPU card.
- Primary driver strings include `RAM low (1.8 GB free)`, `Windows Defender scanning`, `UI latency > 50 ms`, `Disk C: < 5 GB`, `Disk C: < 2 GB`, `Commit charge > 95%`, and `Windows low-memory notification`.
- Heavy-lane permits: `1` at `<= 16 GiB` or on `YELLOW`/`ORANGE`, `2` at `>= 32 GiB` and `GREEN`, `0` on `RED`. Queue order is verifier, then worker, then background. Holders are not revoked when the cap shrinks.
- Disk tiers, per drive: `< 15 GB` warns and requests CAS GC plus temp-worktree and old-log cleanup; `< 5 GB` pauses new launches and shows `Low disk space (< 5 GB on C:) — Free space or clean caches`; `< 2 GB` pauses writers immediately. Recovery is 30 s, or instant on `recheck`.
- Empty footprint rows use `unit_test` 400 MB, `typecheck` (tsc) 900 MB, `playwright` 1500 MB, `pnpm_install` 1000 MB. Admission requires `availRamMb - max(15% of RAM, 2048 MB) >= predicted p90` and `availCommitMb >= predicted`. Otherwise the command is queued while another job is running. One idle forward-progress admit remains when pressure is not `RED` and disk is at least 5 GB.

## Shared Wiring Needs (Root / Index Barrels)

`packages/governor/src/index.ts` is frozen. Please re-export the admission surface:

```ts
export {
  DiskHeadroomGuard,
  GpuWhisperPriorityArbiter,
  HeavyLaneSemaphore,
  LearnedFootprintStore,
  MachineCalibrationRunner,
  MemoryFootprintAdmission,
  PressureHysteresisStateMachine,
  SyntheticTelemetryProvider,
} from "./admission/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or schema edit was made.

## Dependency Intents (New Packages Requested)

None. The package already depends on `@ef-harness/shared-contracts`, and tests use the existing Vitest catalog entry.

## Contract Change Requests

1. `schema/global.sql` `footprints` stores `consumer`, `project`, `p50_mb`, `p95_mb`, `samples`, `updated_at`. Task 118 also records `p90_mb`, `peak_ram_mb`, `peak_cpu_time_ms`, `disk_write_bytes`, and `wall_clock_ms`. `FootprintRecord` carries those fields and `footprintSchemaColumns()` is the current SQL projection. A forward migration should add the extra columns (or a child table) so they survive a real `GlobalDbRepo` upsert. `consumer` is the command class (`typecheck`, `unit_test`, `playwright`, `build`, `pnpm_install`, `db_migrate`). `project` is the project id.
2. `machine_profile` keys written by calibration: `ram_total_mb`, `cores`, `gpu`, `dev_drive`, `storage_class`, `io_latency_ms`, `warm_execution_slots`, `thinking_slots`, `heavy_lane_permits`, `calibration_run` (JSON). The schema comment already allows arbitrary keys.
3. Sibling swap, Task 117: `HardwareSnapshot`, `ResourceTelemetryProvider`, `SyntheticTelemetryProvider`, and `JobObjectFootprintReading` are local ports under `packages/governor/src/admission/ports/`. Task 117's `packages/governor/src/telemetry/**` is not on this base. When Task 117 lands, delete the local snapshot/provider duplicates and import its exports. Keep using the same field names (`availPhysMb`, `lowMemoryNotification`, `defenderCpuRatio`, `uiLatencyMs`, `uiSampleValid`, `projectDisk`, `appDataDisk`, Job Object peak bytes, user/kernel time, disk write bytes, wall clock).
4. Sibling swap, Task 014: `GlobalDbPort` stands in for `GlobalDbRepo.machine_profile` and `GlobalDbRepo.footprints`. `InMemoryGlobalDb` is the test adapter. Wire `MachineCalibrationRunner` and `LearnedFootprintStore` to the real broker when Task 014 is integrated.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-118-governor-hysteresis-footprints`:

- `pnpm --filter @ef-harness/governor test -- admission` — 6 files, 33 tests passed (10s enter, 30s recover, 3s spike with 0 transitions, 0s RED on low-memory and `< 2 GB`, 15/5/2 GB on each drive, verifier-before-worker heavy lane, Whisper over queued `qwen2.5-coder:14b`, footprint schema upsert and OOM queue).
- `pnpm --filter @ef-harness/governor typecheck` — exit 0.
- `pnpm --filter @ef-harness/governor lint` — exit 0.
- `node scripts/verify-harmony.mjs --task 118` — `harmony ok for Task-118` (exit 0). Full-repo typecheck, lint, test, schema (67/67), and diagram checks passed.

## Known Limitations / Follow-Ups

- `build` defaults to 2048 MB and `db_migrate` to 1024 MB. The spec named numeric defaults only for `unit_test`, tsc/`typecheck`, `playwright`, and `pnpm_install`.
- Calibration reads a `MachineHardwareProbe` and refuses probes whose `inspectionDurationMs` exceeds 3000. It does not install or build a template app. Concurrency is 2 warm / 12 thinking / 1 heavy permit below 32 GiB, and 4 / 20 / 2 at 32 GiB and above (so a 16 GiB laptop is 2 and a 64 GiB desktop is 4). Storage is `ssd` when I/O latency is under 8 ms.
- UI latency above 50 ms is `YELLOW`; above 100 ms is `ORANGE`. The driver string stays `UI latency > 50 ms`. Invalid UI samples (`uiSampleValid: false`) are ignored. Defender CPU above 25% is `YELLOW` with driver `Windows Defender scanning`.
- A disk warning under 15 GB does not by itself change pressure. Under 5 GB becomes `ORANGE` after 10 s. Under 2 GB is instant `RED`.
- The RAM forward-progress floor does not override a `< 5 GB` disk pause or a `RED` / low-memory halt.
- Whisper sizes are base 512 MB, small 1024 MB, medium 2048 MB. Dictation that does not fit runs on CPU and still blocks new local-model GPU dispatches. Already-running models are not killed.
- Heavy-lane fairness is priority weight then FIFO. It does not preempt a permit that was already granted.
