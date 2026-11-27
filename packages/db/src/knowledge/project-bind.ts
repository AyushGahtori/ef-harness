import type { SqliteConnection as DriverConnection } from "../driver/types.js";
import { loadCanonicalSqlAsset } from "../driver/query-catalog.js";
import type { RunResult, SqlValue as DriverSqlValue } from "../driver/values.js";
import type { ProjectStateDb } from "../state-db/project-state-db.js";
import { loadQueryCatalog } from "./query-catalog.js";
import { KnowledgeGraphRepo } from "./repo.js";
import type { SqlConnection, SqlRow, SqlStatement, SqlValue } from "./sql.js";

/**
 * Bind the graph writer to the open `ProjectStateDb` handle.
 * `close()` on the returned repo does not close that handle.
 */
export function bindKnowledgeGraph(stateDb: ProjectStateDb): KnowledgeGraphRepo {
  const connection = sqlConnectionFromDriver(stateDb.writer);
  const catalog = loadQueryCatalog(connection, loadCanonicalSqlAsset("queriesSql"));
  return new KnowledgeGraphRepo(connection, catalog);
}

export function sqlConnectionFromDriver(connection: DriverConnection): SqlConnection {
  return {
    exec(sql: string): void {
      connection.exec(sql);
    },
    prepare(sql: string): SqlStatement {
      const statement = connection.prepare(sql);
      return {
        all(params: Record<string, SqlValue> = {}): SqlRow[] {
          return statement.all(asDriverParams(params)).map(asRow);
        },
        get(params: Record<string, SqlValue> = {}): SqlRow | undefined {
          const row = statement.get(asDriverParams(params));
          if (row === undefined || row === null) return undefined;
          return asRow(row);
        },
        run(params: Record<string, SqlValue> = {}): { changes: number; lastInsertRowid: number } {
          return asRun(statement.run(asDriverParams(params)));
        },
      };
    },
    close(): void {
      return;
    },
  };
}

function asDriverParams(params: Record<string, SqlValue>): Record<string, DriverSqlValue> {
  const bound: Record<string, DriverSqlValue> = {};
  for (const key of Object.keys(params)) {
    bound[key] = asDriverValue(params[key]);
  }
  return bound;
}

function asDriverValue(value: SqlValue | undefined): DriverSqlValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  throw new Error("SQLite parameter is not a supported value");
}

function asRow(value: unknown): SqlRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SQLite row was not an object");
  }
  const row: SqlRow = {};
  for (const key of Object.keys(value)) {
    row[key] = asSqlValue(Reflect.get(value, key));
  }
  return row;
}

function asSqlValue(value: unknown): SqlValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  throw new Error("SQLite cell is not a supported value");
}

function asRun(result: RunResult): { changes: number; lastInsertRowid: number } {
  const lastInsertRowid = typeof result.lastInsertRowid === "bigint" ? Number(result.lastInsertRowid) : result.lastInsertRowid;
  if (!Number.isSafeInteger(lastInsertRowid)) {
    throw new Error("SQLite row id is outside the safe integer range");
  }
  return { changes: result.changes, lastInsertRowid };
}
