import { createHash, createHmac } from "node:crypto";

import type { ComputeNodeContentHash, ComputeSecretHmac, NodeContentIdentity } from "./types.js";

export class CanonicalizationError extends Error {
  readonly code = "CANONICALIZATION_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

/** Recursive Unicode NFC. Does not mutate the input. */
export function normalizeNfc(value: unknown): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => normalizeNfc(item));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) continue;
      output[key.normalize("NFC")] = normalizeNfc(child);
    }
    return output;
  }
  throw new CanonicalizationError("unsupported value in NFC normalization");
}

function compareUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * RFC 8785 JSON Canonicalization Scheme.
 * UTF-16 code-unit key order, `-0` serialized as `0`, no insignificant whitespace.
 */
export function canonicalizeJson(value: unknown): string {
  return canonicalizeValue(value);
}

function canonicalizeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalizationError("non-finite numbers cannot be canonicalized");
    }
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => (item === undefined ? "null" : canonicalizeValue(item)));
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareUtf16);
    const pairs = keys.map((key) => `${JSON.stringify(key)}:${canonicalizeValue(record[key])}`);
    return `{${pairs.join(",")}}`;
  }
  throw new CanonicalizationError("unsupported value in JSON canonicalization");
}

function parseFields(fields: unknown): unknown {
  if (typeof fields !== "string") return fields;
  try {
    return JSON.parse(fields) as unknown;
  } catch {
    throw new CanonicalizationError("node fields are not valid JSON");
  }
}

/** SHA-256 over RFC 8785 canonical `{ kind, title, text, fields }`, prefixed `sha256:`. */
export const computeNodeContentHash: ComputeNodeContentHash = (node: NodeContentIdentity): string => {
  const normalized = normalizeNfc({
    kind: node.kind,
    title: node.title,
    text: node.text,
    fields: parseFields(node.fields),
  });
  const canonical = canonicalizeJson(normalized);
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${digest}`;
};

/** HMAC-SHA256 fingerprint for `redactions.secret_fingerprint`. Never reversible to the secret. */
export const computeSecretHmac: ComputeSecretHmac = (
  secret: string,
  localKey: Buffer | string,
): string => {
  return createHmac("sha256", localKey).update(secret, "utf8").digest("hex");
};
