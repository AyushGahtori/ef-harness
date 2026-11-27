import { Buffer } from "node:buffer";
import { formatRedactionBadge } from "./badge.js";
import { PacketSecurityRedactor } from "./packet-security-redactor.js";
import { Pseudonymizer } from "./pii.js";
import { SafetyScanner } from "./safety-scanner.js";
import { fieldPlaceholder, isSensitiveKey, redactFreeText, redactHeaderValue } from "./secrets.js";
import {
  HAR_SUMMARY_MAX_BYTES,
  MALFORMED_HAR_MESSAGE,
  RESIDUAL_SECRET_MESSAGE,
  mutableCounts,
  type FailingHttpRequest,
  type HeaderPair,
  type MutableCounts,
  type QueryPair,
  type ScrubbedBody,
  type ScrubbedEntry,
  type ScrubbedHar,
  type ScrubResult,
  type TruncatedBody,
} from "./types.js";

const BINARY_MIME = /^(image|audio|video|font)\//i;
const BINARY_EXACT = new Set([
  "application/octet-stream",
  "application/wasm",
  "application/font-woff",
  "application/font-woff2",
  "application/vnd.ms-fontobject",
  "application/x-font-ttf",
  "application/x-font-otf",
  "application/x-font-woff",
]);

export interface ScrubOptions {
  readonly pii?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function absorb(target: MutableCounts, extra: MutableCounts): void {
  target.authCookies += extra.authCookies;
  target.authHeaders += extra.authHeaders;
  target.jwtTokens += extra.jwtTokens;
  target.apiKeys += extra.apiKeys;
  target.postgresUrls += extra.postgresUrls;
  target.pemBlocks += extra.pemBlocks;
  target.sensitiveFields += extra.sensitiveFields;
  target.hiddenUnicode += extra.hiddenUnicode;
  target.emails += extra.emails;
  target.phones += extra.phones;
  target.ips += extra.ips;
}

function scrubLeaf(value: string, counts: MutableCounts, pii: Pseudonymizer | null): string {
  const redacted = redactFreeText(value, counts);
  return pii ? pii.apply(redacted, counts) : redacted;
}

function mimeOf(record: Record<string, unknown>): string {
  const mime = asString(record.mimeType) || asString(record.contentType) || "application/octet-stream";
  return mime.split(";")[0]?.trim() || "application/octet-stream";
}

function shouldTruncate(mime: string, byteLength: number, text: string): boolean {
  const normalized = mime.toLowerCase();
  if (BINARY_MIME.test(normalized) || BINARY_EXACT.has(normalized)) return true;
  if (byteLength >= 64 * 1024 || Buffer.byteLength(text) >= 64 * 1024) return true;
  if (/javascript|ecmascript/.test(normalized) && Buffer.byteLength(text) > 8 * 1024) return true;
  return false;
}

function truncated(mime: string, byteLength: number): TruncatedBody {
  return { contentType: mime, byteLength, truncated: true };
}

function redactJsonValue(value: unknown, counts: MutableCounts, pii: Pseudonymizer | null): unknown {
  if (typeof value === "string") return scrubLeaf(value, counts, pii);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => redactJsonValue(item, counts, pii));
  if (!isRecord(value)) return null;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      if (typeof child === "string") {
        const scratch = mutableCounts();
        redactFreeText(child, scratch);
        absorb(counts, scratch);
      }
      output[key] = fieldPlaceholder(key);
      counts.sensitiveFields += 1;
      continue;
    }
    output[key] = redactJsonValue(child, counts, pii);
  }
  return output;
}

function scrubBody(record: Record<string, unknown> | null, counts: MutableCounts, pii: Pseudonymizer | null): ScrubbedBody | null {
  if (!record) return null;
  const mime = mimeOf(record);
  const text = asString(record.text);
  const declared = typeof record.size === "number" && Number.isFinite(record.size) ? record.size : 0;
  const byteLength = Math.max(declared, Buffer.byteLength(text));
  if (text.length === 0 && declared === 0 && !asString(record.mimeType) && !asString(record.contentType)) {
    return null;
  }
  if (shouldTruncate(mime, byteLength, text)) {
    if (text.length > 0) {
      const scratch = mutableCounts();
      redactFreeText(text, scratch);
      absorb(counts, scratch);
    }
    return truncated(mime, byteLength);
  }
  const trimmed = text.trim();
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && /json|text\/plain|application\/x-www-form-urlencoded|\+json/i.test(mime) || (trimmed.startsWith("{") || trimmed.startsWith("["))) {
    try {
      const parsed: unknown = JSON.parse(text);
      const cleaned = redactJsonValue(parsed, counts, pii);
      const encoded = JSON.stringify(cleaned);
      return { mimeType: mime, text: encoded };
    } catch {
      return { mimeType: mime, text: scrubLeaf(text, counts, pii) };
    }
  }
  return { mimeType: mime, text: scrubLeaf(text, counts, pii) };
}

