import { createHash } from "node:crypto";
import { SchemaValidationError } from "./errors.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export function isJsonObject(value: unknown): value is JsonObject {
  return isJsonValue(value) && value !== null && !Array.isArray(value) && typeof value === "object";
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
  if (typeof value === "object") {
    return Object.values(value as { [key: string]: unknown }).every((item) => isJsonValue(item));
  }
  return false;
}

export function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value !== null && typeof value === "object") {
    const sorted: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child === undefined) continue;
      sorted[key] = canonicalize(child);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Text(value: string): string {
  return sha256Hex(Buffer.from(value, "utf8"));
}

export function parseJsonValue(text: string): JsonValue {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new SchemaValidationError("JSON text is not parseable.");
  }
  if (!isJsonValue(value)) throw new SchemaValidationError("JSON text is not a canonical value.");
  return value;
}

export function parseJsonObject(text: string): JsonObject {
  const value = parseJsonValue(text);
  if (!isJsonObject(value)) throw new SchemaValidationError("JSON text is not an object.");
  return value;
}

export function assertPlainObject(value: unknown, label: string): JsonObject {
  if (!isJsonObject(value)) throw new SchemaValidationError(`${label} must be a JSON object.`);
  return value;
}

export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const encoded = Buffer.from(text, "utf8");
  if (encoded.byteLength <= maxBytes) return { text, truncated: false };
  let end = maxBytes;
  while (end > 0) {
    const byte = encoded[end];
    if (byte === undefined || (byte & 0xc0) !== 0x80) break;
    end -= 1;
  }
  return { text: encoded.subarray(0, end).toString("utf8"), truncated: true };
}
