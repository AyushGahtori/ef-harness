import type { SqlValue, SqliteConnection } from "@ef-harness/db";

export interface PositionalStatement {
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
  run(...params: SqlValue[]): { readonly changes: number };
}

export interface PositionalDb {
  exec(sql: string): void;
  prepare(sql: string): PositionalStatement;
}

export function positionalDb(connection: SqliteConnection): PositionalDb {
  return {
    exec(sql: string): void {
      connection.exec(sql);
    },
    prepare(sql: string): PositionalStatement {
      const statement = connection.prepare(sql);
      return {
        get(...params: SqlValue[]): unknown {
          return statement.get(params);
        },
        all(...params: SqlValue[]): unknown[] {
          return statement.all(params);
        },
        run(...params: SqlValue[]): { readonly changes: number } {
          return statement.run(params);
        },
      };
    },
  };
}
