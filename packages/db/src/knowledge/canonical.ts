import { createHash } from "node:crypto";
import { splitSearchText } from "@ef-harness/shared-contracts";
import { CanonicalizationError, EntityIdError } from "./errors.js";

export { splitSearchText };

/**
 * Local binding of Task 007 until `@ef-harness/shared-contracts` exports
 * `normalizeNfc`, `computeNodeContentHash`, and `formatEntityId`.
 * The algorithms match that task: NFC strings, RFC 8785 canonical JSON,
 * `sha256:` digests, and the same zero-padded entity ids.
 */

export const CONTENT_HASH_PREFIX = "sha256:" as const;

export interface EntityIdSpec {
  readonly prefix: string;
  readonly minWidth: number;
}

export const ENTITY_ID_SPECS: readonly EntityIdSpec[] = Object.freeze([
  { prefix: "T", minWidth: 2 },
  { prefix: "R", minWidth: 2 },
  { prefix: "SI-", minWidth: 3 },
  { prefix: "EC-", minWidth: 3 },
  { prefix: "C-", minWidth: 3 },
  { prefix: "AC-", minWidth: 2 },
  { prefix: "A", minWidth: 4 },
  { prefix: "F", minWidth: 2 },
  { prefix: "D-", minWidth: 4 },
  { prefix: "CS-", minWidth: 2 },
  { prefix: "EV-", minWidth: 5 },
  { prefix: "CCR-", minWidth: 2 },
  { prefix: "VR-", minWidth: 4 },
  { prefix: "RS-", minWidth: 1 },
  { prefix: "SRC-", minWidth: 2 },
  { prefix: "W", minWidth: 1 },
  { prefix: "S-", minWidth: 1 },
]);

export function formatEntityId(prefix: string, sequence: number): string {
  const spec = ENTITY_ID_SPECS.find((item) => item.prefix === prefix);
  if (!spec) throw new EntityIdError(`unknown entity id prefix: ${prefix}`);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new EntityIdError("entity id sequence must be an integer greater than or equal to 1");
  }
  return spec.prefix + String(sequence).padStart(spec.minWidth, "0");
}

export interface NodeContent {
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields?: unknown;
}

export function normalizeNfc(value: string): string;
export function normalizeNfc<T>(value: T): T;
export function normalizeNfc(value: unknown): unknown {
  return normalizeValue(value, new Set<object>());
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

function digestSha256(text: string): string {
  return `${CONTENT_HASH_PREFIX}${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function normalizeValue(value: unknown, stack: Set<object>): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (value === null || typeof value !== "object") return value;
  if (stack.has(value)) {
    throw new CanonicalizationError("circular", "circular reference in NFC normalization");
  }
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
        throw new CanonicalizationError("nfc_key_collision", "two object keys normalize to the same NFC string");
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
  assertSupportedContainer(value);
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      parts.push("[");
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) parts.push(",");
        const own = Object.prototype.hasOwnProperty.call(value, index);
        const hole = !own || value[index] === undefined || typeof value[index] === "function" || typeof value[index] === "symbol";
        if (hole) parts.push("null");
        else serialize(value[index], stack, parts);
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
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError("non_finite_number", "NaN and Infinity cannot be canonicalized");
  }
  return JSON.stringify(Object.is(value, -0) ? 0 : value);
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
    } else parts.push(value.charAt(index));
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

const objectToString = Object.prototype.toString;
const UNSUPPORTED_TAGS = new Set([
  "[object Date]",
  "[object RegExp]",
  "[object Map]",
  "[object Set]",
  "[object WeakMap]",
  "[object WeakSet]",
  "[object ArrayBuffer]",
  "[object DataView]",
  "[object SharedArrayBuffer]",
  "[object Promise]",
  "[object Error]",
  "[object Number]",
  "[object String]",
  "[object Boolean]",
  "[object BigInt]",
  "[object Int8Array]",
  "[object Uint8Array]",
  "[object Uint8ClampedArray]",
  "[object Int16Array]",
  "[object Uint16Array]",
  "[object Int32Array]",
  "[object Uint32Array]",
  "[object Float32Array]",
  "[object Float64Array]",
  "[object BigInt64Array]",
  "[object BigUint64Array]",
]);

function assertSupportedContainer(value: object): void {
  const tag = objectToString.call(value);
  if (UNSUPPORTED_TAGS.has(tag)) {
    throw new CanonicalizationError("unsupported_type", `${tag} cannot be canonicalized`);
  }
}

function readOwnData(value: object, key: string): { ok: true; value: unknown } | { ok: false } {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable) return { ok: false };
  if (descriptor.get || descriptor.set) {
    throw new CanonicalizationError("unsupported_type", "accessor properties cannot be canonicalized");
  }
  return { ok: true, value: descriptor.value };
}
