export function rowField(row: unknown, key: string): unknown {
  if (row === null || typeof row !== "object") {
    throw new Error(`expected a database row when reading ${key}`);
  }
  return (row as Record<string, unknown>)[key];
}

export function asNumber(value: unknown, label: string): number {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error(`${label} exceeds the safe integer range`);
    }
    return Number(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new Error(`${label} is not a safe integer`);
}

export function asString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is not text`);
  return value;
}

export function asNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return asString(value, label);
}

export function asNullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  return asNumber(value, label);
}
