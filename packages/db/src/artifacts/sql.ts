import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

export function asString(value: SQLOutputValue | undefined, label: string): string {
  if (typeof value !== "string") throw new Error(`Expected ${label} to be text.`);
  return value;
}

export function asNumber(value: SQLOutputValue | undefined, label: string): number {
  if (typeof value !== "number") throw new Error(`Expected ${label} to be a number.`);
  return value;
}

export function asNullableString(value: SQLOutputValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("Expected text or null.");
  return value;
}

export function asNullableNumber(value: SQLOutputValue | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number") throw new Error("Expected a number or null.");
  return value;
}

export function changesOf(changes: number | bigint): number {
  return typeof changes === "bigint" ? Number(changes) : changes;
}

export function withImmediate<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
