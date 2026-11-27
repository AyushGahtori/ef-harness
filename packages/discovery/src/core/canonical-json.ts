import { createHash } from "node:crypto";
import { computeNodeContentHash } from "@ef-harness/shared-contracts";

/** `sha256:` content hash from `@ef-harness/shared-contracts` (`computeNodeContentHash`). */
export function localContentHash(input: {
  kind: string;
  title: string;
  text: string;
  fields: unknown;
}): string {
  return computeNodeContentHash({
    kind: input.kind,
    title: input.title,
    text: input.text,
    fields: input.fields === undefined ? {} : input.fields,
  });
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const child = record[key];
      if (child !== undefined) {
        sorted[key] = canonicalize(child);
      }
    }
    return sorted;
  }
  return value;
}
