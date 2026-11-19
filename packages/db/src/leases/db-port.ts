export type SqlBindValue = string | number | bigint | null | Uint8Array;

export interface LeaseStatement {
  all(params: Readonly<Record<string, SqlBindValue>>): unknown[];
  get(params: Readonly<Record<string, SqlBindValue>>): unknown;
  run(params: Readonly<Record<string, SqlBindValue>>): { changes: number | bigint };
}

/**
 * Writer surface consumed from `ProjectStateDb` (Task 013). Named parameters
 * use bare keys (`task`, not `:task`), matching schema/schema-test.js.
 */
export interface LeaseDatabase {
  exec(sql: string): void;
  prepare(sql: string): LeaseStatement;
}

export function runImmediate<T>(db: LeaseDatabase, body: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = body();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    rollbackIfOpen(db);
    throw error;
  }
}

function rollbackIfOpen(db: LeaseDatabase): void {
  try {
    db.exec("ROLLBACK");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no transaction is active/i.test(message)) {
      throw error instanceof Error ? error : new Error(message);
    }
  }
}
