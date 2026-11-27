import { constants, DatabaseSync, type StatementSync } from "node:sqlite";
import { type SqlParams, type SqlValue } from "./values.js";

export interface SqliteBackendOpenOptions {
  readonly location: string;
  readonly readOnly: boolean;
  readonly timeoutMs: number;
}

export interface SqliteBackendStatement {
  readonly sql: string;
  get(params: SqlParams | undefined): unknown;
  all(params: SqlParams | undefined): unknown[];
  run(params: SqlParams | undefined): { changes: number | bigint; lastInsertRowid: number | bigint };
  iterate(params: SqlParams | undefined): Iterable<unknown>;
  dispose(): void;
}

export type SqliteFunction = (...args: readonly unknown[]) => unknown;

export interface SqliteBackend {
  exec(sql: string): void;
  prepare(sql: string): SqliteBackendStatement;
  pragma(sql: string): unknown;
  registerFunction(name: string, fn: SqliteFunction, options: { readonly deterministic: boolean }): void;
  close(): void;
  readonly open: boolean;
  readonly inTransaction: boolean;
}

export type SqliteBackendFactory = (options: SqliteBackendOpenOptions) => SqliteBackend;

export interface BetterSqlite3Statement {
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
  run(...args: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  iterate?(...args: unknown[]): Iterable<unknown>;
  safeIntegers?(toggle?: boolean): this;
}

export interface BetterSqlite3Database {
  exec(sql: string): void;
  prepare(sql: string): BetterSqlite3Statement;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  function(name: string, options: { deterministic?: boolean }, fn: SqliteFunction): void;
  close(): void;
  readonly open: boolean;
  readonly inTransaction: boolean;
  defaultSafeIntegers?(toggle?: boolean): void;
}

export interface BetterSqlite3Constructor {
  new (
    filename: string,
    options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number },
  ): BetterSqlite3Database;
}

export function createNodeSqliteBackend(options: SqliteBackendOpenOptions): SqliteBackend {
  const db = new DatabaseSync(options.location, {
    readOnly: options.readOnly,
    timeout: options.timeoutMs,
    readBigInts: true,
    allowBareNamedParameters: true,
    allowUnknownNamedParameters: false,
    defensive: true,
    limits: { attach: 0 },
  });
  if (typeof db.setAuthorizer === "function") {
    db.setAuthorizer((actionCode) => {
      if (actionCode === constants.SQLITE_ATTACH) return constants.SQLITE_DENY;
      return constants.SQLITE_OK;
    });
  }
  return new NodeSqliteBackend(db);
}

export function createBetterSqlite3Backend(Database: BetterSqlite3Constructor): SqliteBackendFactory {
  return (options) => {
    const db = new Database(options.location, {
      readonly: options.readOnly,
      timeout: options.timeoutMs,
      ...(options.readOnly ? { fileMustExist: true } : {}),
    });
    if (typeof db.defaultSafeIntegers === "function") db.defaultSafeIntegers(true);
    return new BetterSqlite3Backend(db);
  };
}

class NodeSqliteBackend implements SqliteBackend {
  constructor(private readonly db: DatabaseSync) {}

  get open(): boolean {
    return this.db.isOpen;
  }

  get inTransaction(): boolean {
    return this.db.isTransaction;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): SqliteBackendStatement {
    const statement = this.db.prepare(sql);
    statement.setReadBigInts(true);
    statement.setAllowBareNamedParameters(true);
    statement.setAllowUnknownNamedParameters(false);
    return new NodeSqliteStatement(statement, sql);
  }

  pragma(sql: string): unknown {
    const statement = this.db.prepare(sql);
    statement.setReadBigInts(true);
    return statement.get();
  }

  registerFunction(name: string, fn: SqliteFunction, options: { readonly deterministic: boolean }): void {
    this.db.function(name, { deterministic: options.deterministic }, sqliteCallback(fn));
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}

class NodeSqliteStatement implements SqliteBackendStatement {
  constructor(
    private readonly statement: StatementSync,
    readonly sql: string,
  ) {}

  get(params: SqlParams | undefined): unknown {
    return bindStatement(params, {
      none: () => this.statement.get(),
      positional: (values) => this.statement.get(...values),
      named: (values) => this.statement.get(values),
    });
  }

