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
  DatabaseAccess,
  DatabaseRole,
  OpenDatabaseOptions,
  SqliteConnection,
  SqliteStatement,
} from "./connection.js";

export { loadQueryCatalog, QueryCatalog } from "./query-catalog.js";
export type { ParsedQuery } from "./query-catalog.js";
export { parseQueryCatalog } from "./sql.js";

export { runImmediateTx, runReadOnlyTx, runSavepoint } from "./transactions.js";
export type { SavepointOptions, TransactionOptions } from "./transactions.js";

export { WalCheckpointScheduler } from "./wal-checkpoint.js";
export type { CheckpointMode, WalCheckpointSchedulerOptions } from "./wal-checkpoint.js";

export { READER_TIMEOUT_LIMITS, WorkerReaderPool } from "./reader-pool.js";
export type { ReaderQuery, ReaderQueryClass, WorkerReaderPoolOptions } from "./reader-pool.js";

export type { RunResult, SqlParams, SqlValue } from "./values.js";
export { resolveSplitSearchText, splitSearchTextFallback } from "./search-text.js";
