import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { LedgerInvariantError } from "./errors.js";

export function changeCount(result: { changes: number | bigint } | number | bigint): number {
  const changes = typeof result === "number" || typeof result === "bigint" ? result : result.changes;
  const count = typeof changes === "bigint" ? Number(changes) : changes;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new LedgerInvariantError("SQLite changes() was not a non-negative safe integer");
  }
  return count;
}

export function readUnits(value: SQLOutputValue, label: string): number {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n) {
      throw new LedgerInvariantError(`${label} is outside non-negative safe integer units`);
    }
    return Number(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new LedgerInvariantError(`${label} was not a non-negative integer unit`);
}

export function readNullableUnits(value: SQLOutputValue, label: string): number | null {
  if (value === null) return null;
  return readUnits(value, label);
}

export function readText(value: SQLOutputValue, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new LedgerInvariantError(`${label} was not text`);
  }
  return value;
}

export function readNullableText(value: SQLOutputValue): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new LedgerInvariantError("expected text or null");
  }
  return value;
}

export function cell(row: Record<string, SQLOutputValue>, key: string): SQLOutputValue {
  if (!Object.hasOwn(row, key)) {
    throw new LedgerInvariantError(`SQL row is missing ${key}`);
  }
  return row[key] ?? null;
}

export function prepareNamed(db: DatabaseSync, sql: string) {
  const statement = db.prepare(sql);
  statement.setAllowBareNamedParameters(true);
  return statement;
}
