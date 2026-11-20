import { createHash } from "node:crypto";

/** Local port of Task 007 content hashing until that helper is on the shared barrel. */

export function sha256(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export function normalizeEars(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hashParts(parts: readonly string[]): string {
  return sha256(parts.map((part) => part.normalize("NFC")).join("\n"));
}

export function upstreamDecisionHash(
  decisions: readonly { readonly id: string; readonly contentHash: string }[],
): string {
  const lines = decisions.map((decision) => `${decision.id}=${decision.contentHash}`);
  lines.sort();
  return sha256(lines.join("\n"));
}

interface HashNode {
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields: unknown;
}

export function computeNodeContentHash(node: HashNode): string {
  const payload = {
    fields: node.fields === undefined ? {} : node.fields,
    kind: node.kind,
    text: node.text.normalize("NFC"),
    title: node.title.normalize("NFC"),
  };
  return sha256(canonicalize(payload));
}

export function formatSpecItemId(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("spec item sequence must be an integer greater than or equal to 1");
  }
  return `SI-${String(sequence).padStart(3, "0")}`;
}

function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item === undefined) continue;
    sorted[key] = sortValue(item);
  }
  return sorted;
}
