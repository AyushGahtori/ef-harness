import { DatabaseSync, type SQLInputValue, type SQLOutputValue, type StatementSync } from "node:sqlite";

/**
 * Vendor-neutral driver surface for Task 012.
 * `node:sqlite` has no `pragma()` or `transaction()` helper. Callers use
 * `pragma()`, `beginImmediate()`, and `savepoint()` here so a `better-sqlite3`
 * adapter can implement the same methods without leaking either vendor type.
 */
export type SqlValue = null | number | bigint | string | Uint8Array;

export interface SqlRow {
  readonly [column: string]: SqlValue;
}

export interface SqlRunResult {
  readonly changes: number | bigint;
  readonly lastInsertRowid: number | bigint;
}

export interface SqlColumn {
  readonly name: string;
  readonly type: string | null;
  readonly table: string | null;
  readonly database: string | null;
  readonly column: string | null;
}

export interface SqlBindingsRecord {
  readonly [name: string]: SqlValue;
}

export type SqlBindings = SqlBindingsRecord | readonly SqlValue[];

export interface PrepareOptions {
  readonly readBigInts?: boolean;
  readonly allowBareNamedParameters?: boolean;
}

export interface SqlStatement {
  run(params?: SqlBindings): SqlRunResult;
  get(params?: SqlBindings): SqlRow | undefined;
  all(params?: SqlBindings): SqlRow[];
  iterate(params?: SqlBindings): IterableIterator<SqlRow>;
  columns(): readonly SqlColumn[];
  close(): void;
}

export interface SqlTransaction {
  readonly kind: "immediate";
  commit(): void;
  rollback(): void;
}

export interface SqlSavepoint {
  readonly name: string;
  release(): void;
  rollback(): void;
}

export interface SqliteFunctionOptions {
  readonly deterministic?: boolean;
}

export type SqliteFunction = (...args: SqlValue[]) => SqlValue;

export interface SqliteDriver {
  exec(sql: string): void;
  prepare(sql: string, options?: PrepareOptions): SqlStatement;
  pragma(source: string): SqlRow[];
  beginImmediate(): SqlTransaction;
  savepoint(name: string): SqlSavepoint;
  registerFunction(name: string, fn: SqliteFunction, options?: SqliteFunctionOptions): void;
  close(): void;
  readonly open: boolean;
}

export interface OpenOptions {
  readonly busyTimeoutMs?: number;
  readonly readOnly?: boolean;
  readonly applyHarnessPragmas?: boolean;
}

/**
 * Connection settings from schema/state.sql. `journal_mode = WAL` stays
 * `memory` for `:memory:` databases; file databases report `wal`.
 */
export const HARNESS_PRAGMAS = [
  "journal_mode = WAL",
  "synchronous = FULL",
  "foreign_keys = ON",
  "busy_timeout = 5000",
  "secure_delete = ON",
  "journal_size_limit = 67108864",
  "temp_store = MEMORY",
] as const;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PRAGMA_SOURCE =
  /^[A-Za-z_][A-Za-z0-9_]*(\s*\(\s*[A-Za-z0-9_]*\s*\)|\s*=\s*[A-Za-z0-9_]+)?$/;

export function assertIdentifier(name: string, label: string): void {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`${label} must be a bare SQL identifier`);
  }
}

export function assertPragmaSource(source: string): void {
  if (!PRAGMA_SOURCE.test(source.trim())) {
    throw new Error(`refusing unsafe pragma source: ${source}`);
  }
}

/**
 * Reject a statement that starts a deferred or bare transaction.
 * Trigger bodies also contain `BEGIN`, so only a statement whose first
 * keyword is `BEGIN` counts.
 */
export function assertImmediateWriteSql(sql: string): void {
  const stripped = sql
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/--[^\n]*/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const statement of stripped.split(";")) {
    const match = /^\s*BEGIN(\s+(IMMEDIATE|DEFERRED|EXCLUSIVE))?\b/i.exec(statement);
    if (match && match[2]?.toUpperCase() !== "IMMEDIATE") {
      throw new Error("write transactions must use beginImmediate() so BEGIN cannot upgrade from deferred");
    }
  }
}

export function normalizeValue(value: SQLOutputValue): SqlValue {
  if (value === null || typeof value === "number" || typeof value === "bigint" || typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  throw new Error("sqlite returned a value the driver does not expose");
}

export function normalizeRow(row: Record<string, SQLOutputValue> | undefined): SqlRow | undefined {
  if (row === undefined) return undefined;
  const copy: { [column: string]: SqlValue } = {};
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (value !== undefined) copy[key] = normalizeValue(value);
  }
  return copy;
}

function namedRecord(params: SqlBindingsRecord): Record<string, SQLInputValue> {
  const named: Record<string, SQLInputValue> = {};
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value !== undefined) named[key] = value;
  }
  return named;
}

function pragmaName(source: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.trim())?.[0] ?? "";
}

class CursorStatement implements SqlStatement {
  private iterator: Iterator<Record<string, SQLOutputValue>> | undefined;

  private readonly statement: StatementSync;

  constructor(statement: StatementSync) {
    this.statement = statement;
  }

