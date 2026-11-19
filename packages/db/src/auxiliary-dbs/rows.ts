import { AuxiliaryDbError } from "./errors.js";
import { bigintToNumber } from "./integers.js";
import type { SqlRow } from "./sql-types.js";

export function requiredText(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new AuxiliaryDbError("ROW_SHAPE", `expected text in column ${key}`);
  }
  return value;
}

export function optionalText(row: SqlRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new AuxiliaryDbError("ROW_SHAPE", `expected text in column ${key}`);
  }
  return value;
}

export function requiredInt(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "bigint") return bigintToNumber(value);
  throw new AuxiliaryDbError("ROW_SHAPE", `expected integer in column ${key}`);
}

export function optionalInt(row: SqlRow, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return requiredInt(row, key);
}

export function requiredReal(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new AuxiliaryDbError("ROW_SHAPE", `expected number in column ${key}`);
}

export function requiredFlag(row: SqlRow, key: string): boolean {
  const value = requiredInt(row, key);
  if (value !== 0 && value !== 1) {
    throw new AuxiliaryDbError("ROW_SHAPE", `expected 0 or 1 in column ${key}`);
  }
  return value === 1;
}

export function assertNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new AuxiliaryDbError("EMPTY_VALUE", `${label} is empty`);
  }
  return trimmed;
}

export function assertSafeInteger(value: number, label: string): number {
  if (!Number.isInteger(value)) {
    throw new AuxiliaryDbError("INVALID_INTEGER", `${label} must be an integer`);
  }
  return value;
}
