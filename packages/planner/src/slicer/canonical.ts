import { createHash } from "node:crypto";

export type Canonical =
  | null
  | boolean
  | number
  | string
  | Canonical[]
  | { readonly [key: string]: Canonical };

export function canonicalize(value: Canonical): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error("RFC 8785 payload numbers must be integers");
    }
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  const keys = Object.keys(value).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const body = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] ?? null)}`);
  return `{${body.join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashCanonical(value: Canonical): string {
  return sha256Hex(canonicalize(value));
}
