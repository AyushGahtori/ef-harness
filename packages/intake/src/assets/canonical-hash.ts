import { createHash } from "node:crypto";
import { BrandAssetError } from "./errors.js";

/**
 * Local port of Task 007 `digestSha256` / `computeNodeContentHash`.
 * Swap these functions for `@ef-harness/shared-contracts` when that barrel exports them.
 */
export const CANONICAL_HASH_SOURCE = "local-port:task-007" as const;
export const CONTENT_HASH_PREFIX = "sha256:" as const;

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

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function computeNodeContentHash(node: NodeContent): string {
  if (typeof node.kind !== "string" || typeof node.title !== "string" || typeof node.text !== "string") {
    throw new BrandAssetError("invalid-node", "kind, title, and text must be strings");
  }
  const payload = {
    kind: node.kind,
    title: node.title,
    text: node.text,
    fields: node.fields === undefined ? {} : node.fields,
  };
  return digestSha256(canonicalizeJson(normalizeNfc(payload)));
}

export function normalizeNfc(value: unknown): unknown {
  return normalizeValue(value, new Set<object>());
}

export function canonicalizeJson(value: unknown): string {
  return serialize(value, new Set<object>());
}

function normalizeValue(value: unknown, stack: Set<object>): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (value === null || typeof value !== "object") return value;
  if (stack.has(value)) {
    throw new BrandAssetError("circular-json", "circular reference in NFC normalization");
  }
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => normalizeValue(entry, stack));
    }
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      copy[key.normalize("NFC")] = normalizeValue((value as Record<string, unknown>)[key], stack);
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
        throw new BrandAssetError("non-finite", "NaN and Infinity cannot be canonicalized");
      }
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      throw new BrandAssetError("unsupported-json", `${typeof value} cannot be canonicalized`);
    case "object": {
      if (stack.has(value)) {
        throw new BrandAssetError("circular-json", "circular reference in canonical JSON");
      }
      stack.add(value);
      try {
        if (Array.isArray(value)) {
          return `[${value.map((entry) => serialize(entry, stack)).join(",")}]`;
        }
        const keys = Object.keys(value).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
        const parts: string[] = [];
        for (const key of keys) {
          const entry = (value as Record<string, unknown>)[key];
          if (entry === undefined) continue;
          parts.push(`${JSON.stringify(key)}:${serialize(entry, stack)}`);
        }
        return `{${parts.join(",")}}`;
      } finally {
        stack.delete(value);
      }
    }
    default:
      throw new BrandAssetError("unsupported-json", "value cannot be canonicalized");
  }
}
