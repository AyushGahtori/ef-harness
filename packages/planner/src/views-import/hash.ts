import { createHash } from "node:crypto";
import type { FieldMap, FieldValue } from "./types.js";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function normalizeNewlines(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function hashText(text: string): string {
  return sha256Hex(normalizeNewlines(text));
}

export function canonicalJson(value: unknown): string {
  const parts: string[] = [];
  writeCanonical(value, new Set<object>(), parts);
  return parts.join("");
}

export function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function cloneFields(fields: FieldMap): FieldMap {
  const parsed: unknown = JSON.parse(canonicalJson(fields));
  if (!isFieldMap(parsed)) return {};
  return parsed;
}

export function isFieldMap(value: unknown): value is FieldMap {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return true;
}

export function isFieldValue(value: unknown): value is FieldValue {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      if (Array.isArray(value)) return value.every((item) => isFieldValue(item));
      return isFieldMap(value) && Object.values(value).every((item) => isFieldValue(item));
    default:
      return false;
  }
}

export function contentHash(node: {
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields: FieldMap;
}): string {
  return `sha256:${sha256Hex(
    canonicalJson({
      fields: node.fields,
      kind: node.kind,
      text: node.text,
      title: node.title,
    }),
  )}`;
}

function writeCanonical(value: unknown, stack: Set<object>, parts: string[]): void {
  if (value === null) {
    parts.push("null");
    return;
  }
  switch (typeof value) {
    case "boolean":
      parts.push(value ? "true" : "false");
      return;
    case "string":
      parts.push(JSON.stringify(value));
      return;
    case "number":
      if (!Number.isFinite(value)) throw new Error("non-finite number in canonical JSON");
      parts.push(JSON.stringify(Object.is(value, -0) ? 0 : value));
      return;
    case "object":
      break;
    default:
      throw new Error(`unsupported canonical JSON value: ${typeof value}`);
  }
  if (stack.has(value)) throw new Error("circular canonical JSON");
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      parts.push("[");
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) parts.push(",");
        writeCanonical(value[index], stack, parts);
      }
      parts.push("]");
      return;
    }
    const entries = Object.keys(value)
      .filter((key) => isFieldValue((value as Record<string, unknown>)[key]))
      .sort()
      .map((key) => ({ key, item: (value as Record<string, unknown>)[key] }));
    parts.push("{");
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!entry) continue;
      if (index > 0) parts.push(",");
      parts.push(JSON.stringify(entry.key));
      parts.push(":");
      writeCanonical(entry.item, stack, parts);
    }
    parts.push("}");
  } finally {
    stack.delete(value);
  }
}
