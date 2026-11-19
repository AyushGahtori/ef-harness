import { DatabaseSync } from "node:sqlite";

export type SqlValue = null | number | string | bigint | Uint8Array;

/**
 * SQL port consumed from Task 013 `ProjectStateDb`.
 * `openRefLeaseStateDb` opens a state.db file and ensures `ref_leases` exists
 * so tests and standalone callers can run before the Task 013 barrel is wired.
 */
export interface RefLeaseStateDb {
  transaction<T>(fn: () => T): T;
  get(sql: string, params: readonly SqlValue[]): Readonly<Record<string, SqlValue>> | undefined;
  all(sql: string, params: readonly SqlValue[]): readonly Readonly<Record<string, SqlValue>>[];
  run(sql: string, params: readonly SqlValue[]): number;
  close(): void;
}

export const REF_LEASES_DDL = `
CREATE TABLE IF NOT EXISTS ref_leases (
  ref          TEXT PRIMARY KEY,
  holder       TEXT NOT NULL,
  epoch        INTEGER NOT NULL,
  expected_sha TEXT,
  expires_at   INTEGER
) STRICT, WITHOUT ROWID;
`;

export function openRefLeaseStateDb(filePath: string): RefLeaseStateDb {
  const db = new DatabaseSync(filePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA secure_delete = ON;
    PRAGMA journal_size_limit = 67108864;
    PRAGMA temp_store = MEMORY;
  `);
  db.exec(REF_LEASES_DDL);
  return new SqliteRefLeaseStateDb(db);
}

class SqliteRefLeaseStateDb implements RefLeaseStateDb {
  constructor(private readonly db: DatabaseSync) {}

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  get(sql: string, params: readonly SqlValue[]): Readonly<Record<string, SqlValue>> | undefined {
    const row = this.db.prepare(sql).get(...params);
    return row ? normalizeRow(row) : undefined;
  }

  all(sql: string, params: readonly SqlValue[]): readonly Readonly<Record<string, SqlValue>>[] {
    return this.db.prepare(sql).all(...params).map((row) => normalizeRow(row));
  }

  run(sql: string, params: readonly SqlValue[]): number {
    const result = this.db.prepare(sql).run(...params);
    return typeof result.changes === "bigint" ? Number(result.changes) : result.changes;
  }

  close(): void {
    this.db.close();
  }
}

function normalizeRow(row: Record<string, unknown>): Readonly<Record<string, SqlValue>> {
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
    } else if (value === undefined) {
      normalized[key] = null;
    } else {
      throw new Error(`Unsupported SQLite value for column ${key}.`);
    }
  }
  return normalized;
}
