export const MIN_REGISTERED_SECRET_LENGTH = 8;

/**
 * Local port of Task 011 `SecretRedactor`.
 * Sibling branches are not merged. Pass the real redactor at integration.
 * This task's placeholder is `[REDACTED_SECRET:<LABEL>]`.
 */
export interface PacketSecurityRedactor {
  register(label: string, value: string): void;
  forget(label: string): boolean;
  redact(text: string): string;
}

interface VaultEntry {
  label: string;
  variants: readonly string[];
}

const LABEL_PATTERN = /^[A-Z0-9_]+$/;

export function normalizeRedactionLabel(label: string): string {
  const cleaned = label
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  if (cleaned.length === 0 || !LABEL_PATTERN.test(cleaned)) return "SECRET";
  return cleaned;
}

export function redactionPlaceholder(label: string): string {
  return `[REDACTED_SECRET:${normalizeRedactionLabel(label)}]`;
}

export class LocalPacketSecurityRedactor implements PacketSecurityRedactor {
  private readonly vault: VaultEntry[] = [];

  register(label: string, value: string): void {
    if (typeof value !== "string" || value.length === 0) return;
    const normalized = normalizeRedactionLabel(label);
    if (value.length < MIN_REGISTERED_SECRET_LENGTH) {
      this.forget(normalized);
      return;
    }
    const entry = { label: normalized, variants: variantsOf(value) };
    const existing = this.vault.findIndex((item) => item.label === normalized);
    if (existing >= 0) this.vault[existing] = entry;
    else this.vault.push(entry);
  }

  forget(label: string): boolean {
    const normalized = normalizeRedactionLabel(label);
    const index = this.vault.findIndex((item) => item.label === normalized);
    if (index < 0) return false;
    this.vault.splice(index, 1);
    return true;
  }

  redact(text: string): string {
    if (typeof text !== "string" || text.length === 0) return text;
    const hits = this.collect(text);
    if (hits.length === 0) return text;
    let output = "";
    let cursor = 0;
    for (const hit of hits) {
      output += text.slice(cursor, hit.start);
      output += `[REDACTED_SECRET:${hit.label}]`;
      cursor = hit.end;
    }
    return output + text.slice(cursor);
  }

  private collect(text: string): { start: number; end: number; label: string }[] {
    const hits: { start: number; end: number; label: string }[] = [];
    for (const entry of this.vault) {
      for (const variant of entry.variants) {
        let from = 0;
        while (from <= text.length) {
          const found = text.indexOf(variant, from);
          if (found < 0) break;
          hits.push({ start: found, end: found + variant.length, label: entry.label });
          from = found + variant.length;
        }
      }
    }
    hits.sort((left, right) => left.start - right.start || right.end - left.end);
    const kept: { start: number; end: number; label: string }[] = [];
    let end = -1;
    for (const hit of hits) {
      if (hit.start < end) continue;
      kept.push(hit);
      end = hit.end;
    }
    return kept;
  }
}

function variantsOf(value: string): string[] {
  const variants = new Set<string>();
  addIfLong(variants, value);
  addIfLong(variants, Buffer.from(value, "utf8").toString("base64"));
  addIfLong(variants, Buffer.from(value, "utf8").toString("base64url"));
  addIfLong(variants, encodeURIComponent(value));
  const json = JSON.stringify(value);
  addIfLong(variants, json.slice(1, -1));
  for (const line of value.split(/\r?\n/)) {
    addIfLong(variants, line.trim());
  }
  return [...variants];
}

function addIfLong(target: Set<string>, value: string): void {
  if (value.length >= MIN_REGISTERED_SECRET_LENGTH) target.add(value);
}
