import { createHash } from "node:crypto";

import type { ComputeRequestHash } from "./types.js";

/**
 * Fallback `computeRequestHash` used until Task 007's export is injected.
 * SHA-256 over Unicode NFC strings and RFC 8785 canonical JSON (UTF-16 key order,
 * `-0` normalized to `0`, `undefined` object properties omitted).
 */
export const defaultComputeRequestHash: ComputeRequestHash = (request) => {
  const canonical = canonicalize(request);
  return createHash("sha256").update(canonical).digest("hex");
};

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("request hash rejects non-finite numbers");
    }
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (typeof value === "bigint") {
    throw new TypeError("request hash rejects bigint");
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => (item === undefined ? "null" : canonicalize(item)));
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("request hash rejects non-plain objects");
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((left, right) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
    const parts: string[] = [];
    for (const key of keys) {
      const child = record[key];
      if (child === undefined) continue;
      parts.push(`${JSON.stringify(key.normalize("NFC"))}:${canonicalize(child)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new TypeError(`request hash rejects ${typeof value}`);
}
