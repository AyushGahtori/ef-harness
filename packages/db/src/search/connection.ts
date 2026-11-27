import type { DatabaseSync } from "node:sqlite";
import type { SqliteConnection as DriverConnection } from "../driver/types.js";
import type { SqliteConnection, SqliteStatement, SqlValue } from "./types.js";

/**
 * Adapt `node:sqlite` `DatabaseSync` to the Task 012 connection shape.
 * Bare named parameters match `schema/queries.sql` (`:nid` binds as `{ nid }`).
 */
export function asSqliteConnection(db: DatabaseSync): SqliteConnection {
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    prepare(sql: string): SqliteStatement {
      const statement = db.prepare(sql);
      statement.setAllowBareNamedParameters(true);
      return {
        all(params?: Readonly<Record<string, SqlValue>>) {
          const rows = params === undefined ? statement.all() : statement.all({ ...params });
          return rows.map((row) => ({ ...row }));
        },
        get(params?: Readonly<Record<string, SqlValue>>) {
          const row = params === undefined ? statement.get() : statement.get({ ...params });
          return row === undefined ? undefined : { ...row };
        },
        run(params?: Readonly<Record<string, SqlValue>>) {
          const result = params === undefined ? statement.run() : statement.run({ ...params });
          return {
            changes: normalizeInteger(result.changes),
            lastInsertRowid: result.lastInsertRowid,
          };
        },
      };
    },
  };
}

/** Adapt the shared `ProjectStateDb` writer to the search connection shape. */
export function searchConnectionFromDriver(connection: DriverConnection): SqliteConnection {
  return {
    exec(sql: string): void {
      connection.exec(sql);
    },
    prepare(sql: string): SqliteStatement {
      const statement = connection.prepare(sql);
      return {
        all(params?: Readonly<Record<string, SqlValue>>) {
          const rows = params === undefined ? statement.all() : statement.all({ ...params });
          return rows.map(asRecord);
        },
        get(params?: Readonly<Record<string, SqlValue>>) {
          const row = params === undefined ? statement.get() : statement.get({ ...params });
          if (row === undefined || row === null) return undefined;
          return asRecord(row);
        },
        run(params?: Readonly<Record<string, SqlValue>>) {
          const result = params === undefined ? statement.run() : statement.run({ ...params });
          return {
            changes: result.changes,
            lastInsertRowid: result.lastInsertRowid,
          };
        },
      };
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SQLite row was not an object");
  }
  return { ...value };
}

function normalizeInteger(value: number | bigint): number {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error("SQLite change count exceeds the safe integer range");
    }
    return Number(value);
  }
  return value;
}
