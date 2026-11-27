import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import type { SqliteConnection as DriverConnection } from "../driver/types.js";
import type { SqlValue } from "../driver/values.js";

export interface RegistryStatement {
  all(...params: SQLInputValue[]): Record<string, SQLOutputValue>[];
  get(...params: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;
  run(...params: SQLInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

export interface RegistryDatabase {
  exec(sql: string): void;
  prepare(sql: string): RegistryStatement;
}

export function registryDatabaseFromDriver(connection: DriverConnection): RegistryDatabase {
  return {
    exec(sql: string): void {
      connection.exec(sql);
    },
    prepare(sql: string): RegistryStatement {
      const statement = connection.prepare(sql);
      return {
        all(...params: SQLInputValue[]): Record<string, SQLOutputValue>[] {
          const rows = params.length === 0 ? statement.all() : statement.all(asParams(params));
          return rows.map(asRecord);
        },
        get(...params: SQLInputValue[]): Record<string, SQLOutputValue> | undefined {
          const row = params.length === 0 ? statement.get() : statement.get(asParams(params));
          if (row === undefined || row === null) return undefined;
          return asRecord(row);
        },
        run(...params: SQLInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
          return params.length === 0 ? statement.run() : statement.run(asParams(params));
        },
      };
    },
  };
}

function asParams(params: SQLInputValue[]): SqlValue[] {
  return params.map((value) => {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
      return value;
    }
    if (value instanceof Uint8Array) return value;
    throw new Error("Registry SQL parameter is not a supported value");
  });
}

function asRecord(value: unknown): Record<string, SQLOutputValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SQLite row was not an object");
  }
  const row: Record<string, SQLOutputValue> = {};
  for (const key of Object.keys(value)) {
    row[key] = asOutput(Reflect.get(value, key));
  }
  return row;
}

function asOutput(value: unknown): SQLOutputValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  throw new Error("SQLite cell is not a supported value");
}
