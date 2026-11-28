import type { DatabaseSync } from "node:sqlite";
import { openSharedStateFile } from "../shared-state.js";

export type SqlValue = null | number | string | bigint | Uint8Array;

export interface MergeQueueStateDb {
  transaction<T>(fn: () => T): T;
  get(sql: string, params: readonly SqlValue[]): Readonly<Record<string, SqlValue>> | undefined;
  all(sql: string, params: readonly SqlValue[]): readonly Readonly<Record<string, SqlValue>>[];
  run(sql: string, params: readonly SqlValue[]): number;
  close(): void;
}

export function openMergeQueueStateDb(filePath: string): MergeQueueStateDb {
  const db = openSharedStateFile(filePath);
  db.exec("PRAGMA journal_mode = WAL");
  return new SqliteMergeQueueStateDb(db);
}

class SqliteMergeQueueStateDb implements MergeQueueStateDb {
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
    if (!row || typeof row !== "object") return undefined;
    return normalizeRow(row as Record<string, unknown>);
  }

  all(sql: string, params: readonly SqlValue[]): readonly Readonly<Record<string, SqlValue>>[] {
    return this.db
      .prepare(sql)
      .all(...params)
      .map((row) => normalizeRow(row as Record<string, unknown>));
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
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
      normalized[key] = value;
    } else if (value instanceof Uint8Array) {
      normalized[key] = value;
    } else if (typeof value === "boolean") {
      normalized[key] = value ? 1 : 0;
    } else {
      normalized[key] = value === undefined ? null : String(value);
    }
  }
  return normalized;
}

export function sqlText(row: Readonly<Record<string, SqlValue>> | undefined, key: string): string {
  const value = row?.[key];
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

export function sqlNumber(row: Readonly<Record<string, SqlValue>> | undefined, key: string): number {
  const value = row?.[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 0;
}
