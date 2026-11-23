import { createHash } from "node:crypto";

import type { CanonicalHashPort } from "./types.js";

export function createCanonicalHashPort(): CanonicalHashPort {
  return {
    sha256Hex(bytes: Uint8Array): string {
      return createHash("sha256").update(bytes).digest("hex");
    },
  };
}

export function stableSortedJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const child = record[key];
      if (child !== undefined) sorted[key] = sortValue(child);
    }
    return sorted;
  }
  return value;
}