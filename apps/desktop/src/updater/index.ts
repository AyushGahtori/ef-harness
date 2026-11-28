export {
  BackupNotVerifiedError,
  ForwardOnlyCheckpointError,
  NewerSchemaVersionError,
  UncheckpointedWorkError,
  UpdateNotReadyError,
} from "./errors.js";
export type { HeadroomLevel, UpdateDescriptor } from "./ports.js";
export type {
  AutoUpdateSettings,
  CheckpointRecord,
  CheckpointStorePort,
  DaemonShutdownCoordinatorPort,
  ElectronUpdaterPort,
  MigrationAndRebuildEnginePort,
  PreUpgradeBackupPort,
  UpdateResourceHeadroomPort,
  WorkerParkPort,
} from "./ports.js";
export {
  CURRENT_SUPPORTED_SCHEMA_VERSION,
  DowngradeProtectionGuard,
  newerSchemaMessage,
} from "./downgrade-protection-guard.js";
export type { DatabaseStamp } from "./downgrade-protection-guard.js";
export {
  CheckpointSchemaUpcasterRegistry,
  HARNESS_INTEGRATION_REF,
  deterministicResumeToken,
} from "./checkpoint-schema-upcaster-registry.js";
export type { UpcastResult } from "./checkpoint-schema-upcaster-registry.js";
export {
  ParkFirstAutoUpdater,
  UPDATE_AND_RESTART_LABEL,
  updateReadyPillText,
} from "./park-first-auto-updater.js";
export type { ParkFirstAutoUpdaterDependencies, UpdatePill } from "./park-first-auto-updater.js";
