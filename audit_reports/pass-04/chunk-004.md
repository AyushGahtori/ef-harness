# Audit Report — `pass-04/chunk-004` (`Tasks 117–121, 134`: `packages/governor` & M3 Parallel Exit Gate)

## 1. Chunk identification and scope
- **Pass:** `Pass 04` (Integrator, Steering, Governor, Providers, Runtime Adapters, M3/M4 Gates)
- **Chunk ID:** `pass-04/chunk-004`
- **Scope:** All 5 `packages/governor` units (`117` `telemetry`, `118` `admission`, `119` `capacity-pools`, `120` `vault`, `121` `human-steps`) plus `Task 134` M3 Parallel Exit Gate (`tests/e2e/m3-exit-gate/**`, `benchmarks/m3-parallel/**`).
- **Isolation state:** All 6 branches forked from `main` (`6497730`), clean (`dirty: 0`), unmerged on `harness/integration` (`30f2e9c`).

## 2. Units inspected
| Unit | Branch | Commit | Worktree | Dirty |
| --- | --- | --- | --- | --- |
| `Task 117` | `task/117-governor-windows-telemetry` | `dcee682` | `C:/Users/Ayush/Desktop/ef-wt/task-117-governor-windows-telemetry` | 0 |
| `Task 118` | `task/118-governor-hysteresis-footprints` | `865cae2` | `C:/Users/Ayush/Desktop/ef-wt/task-118-governor-hysteresis-footprints` | 0 |
| `Task 119` | `task/119-three-pool-capacity-scheduler` | `b9a1b25` | `C:/Users/Ayush/Desktop/ef-wt/task-119-three-pool-capacity-scheduler` | 0 |
| `Task 120` | `task/120-dpapi-secrets-vault-env-injection` | `f1fad0a` | `C:/Users/Ayush/Desktop/ef-wt/task-120-dpapi-secrets-vault-env-injection` | 0 |
| `Task 121` | `task/121-human-step-probing-verification` | `f8fb5d0` | `C:/Users/Ayush/Desktop/ef-wt/task-121-human-step-probing-verification` | 0 |
| `Task 134` | `task/134-m3-parallel-exit-gate` | `7f37eee` | `C:/Users/Ayush/Desktop/ef-wt/task-134-m3-parallel-exit-gate` | 0 |

## 3. Files inspected
- `Task 117`: `packages/governor/src/{index.ts,telemetry/collector.ts}`
- `Task 118`: `packages/governor/src/admission/{learned-footprint-store.ts,types.ts}`
- `Task 119`: `packages/governor/src/capacity-pools/scheduler.ts`
- `Task 120`: `packages/governor/src/vault/metadata-store.ts`
- `Task 121`: `packages/governor/src/human-steps/{store.ts,types.ts}`
- `Task 134`: `tests/e2e/m3-exit-gate/runner.ts`
- Root: `schema/global.sql` (`lines 1–80`)

## 4. Architecture documents consulted
- `app-shell-and-governor.md`, `execution-capacity.md`, `sandbox-and-security.md`, `provider-connections.md`, `build-cockpit.md`, `roadmap.md`
- `schema/global.sql`, `schema/telemetry.sql`, `schema/state.sql`
- `IMPLEMENTATION_TASKS.md` (`lines 7200–7507`, `8296–8361`)

## 5. Contracts and signatures discovered
- `Task 117`: `WindowsResourceTelemetryCollector.{start,stop,sampleOnce,suspend,resume}`, `openWindowsResourceTelemetryCollector`, `UiLatencyHeartbeatMonitor`, `MemoryNotificationWatcher`.
- `Task 118`: `MachineCalibrationRunner`, `LearnedFootprintStore` (`FootprintRecord`), `PressureHysteresisStateMachine` (`PressureLevel = "GREEN" | "YELLOW" | "ORANGE" | "RED"`), `HeavyLaneSemaphore`, `GpuWhisperPriorityArbiter`, `DiskHeadroomGuard`.
- `Task 119`: `ThreePoolCapacityScheduler.create(opts)` (`GovernorPressure = "Green" | "Yellow" | "Orange" | "Red"`), `ThinkingPoolCoordinator`, `WarmExecutionSlotPool`, `SessionProcessCapGuard`, `SingleDiskWriteLane`, `TierERemoteExecutionInterface`.
- `Task 120`: `WindowsDpapiSecretsVault`, `SqliteVaultMetadataStore(globalDbPath, stateDbPath)`, `RuntimeOnlyEnvInjector`, `LiveKeyTestRefusalGuard`, `ProviderSecretProber`, `GitignoredLocalEnvWriter`.
- `Task 121`: `HumanStepProbeRegistry`, `ConsentedTerminalInstaller`, `HumanStepStateStore` (`WAITING_ON_HUMAN_STEP_REASON = "waiting_on_human_step"`), `AttestedVsVerifiedBadgePolicy`.
- `Task 134`: `M3ParallelBenchmarkRunner.run(opts)` (imports local fake `HeftCriticalPathScheduler`, `ProjectMergeQueue`, `WindowsDpapiSecretsVault`, `M2KitchenE2eBenchmarkRunner` from `./*.ts`).

