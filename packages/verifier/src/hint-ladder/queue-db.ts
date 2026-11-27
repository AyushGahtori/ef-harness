import type { SqliteConnection, WriteTransaction } from "@ef-harness/db";
import { createSavepointGate } from "../queue-savepoint.js";
import type { PreparedStatement, SqlValue, StateDbPort } from "./sql.js";

type WriteParams = Record<string, string | number | bigint | null>;

export function bindQueuedStateDb(writer: SqliteConnection, tx: WriteTransaction): StateDbPort {
  const gate = createSavepointGate(writer);
  return {
    exec(sql: string): void {
      if (gate(sql)) return;
      tx.exec(sql);
    },
    prepare(sql: string): PreparedStatement {
      const statement = tx.prepare(sql);
      return {
        get(params) {
          const row = statement.get(asWriteParams(params));
          return row ? normalize(row) : undefined;
        },
        all(params) {
          return statement.all(asWriteParams(params)).map((row) => normalize(row));
        },
        run(params) {
          const result = statement.run(asWriteParams(params));
          const changes = result.changes;
          return { changes: typeof changes === "bigint" ? Number(changes) : changes };
        },
      };
    },
  };
}

function asWriteParams(params: Record<string, SqlValue> | undefined): WriteParams | undefined {
  if (params === undefined) return undefined;
  const bound: WriteParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value === null) {
      bound[key] = value;
      continue;
    }
    throw new Error(`parameter ${key} is not a scalar`);
  }
  return bound;
}

function normalize(row: { readonly [column: string]: unknown }): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "string" ||
      typeof value === "bigint" ||
      value instanceof Uint8Array
    ) {
      out[key] = value;
      continue;
    }
    throw new Error(`column ${key} is not a SQLite value`);
  }
  return out;
}
