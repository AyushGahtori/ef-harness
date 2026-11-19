export {
  APP_SUPPORTED_SCHEMA_VERSION,
  BOOTSTRAP_MIGRATION_KIND,
  BOOTSTRAP_MIGRATION_NAME,
  DEFAULT_APP_VERSION,
  META_KEYS,
  WEEK_MS,
} from "./constants.js";
export {
  AttachedDatabaseForbiddenError,
  ClosedDatabaseError,
  DatabaseSchemaVersionError,
  DatabaseVersionTooNewError,
  NestedWriteTransactionError,
  ProjectSafeModeError,
  ReadOnlyDatabaseError,
  WalModeRequiredError,
  WorldReadableProjectPathError,
} from "./errors.js";
export { createDefaultLogger } from "./logger.js";
export {
  assertPrivateProjectPath,
  defaultHarnessRoot,
  resolveProjectPaths,
  type ProjectPaths,
} from "./paths.js";
export { openProjectStateDb, ProjectStateDb } from "./project-state-db.js";
export { SafeModeController } from "./safe-mode.js";
export { renameWithRetry, type RenameHooks } from "./rename-retry.js";
export { assertSqlHasNoAttach } from "./sqlite-session.js";
export type {
  DataVersionCheck,
  DatabaseMode,
  IntegrityCheckResult,
  OpenProjectStateDbOptions,
  ProjectRuntimeRow,
  ResyncRequiredPayload,
  SafeModeDiagnostics,
  SafeModeReason,
  SafeModeStatusPayload,
  SchemaMigrationRow,
  StateDbLogger,
  StreamEpochBumpReason,
  WriterLockStatus,
  WriterOwner,
} from "./types.js";