  all(params: SqlParams | undefined): unknown[] {
    return bindStatement(params, {
      none: () => this.statement.all(),
      positional: (values) => this.statement.all(...values),
      named: (values) => this.statement.all(values),
    });
  }

  run(params: SqlParams | undefined): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return bindStatement(params, {
      none: () => this.statement.run(),
      positional: (values) => this.statement.run(...values),
      named: (values) => this.statement.run(values),
    });
  }

  iterate(params: SqlParams | undefined): Iterable<unknown> {
    return bindStatement(params, {
      none: () => this.statement.iterate(),
      positional: (values) => this.statement.iterate(...values),
      named: (values) => this.statement.iterate(values),
    });
  }

  dispose(): void {
    const disposable = this.statement as StatementSync & { [Symbol.dispose]?: () => void };
    disposable[Symbol.dispose]?.();
  }
}

class BetterSqlite3Backend implements SqliteBackend {
  constructor(private readonly db: BetterSqlite3Database) {}

  get open(): boolean {
    return this.db.open;
  }

  get inTransaction(): boolean {
    return this.db.inTransaction;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): SqliteBackendStatement {
    const statement = this.db.prepare(sql);
    if (typeof statement.safeIntegers === "function") statement.safeIntegers(true);
    return new BetterSqlite3StatementAdapter(statement, sql);
  }

  pragma(sql: string): unknown {
    const body = sql.replace(/^pragma\s+/i, "");
    const result = this.db.pragma(body);
    if (Array.isArray(result)) return result[0];
    return result;
  }

  registerFunction(name: string, fn: SqliteFunction, options: { readonly deterministic: boolean }): void {
    this.db.function(name, { deterministic: options.deterministic }, sqliteCallback(fn));
  }

  close(): void {
    if (this.db.open) this.db.close();
  }
}

class BetterSqlite3StatementAdapter implements SqliteBackendStatement {
  constructor(
    private readonly statement: BetterSqlite3Statement,
    readonly sql: string,
  ) {}

  get(params: SqlParams | undefined): unknown {
    return this.invoke("get", params);
  }

  all(params: SqlParams | undefined): unknown[] {
    const rows = this.invoke("all", params);
    return Array.isArray(rows) ? rows : [];
  }

  run(params: SqlParams | undefined): { changes: number | bigint; lastInsertRowid: number | bigint } {
    const result = this.invoke("run", params);
    if (result === null || typeof result !== "object") {
      return { changes: 0, lastInsertRowid: 0 };
    }
    const record = result as { changes?: number | bigint; lastInsertRowid?: number | bigint };
    return {
      changes: record.changes ?? 0,
      lastInsertRowid: record.lastInsertRowid ?? 0,
    };
  }

  iterate(params: SqlParams | undefined): Iterable<unknown> {
    if (typeof this.statement.iterate !== "function") {
      return this.all(params);
    }
    if (params === undefined) return this.statement.iterate();
    if (Array.isArray(params)) return this.statement.iterate(...params);
    return this.statement.iterate(params as Record<string, SqlValue>);
  }

  dispose(): void {
    return;
  }

  private invoke(method: "get" | "all" | "run", params: SqlParams | undefined): unknown {
    const fn = this.statement[method].bind(this.statement) as (...args: unknown[]) => unknown;
    if (params === undefined) return fn();
    if (Array.isArray(params)) return fn(...params);
    return fn(params as Record<string, SqlValue>);
  }
}

function bindStatement<T>(
  params: SqlParams | undefined,
  calls: {
    none: () => T;
    positional: (values: SqlValue[]) => T;
    named: (values: Record<string, SqlValue>) => T;
  },
): T {
  if (params === undefined) return calls.none();
  if (Array.isArray(params)) return calls.positional([...params]);
  return calls.named(params as Record<string, SqlValue>);
}

function sqliteCallback(fn: SqliteFunction): (...args: readonly unknown[]) => string | number | bigint | Uint8Array | null {
  const callback = (...args: readonly unknown[]) => coerceFunctionResult(fn(...args));
  Object.defineProperty(callback, "length", { value: fn.length });
  return callback;
}

function coerceFunctionResult(result: unknown): string | number | bigint | Uint8Array | null {
  if (result === undefined || result === null) return null;
  if (typeof result === "string" || typeof result === "number" || typeof result === "bigint") return result;
  if (result instanceof Uint8Array) return result;
  return String(result);
}
