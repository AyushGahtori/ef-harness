export {
  DAY_MS,
  HOUR_MS,
  ManualClock,
  SystemClock,
  immediateSleeper,
  realSleeper,
  renameRetryDelays,
} from "./clock.js";
export type { Clock, Sleeper } from "./clock.js";

export {
  BackupScheduler,
  assertBackupAllowed,
  backupHolderId,
  inspectBackupFile,
  isRebuildOnlyDatabase,
  listBackupFiles,
  listBackupPins,
  parseBackupFile,
  removeBackupPins,
} from "./backup-scheduler.js";
export type { BackupExposeInfo, BackupSchedulerOptions } from "./backup-scheduler.js";

export { evaluateSchemaInvariants } from "./invariants.js";
export { withRotationLock } from "./lock.js";
export { renameWithRetry } from "./rename.js";
export type { RenameFn } from "./rename.js";

export {
  FilesystemReplaySourceAdapter,
  findAcceptedCommitsSince,
  parseHarnessTrailers,
  parseHistoryLine,
  readHistoryChangeSets,
  replayPostBackupState,
  selectNewestCheckpointParks,
} from "./replay.js";
export type {
  CheckpointRefRecord,
  FilesystemReplayOptions,
  GitCommitRecord,
  GitRunner,
  HarnessTrailers,
  HistoryChangeSetRecord,
  HistoryEdgeRecord,
  HistoryNodeRecord,
  ReplayResult,
  ReplaySourceAdapter,
} from "./replay.js";

export { salvageCorruptDatabase } from "./salvage.js";
export type { SalvageResult } from "./salvage.js";

export {
  CorruptionRecoveryEngine,
  recreateRebuildableDatabase,
  restoreNewestGoodBackup,
} from "./recovery-engine.js";
export type {
  CorruptionRecoveryEngineOptions,
  RestoreResult,
} from "./recovery-engine.js";

export { classifySqliteError } from "./sqlite-io.js";

export type {
  BackupCadence,
  BackupFileInfo,
  BackupWriteResult,
  DetectionKind,
  GlobalBrokerDb,
  InvariantFailure,
  InvariantReport,
  ParkedAttempt,
  ProjectStateDb,
  RecoveryOutcome,
  RecoveryReport,
  RecoverySchedule,
  ReplayedChangeSet,
  ReverificationTask,
  SkippedBackup,
  SpendGapWindow,
  SqliteCorruptCode,
  UnrecoveredGap,
  WrittenBackup,
} from "./types.js";
export { RecoveryError } from "./types.js";
