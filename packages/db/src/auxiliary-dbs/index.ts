export { acquireBrokerLock, type BrokerLock } from "./broker-lock.js";
export { ensureHarnessDataLayout, defaultHarnessDataRoot, assessDataRootPrivacy } from "./data-layout.js";
export type { EnsureHarnessDataLayoutOptions, HarnessDataLayout } from "./data-layout.js";
export {
  AttachedDatabaseForbiddenError,
  AuxiliaryDbError,
  BrokerLockHeldError,
  ConnectionClosedError,
  DatabaseCorruptError,
  DeviceIdImmutableError,
  DeviceIdInvalidError,
  DeviceIdMissingError,
  DuplicateProjectPathError,
  GlobalDatabaseCorruptError,
  GlobalSchemaVersionError,
  InvalidCodeIndexEntryError,
  InvalidProjectIdError,
  InvalidProjectPathError,
  InvalidProjectStatusError,
  InvalidSettingValueError,
  InvalidTelemetryEventError,
  NestedWriteTransactionError,
  PortLeaseConflictError,
  PortLeaseNotFoundError,
  PortOutOfRangeError,
  PortPoolExhaustedError,
  PragmaMismatchError,
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
  VaultRefSecretError,
  WalModeRequiredError,
} from "./errors.js";
export { GlobalBrokerDb, RESEARCH_CACHE_TTL_MS } from "./global-broker-db.js";
export type { OpenGlobalBrokerDbOptions } from "./global-broker-db.js";
export { CodeIndexDb } from "./code-index-db.js";
export type { CommitSymbol, OpenCodeIndexDbOptions } from "./code-index-db.js";
export { createCollectingLogger, createStderrAuxiliaryLogger } from "./logger.js";
export { PORT_MAX, PORT_MIN } from "./port-leases.js";
export { currentProcessIdentity } from "./process-identity.js";
export { normalizeProjectPath } from "./project-path.js";
export { loadCanonicalSchema, schemaTableNames } from "./schema-file.js";
export type { SchemaKind } from "./schema-file.js";
export {
  assertConnectionIsolated,
  openSqliteConnection,
  type ConnectionProfile,
  type RunResult,
  type SqliteConnection,
  type SqliteStatement,
  type SqlRow,
  type SqlValue,
} from "./sqlite-connection.js";
export {
  TELEMETRY_FLUSH_INTERVAL_MS,
  TELEMETRY_FLUSH_ROWS,
  TELEMETRY_PAGE_LIMIT,
  TELEMETRY_QUEUE_CAP,
  TELEMETRY_RETENTION_MS,
  TelemetryDb,
} from "./telemetry-db.js";
export type { OpenTelemetryDbOptions, TelemetryConnectionSettings } from "./telemetry-db.js";
export {
  GRANT_PRIORITIES,
  GRANT_STATES,
  PIN_HOLDER_KINDS,
  PROJECT_STATUSES,
  SYMBOL_KINDS,
  TELEMETRY_KINDS,
} from "./types.js";
export type {
  AuxiliaryLogEvent,
  AuxiliaryLogger,
  BrokerOwner,
  CasPinInput,
  CasPinRecord,
  CodeRef,
  CodeRefInput,
  CodeSymbol,
  CodeSymbolInput,
  CommitFile,
  ConnectionInput,
  ConnectionRecord,
  DataRootPrivacy,
  FileRank,
  FootprintEntry,
  GlobalConnectionSettings,
  GrantInput,
  GrantPriority,
  GrantRecord,
  GrantState,
  IndexedCommit,
  LeasePortInput,
  MachineProfileEntry,
  PinHolderKind,
  PortLease,
  ProcessIdentity,
  ProjectRecord,
  ProjectStatus,
  RegisterProjectInput,
  ResearchCacheEntry,
  ResearchCacheFilter,
  ResearchCacheKey,
  ResearchCacheWrite,
  SymbolKind,
  TelemetryEnqueueResult,
  TelemetryEventInput,
  TelemetryKind,
  TelemetryRecord,
  TelemetryStats,
} from "./types.js";
export { assertVaultRef, vaultSecretPrefixes } from "./vault-ref.js";
