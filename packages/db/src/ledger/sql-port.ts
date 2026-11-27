import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { SqliteConnection } from "../driver/types.js";
import type { SqlValue } from "../driver/values.js";

export interface LedgerStatement {
  run(...params: readonly unknown[]): { changes: number | bigint };
  get(...params: readonly unknown[]): unknown;
  all(...params: readonly unknown[]): unknown[];
  setAllowBareNamedParameters(enabled: boolean): void;
}

/** Named and positional SQL over one open connection. The caller owns `close`. */
export interface LedgerSql {
  exec(sql: string): void;
  prepare(sql: string): LedgerStatement;
}

export function ledgerSqlFromDatabase(db: DatabaseSync): LedgerSql {
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    prepare(sql: string): LedgerStatement {
      const statement = db.prepare(sql);
      return {
        run: (...params) => invokeSync(statement, "run", params) as { changes: number | bigint },
        get: (...params) => invokeSync(statement, "get", params),
        all: (...params) => invokeSync(statement, "all", params) as unknown[],
        setAllowBareNamedParameters(enabled: boolean): void {
          statement.setAllowBareNamedParameters(enabled);
        },
      };
    },
  };
}

export function ledgerSqlFromConnection(connection: SqliteConnection): LedgerSql {
  return {
    exec(sql: string): void {
      connection.exec(sql);
    },
    prepare(sql: string): LedgerStatement {
      const statement = connection.prepare(sql);
      return {
        run: (...params) => statement.run(asDriverParams(params)),
        get: (...params) => statement.get(asDriverParams(params)),
        all: (...params) => statement.all(asDriverParams(params)),
        setAllowBareNamedParameters(enabled: boolean): void {
          if (!enabled) {
            throw new Error("ledger named parameters require bare names");
          }
        },
      };
    },
  };
}

function invokeSync(
  statement: StatementSync,
  method: "run" | "get" | "all",
  params: readonly unknown[],
): unknown {
  const named = params.length === 1 && isNamedBind(params[0]) ? params[0] : undefined;
  const positional = params as SQLInputValue[];
  if (method === "run") return named ? statement.run(named) : statement.run(...positional);
  if (method === "get") return named ? statement.get(named) : statement.get(...positional);
  return named ? statement.all(named) : statement.all(...positional);
}

function asDriverParams(params: readonly unknown[]): Record<string, SqlValue> | readonly SqlValue[] | undefined {
  if (params.length === 0) return undefined;
  const first = params[0];
  if (params.length === 1 && isNamedBind(first)) return first as Record<string, SqlValue>;
  return params as readonly SqlValue[];
}

function isNamedBind(value: unknown): value is Record<string, SQLInputValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array);
}