## 6. Confirmed findings
- **`F-055` (`CRITICAL` / `CONTRACT_MISMATCH` & `SCHEMA_MISMATCH`):** `packages/governor` (`117–121`) stub barrel (`packages/governor/src/index.ts`), `PressureLevel` casing crash between `118` (`"GREEN"|"YELLOW"|"ORANGE"|"RED"`) and `119`/`107` (`"Green"|"Yellow"|"Orange"|"Red"` — `ThreePoolCapacityScheduler.setPressure` throws `CapacityError: Unknown governor pressure` when fed `118`'s output!), `LearnedFootprintStore` (`118`) vs `schema/global.sql` `footprints` schema/port mismatch, `SqliteVaultMetadataStore` (`120`) opening raw dual `DatabaseSync` writers on both `global.db` and `state.db` + duplicating `PacketSecurityRedactor`, `HumanStepStateStore` (`121`) emitting invalid `task_holds.reason = "waiting_on_human_step"` + unmigrated `human_steps` table, and `Win32HelperClient` (`117`) falling back silently to `PosixFallbackTelemetryProvider` unless `win32-helper.cs` is compiled and packaged.
- **`F-056` (`CRITICAL` / `TEST_GAP` & `BUILD_CONFIG`):** `Task 134` M3 Parallel Exit Gate (`tests/e2e/m3-exit-gate/runner.ts`) imports **zero** `@ef-harness/*` packages — it defines local mock stand-in classes (`HeftCriticalPathScheduler`, `ProjectMergeQueue`, `WindowsDpapiSecretsVault`, `M2KitchenE2eBenchmarkRunner`, `KitchenHiddenAcceptanceSuite`) inside `./schedule.ts`, `./merge-queue.ts`, and `./kitchen.ts`, evaluates 4 hardcoded 1-line strings instead of building/booting the Kitchen App, and uses untypechecked `.ts` import specifiers outside `tests/e2e/tsconfig.json`.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `Task 014` (`GlobalBrokerDb` / `TelemetryDb`) + `Task 040` (`WindowsJobObjectManager`) → `Task 117` (`telemetry`) → `Task 118` (`admission`) → `Task 119` (`capacity-pools`) → `Task 047`/`048` (`HarnessRunEngine`/`AttemptMcpServer`), `Task 107` (`HeftCriticalPathScheduler`), `Task 124` (`BoardCockpitView`), `Task 150` (`checkpoint-resume`), `Task 165` (`Office` fallback), `Task 188` (`broker`).
- `Task 120` (`vault`) → `Task 121` (`human-steps`), `Task 136`–`139` (`providers`), `Task 160` (`preview`), `Task 179` (`ship-deploy`).
- `Tasks 105–133` → `Task 134` (`M3ExitGate`).

## 9. Defects and missing integrations
- `117`, `118`, `119`, `120`, and `121` are completely disconnected from each other (`118` output crashes `119` on case mismatch!) and unexported from `@ef-harness/governor` (`F-055`).
- `134` certifies local fake classes rather than the M3 parallel stack (`F-056`).

## 10. Tests and verification performed
- Reviewed unit tests across `packages/governor/tests/{telemetry,admission,capacity-pools,vault,human-steps}/**` and `tests/e2e/tests/m3-exit-gate.test.ts`.

## 11. Unresolved questions
- Interaction of `120` (`WindowsDpapiSecretsVault`) and `119` (`ThreePoolCapacityScheduler`) with `packages/providers` (`135–141`) and `packages/runtime-adapters` (`142–152`) — inspected next in `pass-04/chunk-005..007`.

## 12. Explicit files and relationships still requiring inspection
- `pass-04/chunk-005`: `Tasks 135–141` (`packages/providers` policy, api-keys, siwc, openrouter-local, copilot-cursor-auth, pacing + `141` connections UI).
