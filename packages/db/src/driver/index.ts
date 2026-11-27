export {
  AttachedDatabaseForbiddenError,
  ConnectionClosedError,
  DeferredBeginForbiddenError,
  DuplicateQueryNameError,
  ForeignKeyConstraintError,
  NestedImmediateTransactionError,
  ParameterMismatchError,
  PragmaMismatchError,
  ReaderBudgetError,
  ReaderTimeoutError,
  SqliteBusyError,
  StatementFinalizedError,
  UnknownQueryError,
  WalModeRequiredError,
} from "./errors.js";
export type { ForeignKeyDiagnostic } from "./errors.js";

export { createBetterSqlite3Backend, createNodeSqliteBackend } from "./backend.js";
export type {
  BetterSqlite3Constructor,
  BetterSqlite3Database,
  SqliteBackend,
  SqliteBackendFactory,
  SqliteFunction,
} from "./backend.js";

export { openDatabase } from "./connection.js";
export type {
  CheckpointController,
  DatabaseAccess,
  DatabaseRole,
  OpenDatabaseOptions,
  SqliteConnection,
  SqliteStatement,
} from "./types.js";
export type { DbHandle } from "./handle.js";

export {
  loadCanonicalSqlAsset,
  loadNamedQueries,
  loadQueryCatalog,
  lookupNamedQuery,
  QueryCatalog,
  resolveCanonicalSqlAsset,
} from "./query-catalog.js";
export type { ParsedQuery, SqlAssetKey } from "./query-catalog.js";
export { parseQueryCatalog } from "./sql.js";

export { runImmediateTx, runReadOnlyTx, runSavepoint } from "./transactions.js";
export type { SavepointOptions, TransactionOptions } from "./types.js";

export { WalCheckpointScheduler } from "./wal-checkpoint.js";
export type { CheckpointMode, WalCheckpointSchedulerOptions } from "./wal-checkpoint.js";

export { READER_TIMEOUT_LIMITS, ReaderPool, WorkerReaderPool } from "./reader-pool.js";
export type {
  ReaderPoolOptions,
  ReaderQuery,
  ReaderQueryClass,
  WorkerReaderPoolOptions,
} from "./reader-pool.js";

export type { RunResult, SqlParams, SqlValue } from "./values.js";
export { registerEfSearchText, splitSearchText } from "./search-text.js";
export type { SearchTextDriverConnection, SearchTextNativeDatabase, SearchTextTarget } from "./search-text.js";
