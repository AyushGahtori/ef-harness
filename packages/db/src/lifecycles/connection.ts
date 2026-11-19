/**
 * Writer surface consumed from `ProjectStateDb` (Task 013).
 * Task 012's `SqliteConnection` satisfies the same methods.
 * Neither package is on this base commit, so lifecycles accept this port.
 */
export type SqlValue = string | number | bigint | Uint8Array | null;

export interface SqlRunResult {
  readonly changes: number | bigint;
  readonly lastInsertRowid?: number | bigint;
}

export interface SqlStatement {
  run(params?: Readonly<Record<string, SqlValue>>): SqlRunResult;
  get(params?: Readonly<Record<string, SqlValue>>): Readonly<Record<string, SqlValue>> | undefined;
  all(params?: Readonly<Record<string, SqlValue>>): readonly Readonly<Record<string, SqlValue>>[];
}

export interface StateConnection {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
}
