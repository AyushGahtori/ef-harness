import { createHash } from "node:crypto";

/**
 * Local stand-in for Task 007 `computeNodeContentHash`.
 * SHA-256 over a canonical encoding of `{ kind, title, text, fields }`.
 * Swap for the shared RFC 8785 helper when that package is wired.
 */
export function localContentHash(input: {
  kind: string;
  title: string;
  text: string;
  fields: unknown;
}): string {
  const payload = canonicalJson({
    kind: input.kind,
    title: input.title.normalize("NFC"),
    text: input.text.normalize("NFC"),
    fields: input.fields,
  });
  return createHash("sha256").update(payload).digest("hex");
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
