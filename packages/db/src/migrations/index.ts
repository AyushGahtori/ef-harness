export {
  BackupVerificationError,
  DatabaseNewerThanAppError,
  ForeignKeyIntegrityError,
  InsufficientDiskSpaceError,
  IntegrityCheckError,
  MigrationFailedError,
  MigrationRegistryError,
  ReadersActiveError,
  RebuildContractError,
  SchemaInvariantError,
  SchemaVersionGapError,
  SearchIndexDriftError,
  ViewInvariantError,
  WorkNotParkedError,
} from "./errors.js";
export {
  bytesNeededForVacuum,
  fileFingerprint,
  listPreMigrationBackups,
  renameWithRetry,
  restoreVacuumBackup,
  statfsDiskSpace,
  vacuumBytesNeeded,
} from "./backup.js";
export { createNodeSqliteConnectionFactory, openNodeSqliteConnection } from "./connection.js";
export {
  connectGlobalBrokerDb,
  listNeedsRepairProjects,
  markProjectNeedsRepair,
  readProjectStatus,
} from "./needs-repair.js";
export { PRODUCTION_SCHEMA_VERSION, productionMigrations } from "./production.js";
export { stateV2Sql } from "./v2.js";
export {
  FTS_PENDING_META_KEY,
  STATE_GRAPH_VIEWS,
  rebuildNodesSearchIndexes,
  runTwelveStepRebuild,
  verifyNodesSearchIndexes,
} from "./rebuild.js";
export { maxKnownSchemaVersion, validateMigrationRegistry } from "./registry.js";
export { rehearseMigration } from "./rehearse.js";
export type { RehearseMigrationOptions } from "./rehearse.js";
export { MigrationRunner, migrateDatabase } from "./runner.js";
export type { MigrationRunnerOptions } from "./runner.js";
export { efSearchText } from "./search-text.js";
export { REPAIR_OPTIONS, systemClock } from "./types.js";
export type {
  AppliedMigration,
  Clock,
  DiskSpaceProbe,
  GlobalBrokerDb,
  MigrateDatabaseOptions,
  MigrationDefinition,
  MigrationKind,
  MigrationOutcome,
  MigrationSuccess,
  NeedsRepairResult,
  ProjectStatus,
  ProjectTarget,
  RehearsalReport,
  RepairOption,
  SqlRow,
  SqlValue,
  SqliteConnection,
  SqliteConnectionFactory,
  SqliteStatement,
  TargetDb,
  TwelveStepRebuildPlan,
  WorkerReaderPool,
} from "./types.js";
