import { CanonicalizationError } from "./errors.js";
import { assertSupportedContainer, isOmittedPropertyValue, readOwnData } from "./json-shape.js";

/**
 * RFC 8785 JSON Canonicalization Scheme.
 * Keys sort by UTF-16 code unit (`a < b ? -1 : a > b ? 1 : 0`).
 * Numbers use ECMAScript serialization, with `-0` forced to `0`.
 * The returned string is the canonical JSON text; hash it as UTF-8.
 */
export function canonicalizeJson(value: unknown): string {
  const parts: string[] = [];
  serialize(value, new Set<object>(), parts);
  return parts.join("");
}

function serialize(value: unknown, stack: Set<object>, parts: string[]): void {
  if (value === null) {
    parts.push("null");
    return;
  }
  switch (typeof value) {
    case "boolean":
      parts.push(value ? "true" : "false");
      return;
    case "string":
      parts.push(encodeJsonString(value));
      return;
    case "number":
      parts.push(encodeNumber(value));
      return;
    case "bigint":
      throw new CanonicalizationError(
        "bigint",
        "BigInt is not canonical JSON; serialize it as a string before hashing",
      );
    case "undefined":
    case "function":
    case "symbol":
      throw new CanonicalizationError(
        "unsupported_type",
        `${typeof value} has no canonical JSON representation`,
      );
    case "object":
      break;
    default:
      throw new CanonicalizationError("unsupported_type", "unsupported JSON value");
  }

  if (stack.has(value)) {
    throw new CanonicalizationError("circular", "circular reference in canonical JSON");
  }
  assertSupportedContainer(value);
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      serializeArray(value, stack, parts);
      return;
    }
    serializeObject(value, stack, parts);
  } finally {
    stack.delete(value);
  }
}

function serializeArray(value: unknown[], stack: Set<object>, parts: string[]): void {
  parts.push("[");
  for (let index = 0; index < value.length; index += 1) {
    if (index > 0) parts.push(",");
    const own = Object.prototype.hasOwnProperty.call(value, index);
    if (!own || isJsonArrayHole(value[index])) {
      parts.push("null");
      continue;
    }
    serialize(value[index], stack, parts);
  }
  parts.push("]");
}

function isJsonArrayHole(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

function serializeObject(value: object, stack: Set<object>, parts: string[]): void {
  const entries: { key: string; value: unknown }[] = [];
  for (const key of Object.keys(value)) {
    const own = readOwnData(value, key);
    if (!own.ok || isOmittedPropertyValue(own.value)) continue;
    entries.push({ key, value: own.value });
  }
  entries.sort((left, right) => compareUtf16(left.key, right.key));
  parts.push("{");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (index > 0) parts.push(",");
    parts.push(encodeJsonString(entry.key));
    parts.push(":");
    serialize(entry.value, stack, parts);
  }
  parts.push("}");
}

function compareUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function encodeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError(
      "non_finite_number",
      "NaN and Infinity cannot be canonicalized",
    );
  }
  const normalized = Object.is(value, -0) ? 0 : value;
  return JSON.stringify(normalized);
}

function encodeJsonString(value: string): string {
  assertNoLoneSurrogate(value);
  const parts = ['"'];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22) parts.push('\\"');
    else if (code === 0x5c) parts.push("\\\\");
    else if (code === 0x08) parts.push("\\b");
    else if (code === 0x09) parts.push("\\t");
    else if (code === 0x0a) parts.push("\\n");
    else if (code === 0x0c) parts.push("\\f");
    else if (code === 0x0d) parts.push("\\r");
    else if (code < 0x20) parts.push(`\\u${code.toString(16).padStart(4, "0")}`);
    else if (code >= 0xd800 && code <= 0xdbff) {
      parts.push(value.charAt(index), value.charAt(index + 1));
      index += 1;
    } else {
      parts.push(value.charAt(index));
    }
  }
  parts.push('"');
  return parts.join("");
}

function assertNoLoneSurrogate(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) {
        throw new CanonicalizationError("lone_surrogate", "lone surrogate in JSON string");
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalizationError("lone_surrogate", "lone surrogate in JSON string");
    }
  }
}
