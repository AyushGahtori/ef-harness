import { createHash } from "node:crypto";

export interface SearchResultItem {
  readonly id: string;
  readonly version: number;
}

export function canonicalSearchResultHash(items: readonly SearchResultItem[]): string {
  const sorted = [...items].sort((left, right) => {
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    return left.version - right.version;
  });
  const body = JSON.stringify(sorted.map((item) => [item.id, item.version]));
  return createHash("sha256").update(body).digest("hex");
}

export const EMPTY_SEARCH_RESULT_HASH = canonicalSearchResultHash([]);
