import { createHash } from "node:crypto";
import { splitSearchText } from "@ef-harness/shared-contracts";
import type { SearchCanonical, SearchResultRef } from "./types.js";

export { splitSearchText };

const HASH_PREFIX = "sha256:";

class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

/** RFC 8785 JSON Canonicalization Scheme for the JSON values search hashes store. */
export function canonicalizeJson(value: unknown): string {
  const parts: string[] = [];
  serialize(value, new Set<object>(), parts);
  return parts.join("");
}

/** Recursive Unicode NFC normalization. The input is not mutated. */
export function normalizeNfc(value: unknown): unknown {
  return normalizeValue(value, new Set<object>());
}

function digestSha256(text: string): string {
  return `${HASH_PREFIX}${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function hashJson(value: unknown): string {
  return digestSha256(canonicalizeJson(normalizeNfc(value)));
}

/** Digest of canonical `{ query, filters }` for `search_reads.query_hash`. */
export function computeSearchQueryHash(input: { query: unknown; filters: unknown }): string {
  if (input === null || typeof input !== "object" || !("query" in input) || !("filters" in input)) {
    throw new CanonicalizationError("search query hash requires query and filters");
  }
  return hashJson({ query: input.query, filters: input.filters });
}

/**
 * Digest of a search result set. Entries are sorted by id, then version.
 * The empty set hashes `[]` and is distinct from every non-empty set.
 */
export function computeResultSetHash(results: readonly SearchResultRef[]): string {
  if (!Array.isArray(results)) {
    throw new CanonicalizationError("result set must be an array");
  }
  const sorted = results.map((entry) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.id !== "string" ||
      !Number.isSafeInteger(entry.version)
    ) {
      throw new CanonicalizationError("result entries require a string id and an integer version");
    }
    return { id: entry.id, version: entry.version };
  });
  sorted.sort((left, right) => {
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    if (left.version < right.version) return -1;
    if (left.version > right.version) return 1;
    return 0;
  });
  return hashJson(sorted);
}

/**
 * Task 007 parity. Pass the real `splitSearchText`, `computeSearchQueryHash`, and
 * `computeResultSetHash` exports as `canonical` once the shared-contracts barrel wires them.
 */
export function createLocalSearchCanonical(): SearchCanonical {
  return {
    splitSearchText,
    computeSearchQueryHash,
    computeResultSetHash,
  };
}

export function resolveSearchCanonical(override?: SearchCanonical): SearchCanonical {
  return override ?? createLocalSearchCanonical();
}

function normalizeValue(value: unknown, stack: Set<object>): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (value === null || typeof value !== "object") return value;
  if (stack.has(value)) throw new CanonicalizationError("circular reference in NFC normalization");
  assertSupportedContainer(value);
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      const copy = new Array<unknown>(value.length);
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) continue;
        copy[index] = normalizeValue(value[index], stack);
      }
      return copy;
    }
    const copy = Object.create(null) as Record<string, unknown>;
    const seen = new Set<string>();
    for (const key of Object.keys(value)) {
      const own = readOwnData(value, key);
      if (!own.ok) continue;
      const normalizedKey = key.normalize("NFC");
      if (seen.has(normalizedKey)) {
        throw new CanonicalizationError("two object keys normalize to the same NFC string");
      }
      seen.add(normalizedKey);
      Object.defineProperty(copy, normalizedKey, {
        value: normalizeValue(own.value, stack),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy;
  } finally {
    stack.delete(value);
  }
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
      throw new CanonicalizationError("BigInt is not canonical JSON");
    case "undefined":
    case "function":
    case "symbol":
      throw new CanonicalizationError(`${typeof value} has no canonical JSON representation`);
    case "object":
      break;
    default:
      throw new CanonicalizationError("unsupported JSON value");
  }
  if (stack.has(value)) throw new CanonicalizationError("circular reference in canonical JSON");
  assertSupportedContainer(value);
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      parts.push("[");
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) parts.push(",");
        const own = Object.prototype.hasOwnProperty.call(value, index);
        const entry = value[index];
        if (!own || entry === undefined || typeof entry === "function" || typeof entry === "symbol") {
          parts.push("null");
          continue;
        }
        serialize(entry, stack, parts);
      }
      parts.push("]");
      return;
    }
    const entries: { key: string; value: unknown }[] = [];
    for (const key of Object.keys(value)) {
      const own = readOwnData(value, key);
      if (!own.ok || own.value === undefined || typeof own.value === "function" || typeof own.value === "symbol") {
        continue;
      }
      entries.push({ key, value: own.value });
    }
    entries.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
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
  } finally {
    stack.delete(value);
  }
}

function encodeNumber(value: number): string {
  if (!Number.isFinite(value)) throw new CanonicalizationError("NaN and Infinity cannot be canonicalized");
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
        throw new CanonicalizationError("lone surrogate in JSON string");
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalizationError("lone surrogate in JSON string");
    }
  }
}

function assertSupportedContainer(value: object): void {
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Object]" || tag === "[object Array]") return;
  throw new CanonicalizationError(`${tag} cannot be canonicalized`);
}

function readOwnData(value: object, key: string): { ok: true; value: unknown } | { ok: false } {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable) return { ok: false };
  if (descriptor.get || descriptor.set) {
    throw new CanonicalizationError("accessor properties cannot be canonicalized");
  }
  return { ok: true, value: descriptor.value };
}
