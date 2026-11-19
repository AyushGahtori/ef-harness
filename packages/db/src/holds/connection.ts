/**
 * Writer surface consumed from `ProjectStateDb` (Task 013) once that package
 * is wired. Task 012's `SqliteConnection` satisfies the same two methods.
 * Neither package is on the Task 001 base, so holds accept this structural port.
 */
export type SqlValue = string | number | bigint | Uint8Array | null;

export interface SqlRunResult {
  readonly changes: number | bigint;
  readonly lastInsertRowid?: number | bigint;
}

export interface SqlStatement {
  run(params: Readonly<Record<string, SqlValue>>): SqlRunResult;
  get(params: Readonly<Record<string, SqlValue>>): Readonly<Record<string, SqlValue>> | undefined;
  all(params: Readonly<Record<string, SqlValue>>): readonly Readonly<Record<string, SqlValue>>[];
}

export interface StateConnection {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
}