  run(params?: SqlBindings): SqlRunResult {
    this.releaseCursor();
    const result = invokeRun(this.statement, params);
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }

  get(params?: SqlBindings): SqlRow | undefined {
    this.releaseCursor();
    return normalizeRow(invokeGet(this.statement, params));
  }

  all(params?: SqlBindings): SqlRow[] {
    this.releaseCursor();
    return invokeAll(this.statement, params).map((row) => normalizeRow(row) ?? {});
  }

  iterate(params?: SqlBindings): IterableIterator<SqlRow> {
    this.releaseCursor();
    const iterator = invokeIterate(this.statement, params);
    this.iterator = iterator;
    const release = () => {
      this.releaseCursor();
    };
    return {
      next: () => {
        const step = iterator.next();
        if (step.done) {
          this.iterator = undefined;
          return { done: true, value: undefined };
        }
        return { done: false, value: normalizeRow(step.value) ?? {} };
      },
      return: () => {
        release();
        return { done: true, value: undefined };
      },
      [Symbol.iterator]() {
        return this;
      },
    };
  }

  columns(): readonly SqlColumn[] {
    return this.statement.columns().map((column) => ({
      name: column.name,
      type: column.type,
      table: column.table,
      database: column.database,
      column: column.column,
    }));
  }

  close(): void {
    this.releaseCursor();
  }

  private releaseCursor(): void {
    this.iterator?.return?.();
    this.iterator = undefined;
  }
}

function invokeRun(statement: StatementSync, params?: SqlBindings): { changes: number | bigint; lastInsertRowid: number | bigint } {
  if (params === undefined) return statement.run();
  if (Array.isArray(params)) return statement.run(...params);
  return statement.run(namedRecord(params));
}

function invokeGet(statement: StatementSync, params?: SqlBindings): Record<string, SQLOutputValue> | undefined {
  if (params === undefined) return statement.get();
  if (Array.isArray(params)) return statement.get(...params);
  return statement.get(namedRecord(params));
}

function invokeAll(statement: StatementSync, params?: SqlBindings): Record<string, SQLOutputValue>[] {
  if (params === undefined) return statement.all();
  if (Array.isArray(params)) return statement.all(...params);
  return statement.all(namedRecord(params));
}

function invokeIterate(statement: StatementSync, params?: SqlBindings): Iterator<Record<string, SQLOutputValue>> {
  if (params === undefined) return statement.iterate();
  if (Array.isArray(params)) return statement.iterate(...params);
  return statement.iterate(namedRecord(params));
}

function nodePrepareOptions(options: PrepareOptions | undefined): PrepareOptions | undefined {
  if (!options) return undefined;
  const next: { readBigInts?: boolean; allowBareNamedParameters?: boolean } = {};
  if (options.readBigInts !== undefined) next.readBigInts = options.readBigInts;
  if (options.allowBareNamedParameters !== undefined) {
    next.allowBareNamedParameters = options.allowBareNamedParameters;
  }
  return next.readBigInts === undefined && next.allowBareNamedParameters === undefined ? undefined : next;
}

class NodeSqliteDriver implements SqliteDriver {
  private readonly statements: CursorStatement[] = [];
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get open(): boolean {
    return this.db.isOpen;
  }

  exec(sql: string): void {
    assertImmediateWriteSql(sql);
    this.db.exec(sql);
  }

  prepare(sql: string, options?: PrepareOptions): SqlStatement {
    const prepared = nodePrepareOptions(options);
    const statement = prepared ? this.db.prepare(sql, prepared) : this.db.prepare(sql);
    const wrapped = new CursorStatement(statement);
    this.statements.push(wrapped);
    return wrapped;
  }

  pragma(source: string): SqlRow[] {
    assertPragmaSource(source);
    const rows = this.prepare(`PRAGMA ${source}`).all();
    if (rows.length > 0 || source.includes("(") || !source.includes("=")) return rows;
    const name = pragmaName(source);
    if (!name) return rows;
    return this.prepare(`PRAGMA ${name}`).all();
  }

  beginImmediate(): SqlTransaction {
    if (this.db.isTransaction) {
      throw new Error("a transaction is already open; use savepoint() to nest");
    }
    this.exec("BEGIN IMMEDIATE");
    let settled = false;
    const db = this.db;
    return {
      kind: "immediate",
      commit() {
        if (settled) throw new Error("transaction already settled");
        db.exec("COMMIT");
        settled = true;
      },
      rollback() {
        if (settled) throw new Error("transaction already settled");
        if (db.isTransaction) db.exec("ROLLBACK");
        settled = true;
      },
    };
  }

  savepoint(name: string): SqlSavepoint {
    assertIdentifier(name, "savepoint");
    this.exec(`SAVEPOINT ${name}`);
    let settled = false;
    const db = this.db;
    return {
      name,
      release() {
        if (settled) throw new Error("savepoint already settled");
        db.exec(`RELEASE ${name}`);
        settled = true;
      },
      rollback() {
        if (settled) throw new Error("savepoint already settled");
        db.exec(`ROLLBACK TO ${name}`);
        db.exec(`RELEASE ${name}`);
        settled = true;
      },
    };
  }

