import { createHash } from "node:crypto";
import { normalizeNfc } from "../unicode-sanitizer.js";

export interface CanonicalHash {
  normalizeNfc(text: string): string;
  sha256(bytes: Uint8Array): string;
  sha256Prefixed(bytes: Uint8Array): string;
}

export function createCanonicalHash(): CanonicalHash {
  return {
    normalizeNfc,
    sha256(bytes: Uint8Array): string {
      return createHash("sha256").update(bytes).digest("hex");
    },
    sha256Prefixed(bytes: Uint8Array): string {
      return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    },
  };
}

export function stableJson(value: unknown): string {
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
