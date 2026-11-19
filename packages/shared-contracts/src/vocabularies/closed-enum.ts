import { z } from "zod";

export function zodEnumOf<T extends string>(values: readonly T[]) {
  if (values.length === 0) {
    throw new Error("A closed vocabulary needs at least one value");
  }
  return z.enum(values as unknown as [T, ...T[]]);
}

export function isOneOf<T extends string>(values: readonly T[]) {
  const allowed = new Set<string>(values);
  return (value: unknown): value is T => typeof value === "string" && allowed.has(value);
}
