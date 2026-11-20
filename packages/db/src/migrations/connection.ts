import { createRequire } from "node:module";
import { efSearchText } from "./search-text.js";
import type { SqlRow, SqlValue, SqliteConnection, SqliteRunResult, SqliteStatement, TargetDb } from "./types.js";

const require = createRequire(import.meta.url);

interface NodeStatement {
  run(...params: readonly unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: readonly unknown[]): unknown;
  all(...params: readonly unknown[]): unknown[];
}

interface NodeDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
  function(
    name: string,
    options: { readonly deterministic?: boolean },
    fn: (...args: readonly unknown[]) => unknown,
  ): void;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (
    location: string,
    options?: { readonly readOnly?: boolean; readonly timeout?: number },
  ) => NodeDatabase;
}

function loadDatabaseSync(): NodeSqliteModule["DatabaseSync"] {
  const loaded = require("node:sqlite") as NodeSqliteModule;
  return loaded.DatabaseSync;
}

function normalizeSqlValue(value: unknown): SqlValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return String(value);
}

function materialize(row: unknown): SqlRow | undefined {
  if (row === undefined || row === null || typeof row !== "object") return undefined;
  const copy: { [column: string]: SqlValue | undefined } = {};
  for (const key of Object.keys(row)) {
    const value = (row as { readonly [column: string]: unknown })[key];
    copy[key] = normalizeSqlValue(value);
  }
  return copy;
}

class NodeSqliteStatement implements SqliteStatement {
  constructor(private readonly statement: NodeStatement) {}

  run(...params: readonly SqlValue[]): SqliteRunResult {
    const result = this.statement.run(...params);
    const changes = typeof result.changes === "bigint" ? Number(result.changes) : result.changes;
    return { changes, lastInsertRowid: result.lastInsertRowid };
  }

  get(...params: readonly SqlValue[]): SqlRow | undefined {
    return materialize(this.statement.get(...params));
  }

  all(...params: readonly SqlValue[]): SqlRow[] {
    const rows = this.statement.all(...params);
    const materialized: SqlRow[] = [];
    for (const row of rows) {
      const copy = materialize(row);
      if (copy) materialized.push(copy);
    }
    return materialized;
  }
}

class NodeSqliteConnection implements SqliteConnection {
  private closed = false;

  constructor(private readonly db: NodeDatabase) {}

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    return new NodeSqliteStatement(this.db.prepare(sql));
  }

  registerFunction(name: string, fn: (value: SqlValue) => SqlValue): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Unsafe SQL function name: ${name}`);
    }
    this.db.function(name, { deterministic: true }, (value: unknown) => {
      const normalized = normalizeSqlValue(value);
      return fn(normalized === undefined ? null : normalized);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

export interface OpenConnectionOptions {
  readonly readOnly: boolean;
  readonly targetDb: TargetDb;
  readonly registerSearch?: boolean;
  readonly searchText?: (value: SqlValue) => SqlValue;
}

/**
 * Open a SQLite file through node:sqlite.
 * Connection-local pragmas only: persistent pragmas are left untouched so a
 * version check or backup cannot rewrite the live file header.
 */
export function openNodeSqliteConnection(dbPath: string, options: OpenConnectionOptions): SqliteConnection {
  const DatabaseSync = loadDatabaseSync();
  const db = new DatabaseSync(dbPath, { readOnly: options.readOnly, timeout: 5_000 });
  const connection = new NodeSqliteConnection(db);
  connection.exec("PRAGMA foreign_keys = ON");
  connection.exec("PRAGMA busy_timeout = 5000");
  if (!options.readOnly && options.registerSearch !== false && options.targetDb === "state") {
    const search = options.searchText ?? efSearchText;
    connection.registerFunction("ef_search_text", search);
  }
  return connection;
}

export function createNodeSqliteConnectionFactory(
  overrides?: Pick<OpenConnectionOptions, "searchText" | "registerSearch">,
): { open(dbPath: string, options: { readonly readOnly: boolean; readonly targetDb: TargetDb }): SqliteConnection } {
  return {
    open(dbPath, options) {
      const openOptions: OpenConnectionOptions = {
        readOnly: options.readOnly,
        targetDb: options.targetDb,
        ...(overrides?.registerSearch !== undefined ? { registerSearch: overrides.registerSearch } : {}),
        ...(overrides?.searchText !== undefined ? { searchText: overrides.searchText } : {}),
      };
      return openNodeSqliteConnection(dbPath, openOptions);
    },
  };
}
