import type { SqliteConnection as DriverConnection } from "./types.js";
import type { RunResult, SqlValue as DriverSqlValue } from "./values.js";

export type PortSqlValue = string | number | bigint | Uint8Array | null;

export interface PortRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number;
}

export interface PortStatement {
  run(params?: Readonly<Record<string, PortSqlValue>>): PortRunResult;
  get(params?: Readonly<Record<string, PortSqlValue>>): Readonly<Record<string, PortSqlValue>> | undefined;
  all(params?: Readonly<Record<string, PortSqlValue>>): Readonly<Record<string, PortSqlValue>>[];
}

export interface PortConnection {
  exec(sql: string): void;
  prepare(sql: string): PortStatement;
}

/**
 * Named-parameter port over the open driver writer.
 * `ProjectStateDb.close()` is the only close; this port does not own the handle.
 */
export function namedConnectionFromDriver(connection: DriverConnection): PortConnection {
  return {
    exec(sql: string): void {
      connection.exec(sql);
    },
    prepare(sql: string): PortStatement {
      const statement = connection.prepare(sql);
      return {
        all(params?: Readonly<Record<string, PortSqlValue>>): Readonly<Record<string, PortSqlValue>>[] {
          return statement.all(asDriverParams(params)).map(asRow);
        },
        get(params?: Readonly<Record<string, PortSqlValue>>): Readonly<Record<string, PortSqlValue>> | undefined {
          const row = statement.get(asDriverParams(params));
          if (row === undefined || row === null) return undefined;
          return asRow(row);
        },
        run(params?: Readonly<Record<string, PortSqlValue>>): PortRunResult {
          return asRun(statement.run(asDriverParams(params)));
        },
      };
    },
  };
}

function asDriverParams(
  params: Readonly<Record<string, PortSqlValue>> | undefined,
): Record<string, DriverSqlValue> {
  const bound: Record<string, DriverSqlValue> = {};
  if (params === undefined) return bound;
  for (const key of Object.keys(params)) {
    bound[key] = asDriverValue(params[key]);
  }
  return bound;
}

function asDriverValue(value: PortSqlValue | undefined): DriverSqlValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  throw new Error("SQLite parameter is not a supported value");
}

function asRow(value: unknown): Readonly<Record<string, PortSqlValue>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SQLite row was not an object");
  }
  const row: Record<string, PortSqlValue> = {};
  for (const key of Object.keys(value)) {
    row[key] = asSqlValue(Reflect.get(value, key));
  }
  return row;
}

function asSqlValue(value: unknown): PortSqlValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  throw new Error("SQLite cell is not a supported value");
}

function asRun(result: RunResult): PortRunResult {
  const lastInsertRowid =
    typeof result.lastInsertRowid === "bigint" ? Number(result.lastInsertRowid) : result.lastInsertRowid;
  if (!Number.isSafeInteger(lastInsertRowid)) {
    throw new Error("SQLite row id is outside the safe integer range");
  }
  return { changes: result.changes, lastInsertRowid };
}
