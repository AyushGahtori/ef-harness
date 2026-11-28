export {
  ACTIVE_POLL_MS,
  BYTES_PER_GB,
  COLLECTOR_CADENCES,
  COMMIT_EXHAUSTED_USED_RATIO,
  COMMIT_HEADROOM_FLOOR_BYTES,
  DEFAULT_FLUSH_CAP,
  DEFAULT_RING_CAPACITY,
  DEFAULT_TELEMETRY_ROW_CAP,
  DEFAULT_UI_SUSTAIN_SAMPLES,
  DEFENDER_CONTENTION_CPU_PERCENT,
  DEFENDER_EXCLUSION_TIP,
  DEFENDER_PROCESS_NAME,
  DISK_EMERGENCY_FREE_BYTES,
  DISK_PAUSE_FREE_BYTES,
  DISK_WARNING_FREE_BYTES,
  FORBIDDEN_POLL_EXECUTABLES,
  HARDWARE_SNAPSHOT_SCHEMA_ID,
  HardwareSnapshotError,
  IDLE_POLL_MS,
  JOB_ROLES,
  MAX_COLLECTOR_CPU_RATIO,
  MAX_COLLECTOR_RAM_BYTES,
  MAX_SAMPLE_MS,
  PROVIDER_KINDS,
  SUSPENDED_POLL_HZ,
  TELEMETRY_KINDS,
  TelemetryError,
  UI_HEARTBEAT_HZ,
  UI_LATENCY_PRESSURE_MS,
  VOLUME_ROLES,
} from "./types.js";
export type {
  ActiveJobSlot,
  CollectorCadence,
  DefenderSample,
  DiskSample,
  GpuSample,
  HardwareSnapshot,
  JobAccountingSample,
  JobRole,
  MemorySample,
  ProviderKind,
  SupervisorJobAccounting,
  TelemetryEnqueueResult,
  TelemetryEventInput,
  TelemetryKind,
  UiHeartbeat,
  UiLatencySample,
  VolumeRole,
  VolumeSample,
} from "./types.js";
export { HardwareSnapshotSchema, assertCadence, assertJobRole, assertProviderKind } from "./schema.js";
export {
  commitIsExhausted,
  defenderSample,
  diskSample,
  driveOf,
  freeRatio,
  gpuFallback,
  gpuSample,
  hardwareSnapshot,
  jobSample,
  memorySample,
  neutralUi,
  unavailableDisk,
  unavailableJob,
  unavailableMemory,
  volumeSample,
} from "./snapshot.js";
export { MemoryTelemetryDbRepo, assertKind, estimateJsonBytes } from "./ports.js";
export type { TelemetryDbRepo, WindowsJobSupervisor } from "./ports.js";
export { ManualScheduler, TimeoutScheduler, pollIntervalMs } from "./cadence.js";
export type { Scheduler } from "./cadence.js";
export { UiLatencyHeartbeatMonitor, idleUiAssessment } from "./ui-latency.js";
export { ManualLowMemorySource, MemoryNotificationWatcher } from "./memory-notification.js";
export type { LowMemorySource } from "./memory-notification.js";
export { PollSubprocessGuard } from "./poll-guard.js";
export { TelemetryFlushBuffer, TelemetryRingBuffer } from "./retention.js";
export {
  SYNTHETIC_SCENARIOS,
  SyntheticTelemetryProvider,
  syntheticScenario,
  unavailableProviderSnapshot,
} from "./synthetic-provider.js";
export type { SyntheticScenarioName } from "./synthetic-provider.js";
export type { ResourceTelemetryProvider, TelemetrySampleRequest } from "./provider.js";
export { PosixFallbackTelemetryProvider } from "./posix-provider.js";
export {
  Win32HelperClient,
  findPrebuiltWin32Helper,
  isWin32HelperExecutable,
  win32HelperExecutable,
} from "./win32-helper-client.js";
export type { HelperProbeJob, HelperSample } from "./win32-helper-client.js";
export { Win32NativeTelemetryProvider } from "./win32-provider.js";
export type { Win32SampleSource } from "./win32-provider.js";
export {
  WindowsResourceTelemetryCollector,
  defaultAppDataPath,
  openWindowsResourceTelemetryCollector,
} from "./collector.js";
export type { CollectorClock, WindowsResourceTelemetryCollectorOptions } from "./collector.js";
