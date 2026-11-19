/**
 * Structural writer connection used by the outbox.
 * `node:sqlite` `DatabaseSync` satisfies this shape. Task 012's `SqliteConnection`
 * and Task 013's `ProjectStateDb` writer are expected to satisfy it once wired.
 */
export interface OutboxRunResult {
  readonly changes: number | bigint;
  readonly lastInsertRowid: number | bigint;
}

export type SqlValue = null | number | bigint | string;

export interface OutboxStatement {
  run(params?: Readonly<Record<string, SqlValue>>): OutboxRunResult;
  get(params?: Readonly<Record<string, SqlValue>>): Record<string, SqlValue> | undefined;
  all(params?: Readonly<Record<string, SqlValue>>): Array<Record<string, SqlValue>>;
}

export interface OutboxConnection {
  readonly isTransaction: boolean;
  exec(sql: string): void;
  prepare(sql: string): OutboxStatement;
}
