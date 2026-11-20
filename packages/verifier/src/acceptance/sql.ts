export interface SqlStatement {
  run(params?: Record<string, string | number | bigint | null>): {
    changes: number;
    lastInsertRowid: number | bigint;
  };
  get(params?: Record<string, string | number | bigint | null>): Record<string, unknown> | undefined;
  all(params?: Record<string, string | number | bigint | null>): Record<string, unknown>[];
}

export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}

export function changesOf(result: { changes: number }): number {
  return Number(result.changes);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function asString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

export function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    void error;
    return null;
  }
}

export function readRowString(row: Record<string, unknown>, key: string): string {
  return asString(row[key], key);
}

export function readRowNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "bigint") return Number(value);
  return asNumber(value, key);
}

export function readRowStringOrNull(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return asString(value, key);
}
