import type { SqlValue } from "./connection.js";

export function rowChanges(result: { readonly changes: number | bigint }): number {
  return typeof result.changes === "bigint" ? Number(result.changes) : result.changes;
}

export function asText(row: Readonly<Record<string, SqlValue>>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`column ${key} is not text`);
  }
  return value;
}

export function asNullableText(row: Readonly<Record<string, SqlValue>>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`column ${key} is not text`);
  }
  return value;
}

export function asInt(row: Readonly<Record<string, SqlValue>>, key: string): number {
  const value = asNullableInt(row, key);
  if (value === null) {
    throw new Error(`column ${key} is not an integer`);
  }
  return value;
}

export function asNullableInt(row: Readonly<Record<string, SqlValue>>, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
    return Number(value);
  }
  throw new Error(`column ${key} is not an integer`);
}

export function requireInt(value: number, label: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`);
  }
}

export function parseJsonObject(text: string): Readonly<Record<string, unknown>> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
}
