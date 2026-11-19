function renderUnexpected(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "bigint" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Throw from a switch default so every closed state union is exhaustive. */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${renderUnexpected(value)}`);
}
