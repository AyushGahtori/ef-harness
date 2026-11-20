import { createHash } from "node:crypto";

export type Canonical =
  | null
  | boolean
  | number
  | string
  | readonly Canonical[]
  | { readonly [key: string]: Canonical };

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function canonicalJson(value: Canonical): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical JSON rejects non-finite numbers");
    }
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as { readonly [key: string]: Canonical };
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] ?? null)}`)
    .join(",")}}`;
}

export function hashCanonical(value: Canonical): string {
  return sha256Hex(canonicalJson(value));
}
