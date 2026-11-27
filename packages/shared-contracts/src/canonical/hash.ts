import { createHash } from "node:crypto";
import { z } from "zod";
import { CanonicalizationError } from "./errors.js";
import { canonicalizeJson } from "./canonicalize.js";
import { normalizeNfc } from "./normalize.js";

export const CONTENT_HASH_ALGORITHM = "sha256" as const;
export const CONTENT_HASH_PREFIX = "sha256:" as const;

export type Sha256Prefixed = `sha256:${string}`;

const BARE_SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const PREFIXED_SHA256_RE = /^sha256:[0-9a-f]{64}$/;

export const Sha256PrefixedSchema = z.string().regex(PREFIXED_SHA256_RE);
export const Sha256HexSchema = z.string().regex(BARE_SHA256_HEX_RE);

export { canonicalizeJson as canonicalJson } from "./canonicalize.js";

/** SHA-256 over the UTF-8 bytes of `text`, prefixed with `sha256:`. */
export function digestSha256(text: string): Sha256Prefixed {
  const hex = createHash("sha256").update(text, "utf8").digest("hex");
  return `${CONTENT_HASH_PREFIX}${hex}`;
}

/** Validate and normalize a bare or `sha256:`-prefixed lowercase 64-hex SHA-256 digest to bare 64-char hex. */
export function toBareSha256Hex(digest: string): string {
  if (typeof digest !== "string") {
    throw new CanonicalizationError(
      "invalid_input",
      "SHA-256 digest must be a 64-character lowercase hex string or sha256:<hex>",
    );
  }
  if (BARE_SHA256_HEX_RE.test(digest)) {
    return digest;
  }
  if (PREFIXED_SHA256_RE.test(digest)) {
    return digest.slice(CONTENT_HASH_PREFIX.length);
  }
  throw new CanonicalizationError(
    "invalid_input",
    "SHA-256 digest must be 64 lowercase hex characters or 'sha256:<64-lowercase-hex>'",
  );
}

/** Validate and normalize a bare or `sha256:`-prefixed lowercase 64-hex SHA-256 digest to `sha256:<hex>`. */
export function toPrefixedSha256(digest: string): Sha256Prefixed {
  return `${CONTENT_HASH_PREFIX}${toBareSha256Hex(digest)}`;
}

/** RFC 8785 JCS canonical JSON string hashed with SHA-256 as `sha256:<64-lowercase-hex>`. */
export function canonicalSha256(value: unknown): Sha256Prefixed {
  return digestSha256(canonicalizeJson(value));
}

export interface NodeContent {
  kind: string;
  title: string;
  text: string;
  fields?: unknown;
}

export interface SearchQuery {
  query: unknown;
  filters: unknown;
}

export interface SearchResultRef {
  id: string;
  version: number;
}

function hashJson(value: unknown): string {
  return digestSha256(canonicalizeJson(normalizeNfc(value)));
}

function requireString(label: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new CanonicalizationError("invalid_input", `${label} must be a string`);
  }
  return value;
}

/** SHA-256 over canonical NFC `{ kind, title, text, fields }`. */
export function computeNodeContentHash(node: NodeContent): string {
  const payload = {
    kind: requireString("kind", node.kind),
    title: requireString("title", node.title),
    text: requireString("text", node.text),
    fields: node.fields === undefined ? {} : node.fields,
  };
  return hashJson(payload);
}

/** Idempotency digest of an operation request payload. */
export function computeRequestHash(request: unknown): string {
  return hashJson(request);
}

/** Digest of canonical `{ query, filters }` for `search_reads.query_hash`. */
export function computeSearchQueryHash(input: SearchQuery): string {
  if (input === null || typeof input !== "object" || !("query" in input) || !("filters" in input)) {
    throw new CanonicalizationError(
      "invalid_input",
      "search query hash requires query and filters",
    );
  }
  return hashJson({ query: input.query, filters: input.filters });
}

/**
 * Digest of a search result set. Entries are sorted by id, then version.
 * The empty set has its own stable hash.
 */
export function computeResultSetHash(results: readonly SearchResultRef[]): string {
  if (!Array.isArray(results)) {
    throw new CanonicalizationError("invalid_input", "result set must be an array");
  }
  const sorted = results.map((entry) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.id !== "string" ||
      !Number.isSafeInteger(entry.version)
    ) {
      throw new CanonicalizationError(
        "invalid_input",
        "result entries require a string id and an integer version",
      );
    }
    return { id: entry.id, version: entry.version };
  });
  sorted.sort((left, right) => {
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    if (left.version < right.version) return -1;
    if (left.version > right.version) return 1;
    return 0;
  });
  return hashJson(sorted);
}