function readHeaders(raw: unknown, counts: MutableCounts, pii: Pseudonymizer | null): HeaderPair[] {
  const pairs: HeaderPair[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isRecord(item)) continue;
      const name = asString(item.name);
      if (!name) continue;
      pairs.push({ name, value: finishHeader(name, asString(item.value), counts, pii) });
    }
    return pairs;
  }
  if (isRecord(raw)) {
    for (const [name, value] of Object.entries(raw)) {
      pairs.push({ name, value: finishHeader(name, asString(value), counts, pii) });
    }
  }
  return pairs;
}

function finishHeader(name: string, value: string, counts: MutableCounts, pii: Pseudonymizer | null): string {
  const redacted = redactHeaderValue(name, value, counts);
  if (!pii || redacted.startsWith("[REDACTED:")) return redacted;
  return pii.apply(redacted, counts);
}

function redactUrl(raw: string, counts: MutableCounts, pii: Pseudonymizer | null): string {
  const hashAt = raw.indexOf("#");
  const hash = hashAt >= 0 ? raw.slice(hashAt) : "";
  const beforeHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const queryAt = beforeHash.indexOf("?");
  const base = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  const query = queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "";
  const redactedQuery = query
    .split("&")
    .filter((part) => part.length > 0)
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq < 0) return part;
      const name = part.slice(0, eq);
      const value = part.slice(eq + 1);
      if (!isSensitiveKey(safeDecode(name))) return part;
      const scratch = mutableCounts();
      redactFreeText(safeDecode(value), scratch);
      absorb(counts, scratch);
      counts.sensitiveFields += 1;
      return `${name}=${fieldPlaceholder(name)}`;
    })
    .join("&");
  const assembled = `${base}${redactedQuery.length > 0 ? `?${redactedQuery}` : ""}${hash}`;
  return scrubLeaf(assembled, counts, pii);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readQuery(raw: unknown, counts: MutableCounts, pii: Pseudonymizer | null): QueryPair[] {
  if (!Array.isArray(raw)) return [];
  const pairs: QueryPair[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = asString(item.name);
    if (!name) continue;
    const value = asString(item.value);
    if (isSensitiveKey(name)) {
      const scratch = mutableCounts();
      redactFreeText(value, scratch);
      absorb(counts, scratch);
      counts.sensitiveFields += 1;
      pairs.push({ name, value: fieldPlaceholder(name) });
      continue;
    }
    pairs.push({ name, value: scrubLeaf(value, counts, pii) });
  }
  return pairs;
}

function readPostData(raw: unknown, counts: MutableCounts, pii: Pseudonymizer | null): ScrubbedBody | null {
  if (!isRecord(raw)) return null;
  if (Array.isArray(raw.params) && asString(raw.text).length === 0) {
    const params = raw.params
      .filter(isRecord)
      .map((item) => {
        const name = asString(item.name);
        const value = asString(item.value);
        if (isSensitiveKey(name)) {
          counts.sensitiveFields += 1;
          return `${name}=${fieldPlaceholder(name)}`;
        }
        return `${name}=${scrubLeaf(value, counts, pii)}`;
      })
      .join("&");
    return scrubBody(
      { mimeType: asString(raw.mimeType) || "application/x-www-form-urlencoded", text: params, size: Buffer.byteLength(params) },
      counts,
      pii,
    );
  }
  return scrubBody(raw, counts, pii);
}

function readEntry(raw: unknown, counts: MutableCounts, pii: Pseudonymizer | null): ScrubbedEntry | null {
  if (!isRecord(raw)) return null;
  const request = isRecord(raw.request) ? raw.request : {};
  const response = isRecord(raw.response) ? raw.response : {};
  const status = typeof response.status === "number" && Number.isFinite(response.status) ? response.status : 0;
  return {
    startedDateTime: typeof raw.startedDateTime === "string" ? raw.startedDateTime : null,
    request: {
      method: asString(request.method) || "GET",
      url: redactUrl(asString(request.url), counts, pii),
      headers: readHeaders(request.headers, counts, pii),
      queryString: readQuery(request.queryString, counts, pii),
      postData: readPostData(request.postData, counts, pii),
    },
    response: {
      status,
      statusText: asString(response.statusText),
      headers: readHeaders(response.headers, counts, pii),
      content: isRecord(response.content) ? scrubBody(response.content, counts, pii) : null,
    },
  };
}

