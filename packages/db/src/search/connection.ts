import type { DatabaseSync } from "node:sqlite";
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

function normalizeInteger(value: number | bigint): number {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error("SQLite change count exceeds the safe integer range");
    }
    return Number(value);
  }
  return value;
}
