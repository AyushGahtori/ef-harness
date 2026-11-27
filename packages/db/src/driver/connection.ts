import {
  createNodeSqliteBackend,
  type SqliteBackend,
  type SqliteBackendStatement,
  type SqliteFunction,
} from "./backend.js";
import {
  AttachedDatabaseForbiddenError,
  ConnectionClosedError,
  DeferredBeginForbiddenError,
  NestedImmediateTransactionError,
  PragmaMismatchError,
  StatementFinalizedError,
  WalModeRequiredError,
} from "./errors.js";
import { registerEfSearchText } from "./search-text.js";
import { bindParameters, inspectSql, isMemoryLocation, isMutatingSql } from "./sql.js";
import { runImmediateTx, runSavepoint } from "./transactions.js";
import type {
  CheckpointController,
  DatabaseAccess,
  DatabaseRole,
  OpenDatabaseOptions,
  SavepointOptions,
  SqliteConnection,
  SqliteStatement,
  TransactionOptions,
} from "./types.js";
import { firstCell, normalizeCell, normalizeRunResult, pragmaEquals, type RunResult, type SqlParams } from "./values.js";

export type {
  CheckpointController,
  DatabaseAccess,
  DatabaseRole,
  OpenDatabaseOptions,
  SqliteConnection,
  SqliteStatement,
};

const WRITER_PRAGMAS = [
  ["synchronous", 2],
  ["foreign_keys", 1],
  ["busy_timeout", 5000],
  ["secure_delete", 1],
  ["journal_size_limit", 67108864],
  ["temp_store", 2],
] as const;

export function openDatabase(options: OpenDatabaseOptions): SqliteConnection {
  const access = options.access ?? "writer";
  const factory = options.backend ?? createNodeSqliteBackend;
  const backend = factory({
    location: options.location,
    readOnly: access === "readonly",
    timeoutMs: 5000,
  });
  try {
    applyConnectionPragmas(backend, options.role, access, options.location);
    const connection = new SqliteDatabase(options.location, options.role, access, backend);
    if (options.role === "state") {
      registerEfSearchText(connection);
    }
    return connection;
  } catch (error) {
    closeQuietly(backend);
    throw error;
  }
}

class SqliteDatabase implements SqliteConnection {
  readonly #listeners = new Set<() => void>();
  readonly #statements = new Set<TrackedStatement>();
  #scheduler: CheckpointController | undefined;
  #closed = false;
  #immediate = false;

  constructor(
    readonly location: string,
    readonly role: DatabaseRole,
    readonly access: DatabaseAccess,
    private readonly backend: SqliteBackend,
  ) {}

  get open(): boolean {
    return !this.#closed && this.backend.open;
  }

  get inTransaction(): boolean {
    return this.backend.inTransaction;
  }

  get inImmediateTransaction(): boolean {
    return this.#immediate && this.backend.inTransaction;
  }

  exec(sql: string): void {
    this.beforeExecute(sql);
    this.backend.exec(sql);
    this.afterExecute(sql);
    if (isMutatingSql(sql)) this.emitWrite();
  }

  prepare(sql: string): SqliteStatement {
    this.beforeExecute(sql);
    const raw = this.backend.prepare(sql);
    const statement = new TrackedStatement(this, raw);
    this.#statements.add(statement);
    return statement;
  }

  get(sql: string, params?: SqlParams): unknown {
    const statement = this.prepare(sql);
    try {
      return statement.get(params);
    } finally {
      statement.finalize();
    }
  }

  all(sql: string, params?: SqlParams): unknown[] {
    const statement = this.prepare(sql);
    try {
      return statement.all(params);
    } finally {
      statement.finalize();
    }
  }

  run(sql: string, params?: SqlParams): RunResult {
    const statement = this.prepare(sql);
    try {
      return statement.run(params);
    } finally {
      statement.finalize();
    }
  }

  pragma(source: string): unknown {
    this.assertOpen();
    const sql = /^pragma\b/i.test(source.trim()) ? source.trim() : `PRAGMA ${source.trim()}`;
    if (inspectSql(sql).attach) throw new AttachedDatabaseForbiddenError();
    return normalizeCell(this.backend.pragma(sql));
  }

  registerFunction(name: string, fn: SqliteFunction, options?: { deterministic?: boolean }): void {
    this.assertOpen();
    this.backend.registerFunction(name, fn, { deterministic: options?.deterministic ?? false });
  }

  transaction<T>(work: () => T, options?: TransactionOptions): T {
    return runImmediateTx(this, work, options);
  }

  savepoint<T>(work: () => T, options?: SavepointOptions): T {
    return runSavepoint(this, work, options);
  }