function shape(version: string, entries: readonly ScrubbedEntry[], truncatedEntries: number): ScrubbedHar {
  return { log: { version, entries, truncatedEntries } };
}

function enforceBound(version: string, entries: readonly ScrubbedEntry[]): ScrubbedHar {
  let kept = entries;
  let truncatedEntries = 0;
  const measure = (items: readonly ScrubbedEntry[], dropped: number): number =>
    Buffer.byteLength(JSON.stringify(shape(version, items, dropped)));
  while (kept.length > 1 && measure(kept, truncatedEntries) > HAR_SUMMARY_MAX_BYTES) {
    const next = Math.max(1, Math.floor(kept.length / 2));
    truncatedEntries += kept.length - next;
    kept = kept.slice(0, next);
  }
  if (measure(kept, truncatedEntries) > HAR_SUMMARY_MAX_BYTES && kept[0]) {
    const only = stripEntryBodies(kept[0]);
    kept = [only];
  }
  return shape(version, kept, truncatedEntries);
}

function stripEntryBodies(entry: ScrubbedEntry): ScrubbedEntry {
  return {
    ...entry,
    request: {
      ...entry.request,
      postData: entry.request.postData ? asTruncated(entry.request.postData) : null,
    },
    response: {
      ...entry.response,
      content: entry.response.content ? asTruncated(entry.response.content) : null,
    },
  };
}

function asTruncated(body: ScrubbedBody): TruncatedBody {
  if ("truncated" in body) return body;
  return truncated(body.mimeType, Buffer.byteLength(body.text));
}

function parseInput(input: string | unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof input !== "string") {
    if (!isRecord(input)) return { ok: false };
    return { ok: true, value: input };
  }
  const trimmed = input.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false };
  }
}

function malformed(): ScrubResult<ScrubbedHar> {
  return { ok: false, code: "malformed_har", message: MALFORMED_HAR_MESSAGE };
}

/**
 * Deterministic HAR, log, stack, and issue scrubber.
 * Raw secrets stay in the caller's ephemeral string and are never returned once a residual pattern remains.
 */
export class HarAndLogScrubber {
  private readonly redactor: PacketSecurityRedactor;
  private readonly scanner: SafetyScanner;

  constructor(deps?: { readonly redactor?: PacketSecurityRedactor; readonly scanner?: SafetyScanner }) {
    this.redactor = deps?.redactor ?? new PacketSecurityRedactor();
    this.scanner = deps?.scanner ?? new SafetyScanner();
  }

  scrubLog(text: string, options?: ScrubOptions): ScrubResult<string> {
    const counts = mutableCounts();
    const pii = options?.pii === true ? new Pseudonymizer() : null;
    const value = scrubLeaf(text, counts, pii);
    return this.seal(value, counts, value);
  }

  scrubHar(input: string | unknown, options?: ScrubOptions): ScrubResult<ScrubbedHar> {
    const parsed = parseInput(input);
    if (!parsed.ok) return malformed();
    if (!isRecord(parsed.value) || !isRecord(parsed.value.log)) return malformed();
    const entriesRaw = parsed.value.log.entries;
    if (entriesRaw !== undefined && !Array.isArray(entriesRaw)) return malformed();
    const counts = mutableCounts();
    const pii = options?.pii === true ? new Pseudonymizer() : null;
    const entries: ScrubbedEntry[] = [];
    for (const item of entriesRaw ?? []) {
      const entry = readEntry(item, counts, pii);
      if (entry) entries.push(entry);
    }
    const version = asString(parsed.value.log.version) || "1.2";
    const bounded = enforceBound(version, entries);
    return this.seal(bounded, counts, JSON.stringify(bounded));
  }

  private seal<T>(value: T, counts: MutableCounts, serialized: string): ScrubResult<T> {
    if (this.redactor.scan(serialized).length > 0 || this.scanner.scan(serialized).length > 0) {
      return { ok: false, code: "residual_secret", message: RESIDUAL_SECRET_MESSAGE };
    }
    return {
      ok: true,
      value,
      badge: formatRedactionBadge(counts),
      counts: { ...counts },
    };
  }
}

export function failingHttpRequests(har: ScrubbedHar): FailingHttpRequest[] {
  const requests: FailingHttpRequest[] = [];
  for (const entry of har.log.entries) {
    if (entry.response.status < 400) continue;
    requests.push({
      method: entry.request.method,
      url: entry.request.url,
      status: entry.response.status,
    });
  }
  return requests;
}

export function condenseHarTimeline(har: ScrubbedHar): string {
  return har.log.entries
    .map((entry) => `${entry.request.method} ${entry.request.url} ${entry.response.status}`)
    .join("\n");
}
