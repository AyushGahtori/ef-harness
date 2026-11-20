/**
 * Local port of Task 007 `computeNodeContentHash` / `digestSha256`.
 * Swap for the shared-contracts barrel when that package exports them.
 * SHA-256 is over UTF-8 NFC canonical JSON `{ kind, title, text, fields }`.
 */

import { createHash } from "node:crypto";

export const CONTENT_HASH_PREFIX = "sha256:" as const;

export class CanonicalizationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CanonicalizationError";
    this.code = code;
  }
}

export interface NodeContent {
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields?: unknown;
}

export function digestSha256(text: string): string {
  const hex = createHash("sha256").update(text, "utf8").digest("hex");
  return `${CONTENT_HASH_PREFIX}${hex}`;
}

export function normalizeLf(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function normalizeNfc(value: unknown): unknown {
  return normalizeValue(value, new Set<object>());
}

export function canonicalizeJson(value: unknown): string {
  return serialize(value, new Set<object>());
}

export function computeNodeContentHash(node: NodeContent): string {
  if (typeof node.kind !== "string" || typeof node.title !== "string" || typeof node.text !== "string") {
    throw new CanonicalizationError("invalid_input", "kind, title, and text must be strings");
  }
  const payload = {
    kind: node.kind,
    title: node.title,
    text: node.text,
    fields: node.fields === undefined ? {} : node.fields,
  };
  return digestSha256(canonicalizeJson(normalizeNfc(payload)));
}

function normalizeValue(value: unknown, stack: Set<object>): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (value === null || typeof value !== "object") return value;
  if (stack.has(value)) {
    throw new CanonicalizationError("circular", "circular reference in NFC normalization");
  }
  const tag = Object.prototype.toString.call(value);
  if (tag !== "[object Object]" && tag !== "[object Array]") {
    throw new CanonicalizationError("unsupported_type", `${tag} cannot be canonicalized`);
  }
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      const copy: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          copy.push(null);
          continue;
        }
        copy.push(normalizeValue(value[index], stack));
      }
      return copy;
    }
    const copy = Object.create(null) as Record<string, unknown>;
    const seen = new Set<string>();
    for (const key of Object.keys(value)) {
      const normalizedKey = key.normalize("NFC");
      if (seen.has(normalizedKey)) {
        throw new CanonicalizationError("nfc_key_collision", "two object keys normalize to the same NFC string");
      }
      seen.add(normalizedKey);
      copy[normalizedKey] = normalizeValue((value as Record<string, unknown>)[key], stack);
    }
    return copy;
  } finally {
    stack.delete(value);
  }
}

function serialize(value: unknown, stack: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError("non_finite_number", "NaN and Infinity cannot be canonicalized");
      }
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case "bigint":
      throw new CanonicalizationError("bigint", "BigInt is not canonical JSON");
    case "undefined":
    case "function":
    case "symbol":
      throw new CanonicalizationError("unsupported_type", `${typeof value} has no canonical JSON representation`);
    case "object":
      break;
    default:
      throw new CanonicalizationError("unsupported_type", "unsupported JSON value");
  }
  if (stack.has(value)) {
    throw new CanonicalizationError("circular", "circular reference in canonical JSON");
  }
  const tag = Object.prototype.toString.call(value);
  if (tag !== "[object Object]" && tag !== "[object Array]") {
    throw new CanonicalizationError("unsupported_type", `${tag} cannot be canonicalized`);
  }
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => serialize(entry, stack)).join(",")}]`;
    }
    const keys = Object.keys(value).sort(compareText);
    const body = keys.map((key) => `${JSON.stringify(key)}:${serialize((value as Record<string, unknown>)[key], stack)}`);
    return `{${body.join(",")}}`;
  } finally {
    stack.delete(value);
  }
}
