import { DatabaseSync } from "node:sqlite";
import {
  assertPragmaSource,
  normalizeRow,
  type BetterSqliteStatement,
  type BetterSqliteVendor,
  type SqlBindings,
  type SqlColumn,
  type SqlRow,
  type SqlRunResult,
  type SqliteFunction,
  type SqliteFunctionOptions,
} from "./driver.ts";

/**
 * In-process stand-in for `better-sqlite3`. It speaks that package's method
 * names (`pragma`, `function` via `createFunction`) while storing rows in
 * `node:sqlite`, so the fallback adapter can be parity-tested without a
 * native addon.
 */
export function openNodeBackedBetterSqliteVendor(location: string, timeout = 5000): BetterSqliteVendor {
  const db = new DatabaseSync(location, { timeout });

  function all(sql: string): SqlRow[] {
    return db.prepare(sql).all().map((row) => normalizeRow(row) ?? {});
  }

  return {
    get inTransaction() {
      return db.isTransaction;
    },
    exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string): BetterSqliteStatement {
      const statement = db.prepare(sql);
      return {
        run(params?: SqlBindings): SqlRunResult {
          const result = params === undefined
            ? statement.run()
            : Array.isArray(params)
              ? statement.run(...params)
              : statement.run(copyNamed(params));
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        },
        get(params?: SqlBindings): SqlRow | undefined {
          const row = params === undefined
            ? statement.get()
            : Array.isArray(params)
              ? statement.get(...params)
              : statement.get(copyNamed(params));
          return normalizeRow(row);
        },
        all(params?: SqlBindings): SqlRow[] {
          const rows = params === undefined
            ? statement.all()
            : Array.isArray(params)
              ? statement.all(...params)
              : statement.all(copyNamed(params));
          return rows.map((row) => normalizeRow(row) ?? {});
        },
        iterate(params?: SqlBindings): IterableIterator<SqlRow> {
          const iterator = params === undefined
            ? statement.iterate()
            : Array.isArray(params)
              ? statement.iterate(...params)
              : statement.iterate(copyNamed(params));
          return {
            next() {
              const step = iterator.next();
              if (step.done) return { done: true, value: undefined };
              return { done: false, value: normalizeRow(step.value) ?? {} };
            },
            return() {
              iterator.return?.();
              return { done: true, value: undefined };
            },
            [Symbol.iterator]() {
              return this;
            },
          };
        },
        columns(): readonly SqlColumn[] {
          return statement.columns().map((column) => ({
            name: column.name,
            type: column.type,
            table: column.table,
            database: column.database,
            column: column.column,
          }));
        },
      };
    },
    pragma(source: string): SqlRow[] {
      assertPragmaSource(source);
      const rows = all(`PRAGMA ${source}`);
      if (rows.length > 0 || source.includes("(") || !source.includes("=")) return rows;
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.trim())?.[0];
      if (!name) return rows;
      return all(`PRAGMA ${name}`);
    },
    createFunction(name: string, options: SqliteFunctionOptions, fn: SqliteFunction) {
      db.function(name, { deterministic: options.deterministic === true, varargs: true }, (...args) => {
        return fn(...args.map((arg) => {
          if (arg === null || typeof arg === "number" || typeof arg === "bigint" || typeof arg === "string") {
            return arg;
          }
          if (arg instanceof Uint8Array) return arg;
          throw new Error("sqlite returned a value the driver does not expose");
        }));
      });
    },
    close() {
      if (db.isOpen) db.close();
    },
  };
}

function copyNamed(params: { readonly [name: string]: import("./driver.ts").SqlValue }): Record<string, import("./driver.ts").SqlValue> {
  const named: Record<string, import("./driver.ts").SqlValue> = {};
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value !== undefined) named[key] = value;
  }
  return named;
}
