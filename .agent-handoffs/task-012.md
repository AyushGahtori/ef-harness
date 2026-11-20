---
task_id: "Task-012"
branch: "task/012-sqlite-driver-wrapper"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/driver/**"
  - "packages/db/tests/driver/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 012 handoff

SQLite driver wrapper for `node:sqlite` (`DatabaseSync`), with a pluggable `better-sqlite3` adapter hook, mandatory pragmas, `ef_search_text`, the canonical query catalog, immediate transactions, WAL checkpoints, and a time-bounded worker reader pool.

## Exports Provided

From `packages/db/src/driver/index.ts`:

- `openDatabase(options) -> SqliteConnection`
- `SqliteConnection` (`exec`, `prepare`, `get`, `all`, `run`, `pragma`, `registerFunction`, `close`)
- `SqliteStatement` (`get`, `all`, `run`, `iterate`, `finalize`)
- `RunResult` `{ changes, lastInsertRowid }`
- `QueryCatalog`, `loadQueryCatalog`, `parseQueryCatalog`
- `runImmediateTx`, `runSavepoint`, `runReadOnlyTx`
- `WalCheckpointScheduler`
- `WorkerReaderPool`, `READER_TIMEOUT_LIMITS` (`ui` 200 ms, `export` 2,000 ms)
- `createNodeSqliteBackend`, `createBetterSqlite3Backend`
- Errors: `AttachedDatabaseForbiddenError`, `WalModeRequiredError`, `PragmaMismatchError`, `DeferredBeginForbiddenError`, `NestedImmediateTransactionError`, `ForeignKeyConstraintError`, `SqliteBusyError`, `ConnectionClosedError`, `StatementFinalizedError`, `UnknownQueryError`, `DuplicateQueryNameError`, `ParameterMismatchError`, `ReaderBudgetError`, `ReaderTimeoutError`

`openDatabase` roles are `state`, `global`, `telemetry`, and `code-index`. Access is `writer` (default) or `readonly`.

Writer `state` and `global` connections set and read back `journal_mode=WAL` (on disk), `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`, `secure_delete=ON`, `journal_size_limit=67108864`, and `temp_store=MEMORY`. On-disk failure to stay in `wal` throws `WalModeRequiredError`. `:memory:` is allowed to remain `memory`.

`telemetry` and `code-index` writers set `journal_mode=WAL` and `synchronous=NORMAL`, plus `foreign_keys=ON` and `busy_timeout=5000`. Read-only opens set `query_only=ON` and `foreign_keys=ON`.

Every `state` connection, writer or read-only, registers deterministic `ef_search_text` before the caller can run schema SQL. The implementation calls `splitSearchText` from `@ef-harness/shared-contracts` when that barrel exports it, and otherwise uses the `schema/schema-test.js` `splitWords` algorithm.

`loadQueryCatalog` reads `schema/queries.sql` via `canonicalAssetAbsolute("queriesSql")` unless a SQL string or path is passed. Named parameters must match the extracted `:param` names; missing and extra keys throw `ParameterMismatchError` before execution.

`runImmediateTx` uses `BEGIN IMMEDIATE`, rolls back on throw, retries the whole transaction on `SQLITE_BUSY` with jitter (default 4 attempts), and turns a commit-time foreign-key failure into `ForeignKeyConstraintError` after `PRAGMA foreign_key_check` and rollback. Nested `BEGIN IMMEDIATE` throws. Bare `BEGIN` is rejected unless `query_only` is already on, which is how `runReadOnlyTx` starts a read transaction.

`ATTACH` is rejected in `exec` and `prepare`, denied by the SQLite authorizer, and capped with `limits.attach = 0`.

Integers are read as `BigInt` and converted back to JavaScript numbers only when they are inside `Number.MAX_SAFE_INTEGER`. Larger integers stay `BigInt`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is outside this task's write scope. The integration merge should add:

```ts
export {
  AttachedDatabaseForbiddenError,
  ConnectionClosedError,
  DeferredBeginForbiddenError,
  ForeignKeyConstraintError,
  NestedImmediateTransactionError,
  ParameterMismatchError,
  QueryCatalog,
  ReaderTimeoutError,
  SqliteBusyError,
  WalModeRequiredError,
  WalCheckpointScheduler,
  WorkerReaderPool,
  loadQueryCatalog,
  openDatabase,
  runImmediateTx,
  runReadOnlyTx,
  runSavepoint,
} from "./driver/index.js";
export type {
  DatabaseAccess,
  DatabaseRole,
  OpenDatabaseOptions,
  ReaderQuery,
  ReaderQueryClass,
  RunResult,
  SqliteConnection,
  SqliteStatement,
  SqlParams,
  SqlValue,
} from "./driver/index.js";
```

When Task 007 lands, export `splitSearchText` from `packages/shared-contracts/src/index.ts`. This driver already calls that export when it is present. No subpath import is used, because the layer rule forbids `@ef-harness/shared-contracts/canonical`.

## Dependency Intents (New Packages Requested)

None. `better-sqlite3` is not a package dependency. Callers pass a constructor to `createBetterSqlite3Backend`.

## Contract Change Requests

None.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-012-sqlite-driver-wrapper`:

- `pnpm --filter @ef-harness/shared-contracts build` — exit 0 (needed so Vitest can resolve the package exports).
- `pnpm --filter @ef-harness/db exec vitest run --config vitest.config.ts tests/driver` — 5 files, 24 tests, all passed. Covers writer/read-only/telemetry/code-index pragmas, `ef_search_text`, `WalModeRequiredError`, `ATTACH` rejection, deferred `BEGIN` rejection, safe and oversized integers, WAL truncate on close, the `better-sqlite3` adapter hook, `runImmediateTx` / `runSavepoint` / `runReadOnlyTx`, `SQLITE_BUSY` retry, commit-time foreign keys, every named query in `schema/queries.sql` prepared on `state` or `global`, parameter mismatch, an `state.sql` load with FTS `print AND rows` / `close AND 10`, checkpoint `PASSIVE` / `RESTART` / `TRUNCATE`, and `WorkerReaderPool` cancellation of `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT x FROM c` under a 200 ms UI budget with `wal_checkpoint(TRUNCATE)` returning `busy = 0`.
- `pnpm --filter @ef-harness/db exec tsc -b --pretty false` — exit 0.
- `pnpm --filter @ef-harness/db exec eslint src/driver tests/driver` — exit 0.
- `node schema/schema-test.js` — `67/67 passed · SQLite 3.53.0`.

## Known Limitations / Follow-Ups

`node:sqlite` on Node 24.16 does not expose `sqlite3_interrupt`. `worker.terminate()` does not abort a thread stuck inside `sqlite3_step`. The reader pool therefore runs statements with `iterate()`, stops when the deadline is reached, rolls the read transaction back in `finally`, then terminates that worker and opens a fresh one. The acceptance query yields one row per step and is cancelled on the 200 ms budget; the test allows 350 ms so worker startup and the reply message fit. An aggregate that never returns to JavaScript, such as `SELECT count(*)` over an infinite recursive CTE, still cannot be preempted until SQLite grows an interrupt API.

`code-index` writers use the telemetry profile (`WAL` + `synchronous=NORMAL`) plus `foreign_keys` and `busy_timeout`. The task text specified those two settings for telemetry only.

`WorkerReaderPool` requires a file database. `:memory:` cannot be shared with `worker_threads`. After `worker.terminate()` on Windows, opening the next worker retries `EBUSY` / `EPERM` style failures.

`close()` is idempotent. Later `exec`, `prepare`, `get`, `all`, `run`, and `pragma` calls throw `ConnectionClosedError`.
