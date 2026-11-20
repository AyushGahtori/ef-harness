import { createHash } from "node:crypto";
import { PACK_MANIFEST_SCHEMA_VERSION } from "./types.js";

export function canonicalJson(value: unknown): string {
  return stringifyCanonical(value);
}

function stringifyCanonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("corpus canonical hash rejected a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyCanonical(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stringifyCanonical(record[key])}`)
      .join(",")}}`;
  }
  throw new Error(`corpus canonical hash rejected ${typeof value}`);
}

export function corpusBundleHash(
  files: readonly { readonly path: string; readonly document: unknown }[],
): string {
  const payload = {
    formatVersion: PACK_MANIFEST_SCHEMA_VERSION,
    files: [...files]
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
      .map((file) => ({ path: file.path, document: file.document })),
  };
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}
