import { Buffer } from "node:buffer";
import type { SecretFinding, SecretRedactor } from "./types.js";

export const MIN_REGISTERED_SECRET_LENGTH = 8;

interface VaultEntry {
  readonly label: string;
  readonly variants: readonly string[];
}

interface Hit {
  readonly start: number;
  readonly end: number;
  readonly label: string;
  readonly source: "vault" | "pattern";
}

const LABEL_PATTERN = /^[A-Z0-9_]+$/;

export function normalizeRedactionLabel(label: string): string {
  const cleaned = label
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  if (!cleaned || !LABEL_PATTERN.test(cleaned)) return "SECRET";
  return cleaned;
}

export class CanaryVaultSecretRedactor implements SecretRedactor {
  private readonly vault: VaultEntry[] = [];

  register(label: string, value: string): void {
    if (typeof value !== "string" || value.length < MIN_REGISTERED_SECRET_LENGTH) return;
    const normalized = normalizeRedactionLabel(label);
    const variants = secretVariants(value);
    if (variants.length === 0) return;
    const entry = { label: normalized, variants };
    const existing = this.vault.findIndex((item) => item.label === normalized);
    if (existing >= 0) this.vault[existing] = entry;
    else this.vault.push(entry);
  }

  redact(text: string): string {
    if (typeof text !== "string" || text.length === 0) return text;
    const hits = this.collect(text);
    if (hits.length === 0) return text;
    let output = "";
    let cursor = 0;
    for (const hit of hits) {
      output += text.slice(cursor, hit.start);
      output += `[REDACTED:${hit.label}]`;
      cursor = hit.end;
    }
    return output + text.slice(cursor);
  }

  scanForSecrets(text: string): readonly SecretFinding[] {
    if (typeof text !== "string" || text.length === 0) return [];
    return this.collect(text).map((hit) => ({
      start: hit.start,
      end: hit.end,
      label: hit.label,
      source: hit.source,
    }));
  }

