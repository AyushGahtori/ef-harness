import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { errorMessage } from "./errors.js";
import type { SqlRunResult, SqlSession, SqlValue } from "./types.js";

export class SqliteSession implements SqlSession {
  readonly dialect = "sqlite" as const;
  readonly executed: string[] = [];
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
  }

  get native(): DatabaseSync {
    return this.db;
  }

  exec(sql: string): void {
    this.executed.push(sql);
    this.db.exec(sql);
  }

  all(sql: string, params: readonly SqlValue[] = []): readonly Record<string, SqlValue>[] {
    const rows = this.db.prepare(sql).all(...toInputs(params)) as Record<string, SQLOutputValue>[];
    return rows.map((row) => mapRow(row));
  }

  get(sql: string, params: readonly SqlValue[] = []): Record<string, SqlValue> | undefined {
    const row = this.db.prepare(sql).get(...toInputs(params)) as Record<string, SQLOutputValue> | undefined;
    return row ? mapRow(row) : undefined;
  }

  run(sql: string, params: readonly SqlValue[] = []): SqlRunResult {
    const result = this.db.prepare(sql).run(...toInputs(params));
    return { changes: typeof result.changes === "bigint" ? Number(result.changes) : result.changes };
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  rollbackIfOpen(): void {
    try {
      this.db.exec("ROLLBACK");
    } catch (error) {
      if (!/no transaction/i.test(errorMessage(error))) throw error;
    }
  }
}

function toInputs(params: readonly SqlValue[]): SQLInputValue[] {
  return params.map((value) => value);
}

function mapRow(row: Record<string, SQLOutputValue>): Record<string, SqlValue> {
  const mapped: Record<string, SqlValue> = {};
  for (const [key, value] of Object.entries(row)) {
    mapped[key] = asSqlValue(value);
  }
  return mapped;
}

function asSqlValue(value: SQLOutputValue): SqlValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  throw new Error("binary SQL values are not used by live migrations");
}
