import { Buffer } from "node:buffer";
import { findBuiltinSecretSpans, mayContainBuiltinSecret } from "./patterns.js";
import { sanitizeForLog, sensitiveHeaderLabel } from "./sanitize.js";
import type { SecretFinding } from "./types.js";

export const MIN_REGISTERED_SECRET_LENGTH = 8;
export const DEFAULT_STREAM_OVERLAP = 8192;

interface VaultEntry {
  label: string;
  variants: readonly string[];
}

interface Hit {
  start: number;
  end: number;
  label: string;
  source: "vault" | "pattern";
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
  return `[REDACTED:${normalizeRedactionLabel(label)}]`;
}

export class SecretRedactor {
  private readonly vault: VaultEntry[] = [];

  register(label: string, value: string): void {
    if (typeof value !== "string" || value.length === 0) return;
    const normalized = normalizeRedactionLabel(label);
    const entry = createVaultEntry(normalized, value);
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
    if (this.vault.length === 0 && !mayContainBuiltinSecret(text)) return text;
    const hits = this.collect(text);
    if (hits.length === 0) return text;
    let output = "";
    let cursor = 0;
    for (const hit of hits) {
      output += text.slice(cursor, hit.start);
      output += `[REDACTED:${hit.label}]`;
      cursor = hit.end;
    }
    output += text.slice(cursor);
    return output;
  }

  redactValue(value: unknown): unknown {
    return sanitizeForLog(value, (text) => this.redact(text));
  }

  redactHeaders(
    headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  ): Record<string, string> {
    const input: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      input[name] = typeof value === "string" ? value : value.join("\n");
    }
    const redacted = this.redactValue(input);
    const output: Record<string, string> = {};
    if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return output;
    for (const [name, value] of Object.entries(redacted)) {
      output[name] = typeof value === "string" ? value : redactionPlaceholder(sensitiveHeaderLabel(name) ?? "SECRET");
    }
    return output;
  }

  scanForSecrets(text: string): SecretFinding[] {
    if (typeof text !== "string" || text.length === 0) return [];
    return this.collect(text).map((hit) => ({
      start: hit.start,
      end: hit.end,
      label: hit.label,
      source: hit.source,
    }));
  }

  openStream(options?: { overlap?: number }): StreamingRedactor {
    const overlap = options?.overlap ?? DEFAULT_STREAM_OVERLAP;
    return new StreamingRedactor(this, overlap);
  }

  private collect(text: string): Hit[] {
    const hits: Hit[] = [];
    if (mayContainBuiltinSecret(text)) {
      for (const span of findBuiltinSecretSpans(text)) {
        hits.push({ start: span.start, end: span.end, label: span.label, source: "pattern" });
      }
    }
    for (const entry of this.vault) {
      for (const variant of entry.variants) {
        let from = 0;
        while (from <= text.length - variant.length) {
          const index = text.indexOf(variant, from);
          if (index < 0) break;
          hits.push({
            start: index,
            end: index + variant.length,
            label: entry.label,
            source: "vault",
          });
          from = index + variant.length;
        }
      }
    }
    return resolveHits(hits);
  }
}

const patternScanner = new SecretRedactor();
let sharedRedactor: SecretRedactor | undefined;

export function getSharedSecretRedactor(): SecretRedactor {
  if (!sharedRedactor) sharedRedactor = new SecretRedactor();
  return sharedRedactor;
}

export function resetSharedSecretRedactor(next?: SecretRedactor): SecretRedactor {
  sharedRedactor = next ?? new SecretRedactor();
  return sharedRedactor;
}

export function scanForSecrets(text: string, redactor?: SecretRedactor): SecretFinding[] {
  return (redactor ?? patternScanner).scanForSecrets(text);
}

export class StreamingRedactor {
  private pending = "";

  constructor(
    private readonly redactor: SecretRedactor,
    private readonly overlap: number,
  ) {
    if (!Number.isInteger(overlap) || overlap < 1) {
      throw new RangeError("stream overlap must be a positive integer");
    }
  }

  push(chunk: string | Uint8Array): string {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    const combined = this.pending + text;
    const redacted = this.redactor.redact(combined);
    if (redacted.length <= this.overlap) {
      this.pending = redacted;
      return "";
    }
    const cut = avoidPlaceholderSplit(redacted, redacted.length - this.overlap);
    this.pending = redacted.slice(cut);
    return redacted.slice(0, cut);
  }

  flush(): string {
    const rest = this.redactor.redact(this.pending);
    this.pending = "";
    return rest;
  }
}

function avoidPlaceholderSplit(text: string, cut: number): number {
  const windowStart = Math.max(0, cut - 80);
  const marker = text.lastIndexOf("[REDACTED:", cut);
  if (marker < windowStart) return cut;
  const close = text.indexOf("]", marker);
  if (close >= cut && close - marker < 80) return marker;
  return cut;
}

function createVaultEntry(label: string, value: string): VaultEntry {
  if (value.length < MIN_REGISTERED_SECRET_LENGTH) return { label, variants: [] };
  return { label, variants: secretVariants(value) };
}

function secretVariants(secret: string): string[] {
  const variants = new Set<string>();
  const add = (value: string) => {
    if (value.length >= MIN_REGISTERED_SECRET_LENGTH) variants.add(value);
  };
  const base64 = Buffer.from(secret, "utf8").toString("base64");
  const base64Url = Buffer.from(secret, "utf8").toString("base64url");
  const url = encodeURIComponent(secret);
  const urlBase64 = encodeURIComponent(base64);
  const urlBase64Url = encodeURIComponent(base64Url);
  add(secret);
  add(base64);
  add(base64Url);
  add(base64.replaceAll("+", "-").replaceAll("/", "_"));
  add(url);
  add(url.toLowerCase());
  add(urlBase64);
  add(urlBase64.toLowerCase());
  add(urlBase64Url);
  add(Buffer.from(url, "utf8").toString("base64"));
  add(jsonEscape(secret));
  add(jsonEscape(base64));
  add(jsonEscape(url));
  return [...variants].sort((left, right) => right.length - left.length);
}

function jsonEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function resolveHits(hits: Hit[]): Hit[] {
  const sorted = [...hits].sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    const lengthDelta = right.end - right.start - (left.end - left.start);
    if (lengthDelta !== 0) return lengthDelta;
    if (left.source !== right.source) return left.source === "vault" ? -1 : 1;
    return left.label.localeCompare(right.label);
  });
  const chosen: Hit[] = [];
  let cursor = 0;
  for (const hit of sorted) {
    if (hit.start < cursor || hit.end <= hit.start) continue;
    chosen.push(hit);
    cursor = hit.end;
  }
  return chosen;
}
