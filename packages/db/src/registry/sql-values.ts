import type { SQLOutputValue } from "node:sqlite";

export function asText(value: SQLOutputValue | undefined, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected text for ${label}.`);
  }
  return value;
}

export function asNullableText(value: SQLOutputValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error("Expected text or null.");
  }
  return value;
}

export function asInteger(value: SQLOutputValue | undefined, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint") {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric)) return numeric;
  }
  throw new Error(`Expected integer for ${label}.`);
}