  addWriteListener(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  attachCheckpointScheduler(scheduler: CheckpointController): void {
    this.#scheduler = scheduler;
  }

  close(options?: { readonly skipCheckpoint?: boolean }): void {
    if (this.#closed) return;
    this.#scheduler?.stop();
    this.#scheduler = undefined;
    for (const statement of this.#statements) statement.finalize();
    this.#statements.clear();
    if (
      !options?.skipCheckpoint &&
      this.access === "writer" &&
      !isMemoryLocation(this.location) &&
      this.backend.open &&
      !this.backend.inTransaction
    ) {
      try {
        this.backend.pragma("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch (checkpointError: unknown) {
        closeQuietly(this.backend);
        this.#closed = true;
        throw checkpointError;
      }
    }
    this.backend.close();
    this.#closed = true;
  }

  beforeExecute(sql: string): void {
    this.assertOpen();
    const inspection = inspectSql(sql);
    if (inspection.attach) throw new AttachedDatabaseForbiddenError();
    if (inspection.deferredBegin && !this.isQueryOnly()) throw new DeferredBeginForbiddenError();
    if (inspection.immediateBegin && this.inImmediateTransaction) {
      throw new NestedImmediateTransactionError();
    }
  }

  afterExecute(sql: string): void {
    if (!this.backend.inTransaction) {
      this.#immediate = false;
      return;
    }
    if (inspectSql(sql).immediateBegin) this.#immediate = true;
  }

  emitWrite(): void {
    for (const listener of this.#listeners) listener();
  }

  forget(statement: TrackedStatement): void {
    this.#statements.delete(statement);
  }

  private assertOpen(): void {
    if (!this.open) throw new ConnectionClosedError();
  }

  private isQueryOnly(): boolean {
    return pragmaEquals(firstCell(this.backend.pragma("PRAGMA query_only")), 1);
  }
}

class TrackedStatement implements SqliteStatement {
  #finalized = false;

  constructor(
    private readonly connection: SqliteDatabase,
    private readonly raw: SqliteBackendStatement,
  ) {}

  get sql(): string {
    return this.raw.sql;
  }

  get(params?: SqlParams): unknown {
    return normalizeCell(this.invoke("get", params));
  }

  all(params?: SqlParams): unknown[] {
    const rows = this.invoke("all", params);
    return Array.isArray(rows) ? rows.map((row) => normalizeCell(row)) : [];
  }

  run(params?: SqlParams): RunResult {
    const result = this.invoke("run", params) as {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
    this.connection.afterExecute(this.sql);
    const normalized = normalizeRunResult(result);
    if (normalized.changes > 0 || isMutatingSql(this.sql)) this.connection.emitWrite();
    return normalized;
  }

  iterate(params?: SqlParams): Iterable<unknown> {
    this.assertUsable();
    this.connection.beforeExecute(this.sql);
    const bound = bindParameters(this.sql, params);
    const iterator = this.raw.iterate(bound);
    const connection = this.connection;
    const sql = this.sql;
    return {
      [Symbol.iterator]() {
        const inner = iterator[Symbol.iterator]();
        return {
          next() {
            const step = inner.next();
            if (step.done === true) connection.afterExecute(sql);
            return step.done === true ? step : { done: false, value: normalizeCell(step.value) };
          },
        };
      },
    };
  }

  finalize(): void {
    if (this.#finalized) return;
    this.#finalized = true;
    this.raw.dispose();
    this.connection.forget(this);
  }

  private invoke(method: "get" | "all" | "run", params: SqlParams | undefined): unknown {
    this.assertUsable();
    this.connection.beforeExecute(this.sql);
    const bound = bindParameters(this.sql, params);
    try {
      const result = this.raw[method](bound);
      if (method !== "run") {
        this.connection.afterExecute(this.sql);
        if (isMutatingSql(this.sql)) this.connection.emitWrite();
      }
      return result;
    } catch (error) {
      this.connection.afterExecute(this.sql);
      throw error;
    }
  }

  private assertUsable(): void {
    if (!this.connection.open) throw new ConnectionClosedError();
    if (this.#finalized) throw new StatementFinalizedError();
  }
}

function applyConnectionPragmas(
  backend: SqliteBackend,
  role: DatabaseRole,
  access: DatabaseAccess,
  location: string,
): void {
  if (access === "readonly") {
    backend.exec("PRAGMA query_only = ON");
    backend.exec("PRAGMA foreign_keys = ON");
    expectPragma(backend, "query_only", 1);
    expectPragma(backend, "foreign_keys", 1);
    return;
  }
  const reported = firstCell(backend.pragma("PRAGMA journal_mode = WAL"));
  const persisted = firstCell(backend.pragma("PRAGMA journal_mode"));
  const mode = String(persisted ?? reported ?? "").toLowerCase();
  if (!isMemoryLocation(location) && mode !== "wal") {
    throw new WalModeRequiredError(location, mode === "" ? "(empty)" : mode);
  }
  if (role === "state" || role === "global") {
    backend.exec("PRAGMA synchronous = FULL");
    backend.exec("PRAGMA foreign_keys = ON");
    backend.exec("PRAGMA busy_timeout = 5000");
    backend.exec("PRAGMA secure_delete = ON");
    backend.exec("PRAGMA journal_size_limit = 67108864");
    backend.exec("PRAGMA temp_store = MEMORY");
    for (const [name, expected] of WRITER_PRAGMAS) expectPragma(backend, name, expected);
    if (!isMemoryLocation(location)) expectPragma(backend, "journal_mode", "wal");
    return;
  }
  backend.exec("PRAGMA synchronous = NORMAL");
  backend.exec("PRAGMA foreign_keys = ON");
  backend.exec("PRAGMA busy_timeout = 5000");
  expectPragma(backend, "synchronous", 1);
  expectPragma(backend, "foreign_keys", 1);
  expectPragma(backend, "busy_timeout", 5000);
  if (!isMemoryLocation(location)) expectPragma(backend, "journal_mode", "wal");
}

function expectPragma(backend: SqliteBackend, name: string, expected: string | number): void {
  const actual = firstCell(backend.pragma(`PRAGMA ${name}`));
  if (!pragmaEquals(actual, expected)) throw new PragmaMismatchError(name, expected, actual);
}

function closeQuietly(backend: SqliteBackend): void {
  try {
    backend.close();
  } catch (closeError: unknown) {
    const message = closeError instanceof Error ? closeError.message : "";
    void message;
  }
}
