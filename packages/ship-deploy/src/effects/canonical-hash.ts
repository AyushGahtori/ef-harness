import { createHash } from "node:crypto";

/**
 * RFC 8785-style canonical JSON hashing (Task 007 port).
 * Sorts object keys lexicographically and omits undefined.
 */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function canonicalPayloadHash(payload: unknown): string {
  const canonical = canonicalizeJson(payload);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const child = record[key];
    if (child !== undefined) {
      sorted[key] = sortValue(child);
    }
  }
  return sorted;
}