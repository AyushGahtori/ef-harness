import type { ProjectStateDb, SqliteConnection } from "@ef-harness/db";

export type SqlValue = null | number | string | bigint | Uint8Array;

/**
 * Ref leases use the open `ProjectStateDb` writer.
 * `schema/state.sql` already defines `ref_leases`; this adapter does not create one.
 */
export interface RefLeaseStateDb {
  transaction<T>(fn: () => T | Promise<T>): Promise<T>;
  get(sql: string, params: readonly SqlValue[]): Readonly<Record<string, SqlValue>> | undefined;
  all(sql: string, params: readonly SqlValue[]): readonly Readonly<Record<string, SqlValue>>[];
  run(sql: string, params: readonly SqlValue[]): number;
  close(): void;
}

export function bindRefLeaseStateDb(stateDb: ProjectStateDb): RefLeaseStateDb {
  return new WriterRefLeaseStateDb(stateDb.writer, () => {
    stateDb.close();
  });
}

class WriterRefLeaseStateDb implements RefLeaseStateDb {
  constructor(
    private readonly writer: SqliteConnection,
    private readonly closeState: () => void,
  ) {}

  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    this.writer.exec("BEGIN IMMEDIATE");
    try {
      const value = await fn();
      this.writer.exec("COMMIT");
      return value;
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  get(sql: string, params: readonly SqlValue[]): Readonly<Record<string, SqlValue>> | undefined {
    const row = this.writer.get(sql, params);
    if (row === undefined || row === null) return undefined;
    return normalizeRow(row);
  }

  all(sql: string, params: readonly SqlValue[]): readonly Readonly<Record<string, SqlValue>>[] {
    return this.writer.all(sql, params).map((row) => normalizeRow(row));
  }

  run(sql: string, params: readonly SqlValue[]): number {
    return this.writer.run(sql, params).changes;
  }

  close(): void {
    this.closeState();
  }

  private rollback(): void {
    if (!this.writer.inTransaction) return;
    this.writer.exec("ROLLBACK");
  }
}

function normalizeRow(row: unknown): Readonly<Record<string, SqlValue>> {
  if (row === null || typeof row !== "object") {
    throw new Error("SQLite row was not a record.");
  }
  const normalized: Record<string, SqlValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "string" ||
      typeof value === "bigint" ||
      value instanceof Uint8Array
    ) {
      normalized[key] = value;
    } else {
      throw new Error(`Unsupported SQLite value for column ${key}.`);
    }
  }
  return normalized;
}