  registerFunction(name: string, fn: SqliteFunction, options?: SqliteFunctionOptions): void {
    assertIdentifier(name, "function");
    this.db.function(
      name,
      { deterministic: options?.deterministic === true, varargs: true },
      (...args) => {
        const mapped = args.map((arg) => normalizeValue(arg));
        return fn(...mapped);
      },
    );
  }

  close(): void {
    for (const statement of this.statements) statement.close();
    this.statements.length = 0;
    if (this.db.isOpen) this.db.close();
  }
}

export function applyHarnessPragmas(driver: SqliteDriver, includeJournalMode: boolean): void {
  for (const source of HARNESS_PRAGMAS) {
    if (!includeJournalMode && source.startsWith("journal_mode")) continue;
    driver.pragma(source);
  }
}

export function openNodeSqliteDriver(location: string, options?: OpenOptions): SqliteDriver {
  const apply = options?.applyHarnessPragmas !== false;
  const readOnly = options?.readOnly === true;
  const timeout = options?.busyTimeoutMs ?? 5000;
  const db = new DatabaseSync(location, { readOnly, timeout });
  const driver = new NodeSqliteDriver(db);
  if (apply && !readOnly) applyHarnessPragmas(driver, location !== ":memory:");
  return driver;
}

export interface BetterSqliteStatement {
  run(params?: SqlBindings): SqlRunResult;
  get(params?: SqlBindings): SqlRow | undefined;
  all(params?: SqlBindings): SqlRow[];
  iterate(params?: SqlBindings): IterableIterator<SqlRow>;
  columns(): readonly SqlColumn[];
}

/**
 * Structural slice of `better-sqlite3` used by the fallback adapter.
 * `createFunction` maps to `Database#function`. The adapter never imports
 * that package, so the default path stays free of native `.node` addons.
 */
export interface BetterSqliteVendor {
  exec(sql: string): void;
  prepare(sql: string): BetterSqliteStatement;
  pragma(source: string): readonly SqlRow[];
  createFunction(name: string, options: SqliteFunctionOptions, fn: SqliteFunction): void;
  close(): void;
  readonly inTransaction: boolean;
}

export function openBetterSqlite3Driver(vendor: BetterSqliteVendor): SqliteDriver {
  const statements: SqlStatement[] = [];
  let opened = true;
  return {
    get open() {
      return opened;
    },
    exec(sql: string) {
      assertImmediateWriteSql(sql);
      vendor.exec(sql);
    },
    prepare(sql: string, options?: PrepareOptions) {
      if (options) {
        throw new Error("the fallback adapter does not take per-statement node:sqlite options");
      }
      const statement = vendor.prepare(sql);
      let iterator: IterableIterator<SqlRow> | undefined;
      const release = () => {
        iterator?.return?.();
        iterator = undefined;
      };
      const wrapped: SqlStatement = {
        run(params) {
          release();
          return statement.run(params);
        },
        get(params) {
          release();
          return statement.get(params);
        },
        all(params) {
          release();
          return statement.all(params);
        },
        iterate(params) {
          release();
          iterator = statement.iterate(params);
          return iterator;
        },
        columns: () => statement.columns(),
        close: release,
      };
      statements.push(wrapped);
      return wrapped;
    },
    pragma(source: string) {
      assertPragmaSource(source);
      return [...vendor.pragma(source)];
    },
    beginImmediate() {
      if (vendor.inTransaction) {
        throw new Error("a transaction is already open; use savepoint() to nest");
      }
      vendor.exec("BEGIN IMMEDIATE");
      let settled = false;
      return {
        kind: "immediate" as const,
        commit() {
          if (settled) throw new Error("transaction already settled");
          vendor.exec("COMMIT");
          settled = true;
        },
        rollback() {
          if (settled) throw new Error("transaction already settled");
          vendor.exec("ROLLBACK");
          settled = true;
        },
      };
    },
    savepoint(name: string) {
      assertIdentifier(name, "savepoint");
      vendor.exec(`SAVEPOINT ${name}`);
      let settled = false;
      return {
        name,
        release() {
          if (settled) throw new Error("savepoint already settled");
          vendor.exec(`RELEASE ${name}`);
          settled = true;
        },
        rollback() {
          if (settled) throw new Error("savepoint already settled");
          vendor.exec(`ROLLBACK TO ${name}`);
          vendor.exec(`RELEASE ${name}`);
          settled = true;
        },
      };
    },
    registerFunction(name: string, fn: SqliteFunction, options?: SqliteFunctionOptions) {
      assertIdentifier(name, "function");
      vendor.createFunction(name, { deterministic: options?.deterministic === true }, fn);
    },
    close() {
      for (const statement of statements) statement.close();
      statements.length = 0;
      opened = false;
      vendor.close();
    },
  };
}

export function sqlText(row: SqlRow | undefined, column: string): string {
  const value = row?.[column];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  throw new Error(`column ${column} was not text`);
}

export function sqlNumber(row: SqlRow | undefined, column: string): number {
  const value = row?.[column];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`column ${column} was not a number`);
}
