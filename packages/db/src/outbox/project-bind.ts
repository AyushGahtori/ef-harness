import type { SqliteConnection } from "../driver/types.js";
import type { SqlValue as DriverSqlValue } from "../driver/values.js";
import type { ProjectStateDb } from "../state-db/project-state-db.js";
import type { OutboxConnection, OutboxStatement, SqlValue } from "./connection.js";
import { OutboxRepo, type OutboxRepoOptions } from "./repo.js";

/**
 * Bind the transactional outbox to the open `ProjectStateDb` writer.
 * The returned repo does not close that handle and does not open a second database.
 */
export function bindOutbox(
  stateDb: ProjectStateDb,
  options: Omit<OutboxRepoOptions, "connection"> = {},
): OutboxRepo {
  return new OutboxRepo({
    ...options,
    connection: outboxConnectionFromDriver(stateDb.writer),
  });
}

function outboxConnectionFromDriver(writer: SqliteConnection): OutboxConnection {
  return {
    get isTransaction() {
      return writer.inTransaction;
    },
    exec(sql: string): void {
      writer.exec(sql);
    },
    prepare(sql: string): OutboxStatement {
      const statement = writer.prepare(sql);
      return {
        run(params) {
          const result = statement.run(params === undefined ? undefined : toDriverParams(params));
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        },
        get(params) {
          const row = statement.get(params === undefined ? undefined : toDriverParams(params));
          if (row === undefined || row === null) return undefined;
          return toOutboxRow(row);
        },
        all(params) {
          const rows = statement.all(params === undefined ? undefined : toDriverParams(params));
          return rows.map((row) => toOutboxRow(row));
        },
      };
    },
  };
}

function toDriverParams(params: Readonly<Record<string, SqlValue>>): Record<string, DriverSqlValue> {
  const bound: Record<string, DriverSqlValue> = {};
  for (const key of Object.keys(params)) {
    bound[key] = params[key] ?? null;
  }
  return bound;
}

function toOutboxRow(value: unknown): Record<string, SqlValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SQLite row was not an object");
  }
  const row: Record<string, SqlValue> = {};
  for (const key of Object.keys(value)) {
    row[key] = toOutboxValue(Reflect.get(value, key));
  }
  return row;
}

function toOutboxValue(value: unknown): SqlValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  throw new Error("SQLite cell is not a supported outbox value");
}
