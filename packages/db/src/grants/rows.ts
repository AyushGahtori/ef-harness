import { NonIntegerUnitsError } from "./errors.js";
import type { SqlRow } from "./session.js";

export function requiredText(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new NonIntegerUnitsError(key);
  }
  return value;
}

export function requiredInteger(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber)) {
      throw new NonIntegerUnitsError(key);
    }
    return asNumber;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new NonIntegerUnitsError(key);
  }
  return value;
}

export function optionalInteger(row: SqlRow, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber)) {
      throw new NonIntegerUnitsError(key);
    }
    return asNumber;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new NonIntegerUnitsError(key);
  }
  return value;
}

export function optionalText(row: SqlRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new NonIntegerUnitsError(key);
  }
  return value;
}
