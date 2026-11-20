import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { HintLadderError } from "./errors.js";

export type SqlValue = SQLInputValue;

export interface PreparedStatement {
  get(params?: Record<string, SqlValue>): Record<string, SqlValue> | undefined;
  all(params?: Record<string, SqlValue>): Record<string, SqlValue>[];
  run(params?: Record<string, SqlValue>): { changes: number };
}

export interface StateDbPort {
  exec(sql: string): void;
  prepare(sql: string): PreparedStatement;
}

export function bindDatabaseSync(db: DatabaseSync): StateDbPort {
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    prepare(sql: string): PreparedStatement {
      const statement = db.prepare(sql);
      return {
        get(params?: Record<string, SqlValue>): Record<string, SqlValue> | undefined {
          const row = params ? statement.get(params) : statement.get();
          return row ? normalizeRow(row) : undefined;
        },
        all(params?: Record<string, SqlValue>): Record<string, SqlValue>[] {
          const rows = params ? statement.all(params) : statement.all();
          return rows.map((row) => normalizeRow(row));
        },
        run(params?: Record<string, SqlValue>): { changes: number } {
          const result = params ? statement.run(params) : statement.run();
          const changes = result.changes;
          return { changes: typeof changes === "bigint" ? Number(changes) : changes };
        },
      };
    },
  };
}

export function immediateTransaction<T>(db: StateDbPort, body: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = body();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      throw new HintLadderError("failed to roll back hint-ladder transaction", {
        cause: rollbackError,
      });
    }
    throw error;
  }
}

export function numberValue(row: Record<string, SqlValue>, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new HintLadderError(`column ${key} is not a number`);
}

export function stringValue(row: Record<string, SqlValue>, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new HintLadderError(`column ${key} is not text`);
}

export function nullableString(row: Record<string, SqlValue>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  throw new HintLadderError(`column ${key} is not text`);
}

function normalizeRow(row: Record<string, SQLOutputValue>): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value;
  }
  return out;
}
