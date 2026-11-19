import { createHash } from "node:crypto";
import { CanonicalizationError } from "./errors.js";
import { canonicalizeJson } from "./canonicalize.js";
import { normalizeNfc } from "./normalize.js";

export const CONTENT_HASH_ALGORITHM = "sha256" as const;
export const CONTENT_HASH_PREFIX = "sha256:" as const;

/** SHA-256 over the UTF-8 bytes of `text`, prefixed with `sha256:`. */
export function digestSha256(text: string): string {
  const hex = createHash("sha256").update(text, "utf8").digest("hex");
  return `${CONTENT_HASH_PREFIX}${hex}`;
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