  private collect(text: string): readonly Hit[] {
    const hits: Hit[] = [];
    for (const span of findBuiltinSecretSpans(text)) {
      hits.push({ start: span.start, end: span.end, label: span.label, source: "pattern" });
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

function secretVariants(value: string): string[] {
  const variants = new Set<string>([
    value,
    Buffer.from(value, "utf8").toString("base64"),
    Buffer.from(value, "utf8").toString("base64url"),
    encodeURIComponent(value),
    value.replace(/\\/g, "\\\\").replace(/"/g, '\\"'),
  ]);
  return [...variants].filter((variant) => variant.length >= MIN_REGISTERED_SECRET_LENGTH);
}

function resolveHits(hits: readonly Hit[]): Hit[] {
  const ordered = [...hits].sort((left, right) => left.start - right.start || right.end - left.end);
  const chosen: Hit[] = [];
  let cursor = 0;
  for (const hit of ordered) {
    if (hit.start < cursor || hit.end <= hit.start) continue;
    chosen.push(hit);
    cursor = hit.end;
  }
  return chosen;
}

interface Span {
  readonly start: number;
  readonly end: number;
  readonly label: string;
}

function joinParts(parts: readonly string[]): string {
  return parts.join("");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STRIPE_LIVE = joinParts(["sk", "_live_"]);
const STRIPE_TEST = joinParts(["sk", "_test_"]);
const ANTHROPIC = joinParts(["sk-ant", "-"]);
const OPENAI_PROJECT = joinParts(["sk-proj", "-"]);
const OPENROUTER = joinParts(["sk-or", "-v1-"]);
const GITHUB = joinParts(["ghp", "_"]);
const GITHUB_OAUTH = joinParts(["gho", "_"]);
const GITHUB_FINE = joinParts(["github", "_pat_"]);
const AWS = joinParts(["AK", "IA"]);
const PEM_HEADER = joinParts([
  "-----",
  "BEGIN",
  "(?: RSA| DSA| EC| OPENSSH| ENCRYPTED)? ",
  "PRIVATE",
  " ",
  "KEY",
  "-----",
]);

const BUILTIN: readonly { readonly source: string; readonly label: string }[] = [
  { source: PEM_HEADER, label: "PEM_PRIVATE_KEY" },
  { source: `(?<![A-Za-z0-9])${escapeRegExp(STRIPE_LIVE)}[A-Za-z0-9]{16,}`, label: "SK_LIVE" },
  { source: `(?<![A-Za-z0-9])${escapeRegExp(STRIPE_TEST)}[A-Za-z0-9]{16,}`, label: "SK_TEST" },
  {
    source: `(?<![A-Za-z0-9])${escapeRegExp(ANTHROPIC)}[A-Za-z0-9_\\-]{20,}`,
    label: "ANTHROPIC_KEY",
  },
  {
    source: `(?<![A-Za-z0-9])${escapeRegExp(OPENAI_PROJECT)}[A-Za-z0-9_\\-]{20,}`,
    label: "OPENAI_PROJECT_KEY",
  },
  {
    source: `(?<![A-Za-z0-9])${escapeRegExp(OPENROUTER)}[A-Za-z0-9]{20,}`,
    label: "OPENROUTER_KEY",
  },
  { source: `(?<![A-Za-z0-9])AIza[0-9A-Za-z_\\-]{35}(?![0-9A-Za-z_\\-])`, label: "GOOGLE_API_KEY" },
  {
    source: `(?<![A-Za-z0-9])${escapeRegExp(GITHUB)}[A-Za-z0-9]{36}(?![A-Za-z0-9])`,
    label: "GITHUB_TOKEN",
  },
  {
    source: `(?<![A-Za-z0-9])${escapeRegExp(GITHUB_OAUTH)}[A-Za-z0-9]{36}(?![A-Za-z0-9])`,
    label: "GITHUB_OAUTH",
  },
  {
    source: `(?<![A-Za-z0-9])${escapeRegExp(GITHUB_FINE)}[A-Za-z0-9_]{22,}`,
    label: "GITHUB_FINE_GRAINED_PAT",
  },
  {
    source: `(?<![A-Za-z0-9])${escapeRegExp(AWS)}[0-9A-Z]{16}(?![0-9A-Z])`,
    label: "AWS_ACCESS_KEY",
  },
  {
    source: String.raw`\bBearer\s+eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}`,
    label: "BEARER_JWT",
  },
  {
    source: String.raw`[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]{8,}@`,
    label: "URL_BASIC_AUTH",
  },
];

const ASSIGNMENT_SOURCE =
  "(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|token)\\s*[:=]\\s*([A-Za-z0-9+/_=-]{20,})";

export function findBuiltinSecretSpans(text: string): readonly Span[] {
  const spans: Span[] = [];
  for (const pattern of BUILTIN) {
    const regex = new RegExp(pattern.source, "gi");
    for (const match of text.matchAll(regex)) {
      const start = match.index ?? 0;
      spans.push({ start, end: start + match[0].length, label: pattern.label });
    }
  }
  for (const match of text.matchAll(new RegExp(ASSIGNMENT_SOURCE, "gi"))) {
    const value = match[1];
    if (!value || !isHighEntropySecret(value)) continue;
    const start = (match.index ?? 0) + match[0].length - value.length;
    spans.push({ start, end: start + value.length, label: "HIGH_ENTROPY" });
  }
  return spans;
}

function isHighEntropySecret(value: string): boolean {
  if (value.length < 20) return false;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return false;
  const lowered = value.toLowerCase();
  if (
    lowered.includes("example") ||
    lowered.includes("redacted") ||
    lowered.includes("placeholder")
  )
    return false;
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy >= 3.4;
}

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-api-token",
]);

export function redactSensitiveHeader(value: string, redactor: SecretRedactor): string {
  const redacted = redactor.redact(value);
  if (redacted !== value) return redacted;
  return value.length === 0 ? "" : "[REDACTED:HEADER]";
}

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.toLowerCase());
}
