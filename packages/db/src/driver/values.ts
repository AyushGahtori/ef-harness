export type SqlValue = string | number | bigint | null | Uint8Array;

export type SqlParams = Record<string, SqlValue> | readonly SqlValue[];

export function isPositionalParams(params: SqlParams | undefined): params is readonly SqlValue[] {
  return Array.isArray(params);
}

export interface RunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

export function normalizeCell(value: unknown): unknown {
  if (typeof value === "bigint") return normalizeInteger(value);
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map((item) => normalizeCell(item));
  if (value !== null && typeof value === "object") {
    const plain: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      plain[key] = normalizeCell(Reflect.get(value, key));
    }
    return plain;
  }
  return value;
}

export function normalizeRunResult(result: {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}): RunResult {
  return {
    changes: expectSafeCount(result.changes),
    lastInsertRowid: normalizeInteger(result.lastInsertRowid),
  };
}

export function firstCell(row: unknown): unknown {
  if (row === null || row === undefined) return undefined;
  if (Array.isArray(row)) return firstCell(row[0]);
  if (typeof row !== "object") return row;
  const values = Object.values(row);
  return values[0];
}

export function pragmaEquals(actual: unknown, expected: string | number): boolean {
  if (typeof expected === "string") return String(actual).toLowerCase() === expected.toLowerCase();
  if (typeof actual === "bigint") return actual === BigInt(expected);
  if (typeof actual === "number") return actual === expected;
  if (typeof actual === "string" && actual.trim() !== "" && Number(actual) === expected) return true;
  return false;
}

function normalizeInteger(value: number | bigint): number | bigint {
  if (typeof value === "bigint") {
    if (value <= MAX_SAFE && value >= MIN_SAFE) return Number(value);
    return value;
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error("SQLite integer was coerced through an unsafe JavaScript number.");
  }
  return value;
}

function expectSafeCount(value: number | bigint): number {
  const normalized = normalizeInteger(value);
  if (typeof normalized !== "number") {
    throw new Error("SQLite changes count does not fit in a safe JavaScript integer.");
  }
  return normalized;
}
