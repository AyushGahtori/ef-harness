import { createHash } from "node:crypto";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort((left, right) => left.localeCompare(right))) {
      sorted[key] = sortValue(record[key]);
    }
    return sorted;
  }
  return value;
}

/** Canonical hash of a search query and its filters. */
export function searchQueryHash(query: {
  readonly query: string;
  readonly types: readonly string[];
  readonly limit: number;
}): string {
  return sha256Hex(
    canonicalJson({
      limit: query.limit,
      query: query.query,
      types: [...query.types].sort((left, right) => left.localeCompare(right)),
    }),
  );
}

/** Canonical hash of sorted result ids. The empty set hashes `[]`. */
export function searchResultHash(nodeIds: readonly string[]): string {
  const sorted = [...nodeIds].sort((left, right) => left.localeCompare(right));
  return sha256Hex(JSON.stringify(sorted));
}

export function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
