import type { SqliteConnection, WriteTransaction } from "@ef-harness/db";
import { createSavepointGate } from "../queue-savepoint.js";
import type { SqlDatabase, SqlStatement } from "./sql.js";

type SqlParams = Record<string, string | number | bigint | null>;

interface RunShape {
  readonly changes: number | bigint;
  readonly lastInsertRowid?: number | bigint;
}

export function bindWriterDatabase(writer: SqliteConnection): SqlDatabase {
  return {
    exec(sql: string): void {
      writer.exec(sql);
    },
    prepare(sql: string): SqlStatement {
      return adaptStatement(writer.prepare(sql));
    },
    close(): void {
      return undefined;
    },
  };
}

export function bindQueuedDatabase(writer: SqliteConnection, tx: WriteTransaction): SqlDatabase {
  const gate = createSavepointGate(writer);
  return {
    exec(sql: string): void {
      if (gate(sql)) return;
      tx.exec(sql);
    },
    prepare(sql: string): SqlStatement {
      return adaptStatement(tx.prepare(sql));
    },
    close(): void {
      return undefined;
    },
  };
}

function adaptStatement(statement: {
  get(params?: SqlParams): unknown;
  all(params?: SqlParams): readonly unknown[];
  run(params?: SqlParams): RunShape;
}): SqlStatement {
  return {
    get(params) {
      return asRow(statement.get(params));
    },
    all(params) {
      return statement.all(params).map((row) => {
        const record = asRow(row);
        if (!record) throw new Error("SQLite row was empty");
        return record;
      });
    },
    run(params) {
      const result = statement.run(params);
      return {
        changes: Number(result.changes),
        lastInsertRowid: result.lastInsertRowid ?? 0,
      };
    },
  };
}

function asRow(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SQLite row was not an object");
  }
  const row: Record<string, unknown> = {};
  for (const [key, cell] of Object.entries(value)) row[key] = cell;
  return row;
}
