export {
  COMMAND_CLASSES,
  HEAVY_COMMAND_CLASSES,
  HEAVY_LANE_ROLES,
  PRESSURE_LEVELS,
  footprintSchemaColumns,
  isHeavyCommandClass,
  pressureRank,
} from "./types.js";
export type {
  CommandClass,
  FootprintRecord,
  FootprintSchemaColumns,
  HeavyCommandClass,
  HeavyLaneRole,
  PressureLevel,
} from "./types.js";

export {
  CALIBRATION_BUDGET_MS,
  COMMAND_CLASS_DEFAULT_MB,
  COMMIT_RED_RATIO,
  COMMIT_RECOVER_RATIO,
  DEFENDER_CONTENTION_RATIO,
  DISK_EMERGENCY_BYTES,
  DISK_PAUSE_BYTES,
  DISK_WARN_BYTES,
  EMA_HIGH_WATERMARK_ALPHA,
  EMERGENCY_ENTER_MS,
  ENTER_WORSE_MS,
  GB16_MB,
  GB32_MB,
  GiB,
  HEAVY_LANE_PRIORITY_WEIGHT,
  RAM_GREEN_FREE_RATIO,
  RAM_ORANGE_FREE_RATIO,
  RAM_RED_FREE_RATIO,
  RAM_YELLOW_FREE_RATIO,
  RECOVER_BETTER_MS,
  SAFETY_RESERVE_MIN_MB,
  SAFETY_RESERVE_RATIO,
  SSD_MAX_IO_MS,
  UI_LATENCY_ORANGE_MS,
  UI_LATENCY_YELLOW_MS,
  WHISPER_VRAM_MB,
  concurrencyCaps,
  defaultFootprintMb,
  formatGbFromBytes,
  formatGbFromMb,
  maxHeavyPermits,
  mbFromBytes,
  safetyReserveMb,
  storageClassFromLatency,
} from "./thresholds.js";
export type { WhisperModelClass } from "./thresholds.js";

export { stepHysteresis } from "./hysteresis.js";
export type { HysteresisStep, HysteresisTransition, PendingTarget } from "./hysteresis.js";

export type {
  DiskVolumeSnapshot,
  HardwareSnapshot,
  JobObjectFootprintReading,
  ResourceTelemetryProvider,
} from "./ports/hardware-snapshot.js";
export { SyntheticTelemetryProvider } from "./ports/synthetic-telemetry-provider.js";
export type {
  FootprintsRepo,
  GlobalDbPort,
  MachineProfileEntry,
  MachineProfileRepo,
} from "./ports/global-db.js";
export {
  InMemoryFootprintsRepo,
  InMemoryGlobalDb,
  InMemoryMachineProfileRepo,
} from "./ports/in-memory-global-db.js";

export {
  DISK_TIERS,
  DiskHeadroomGuard,
  diskTierForFreeBytes,
} from "./disk-headroom-guard.js";
export type {
  DiskDriveView,
  DiskHeadroomView,
  DiskMaintenance,
  DiskTier,
} from "./disk-headroom-guard.js";

export {
  actionsFor,
  activeDrivers,
  desiredLevel,
  enteredLevel,
  hardwarePressureCard,
  isEmergency,
  primaryDriver,
  signalsFromSnapshot,
} from "./pressure-model.js";
export type {
  HardwarePressureCard,
  PressureActions,
  PressureSignals,
} from "./pressure-model.js";

export { PressureHysteresisStateMachine } from "./pressure-hysteresis-state-machine.js";
export type {
  PressureMachineOptions,
  PressureShiftEvent,
  PressureShiftListener,
} from "./pressure-hysteresis-state-machine.js";

export {
  CalibrationBudgetExceededError,
  MachineCalibrationRunner,
} from "./machine-calibration-runner.js";
export type {
  CalibrationClock,
  CalibrationProfile,
  CalibrationReason,
  MachineHardwareProbe,
} from "./machine-calibration-runner.js";

export { LearnedFootprintStore } from "./learned-footprint-store.js";
export type { FootprintObservation, WorkloadFootprintEstimate } from "./learned-footprint-store.js";
export { openGlobalBrokerPort } from "./global-broker-port.js";

export { MemoryFootprintAdmission } from "./memory-footprint-admission.js";
export type {
  AdmissionDecision,
  AdmissionRequest,
  AdmissionResources,
} from "./memory-footprint-admission.js";

export { HeavyLaneSemaphore } from "./heavy-lane-semaphore.js";
export type { HeavyLaneRequest, HeavyLaneTicket } from "./heavy-lane-semaphore.js";

export { GpuWhisperPriorityArbiter } from "./gpu-whisper-priority-arbiter.js";
export type {
  DictationGrant,
  LocalModelRequest,
  LocalModelTicket,
} from "./gpu-whisper-priority-arbiter.js";
