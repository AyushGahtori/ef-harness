import type { SearchFilters } from "./types.js";
import type { SqlValue } from "./types.js";

export const SEARCH_PAGE_MAX = 500;
export const SEARCH_READ_CAP = 50;
export const DEFAULT_PAGE_LIMIT = 50;
export const DEFAULT_SNIPPET_CHARS = 180;
export const DEFAULT_TOKEN_BUDGET = 1200;

const NODE_STATUSES = new Set(["draft", "active", "retired", "superseded"]);

export interface NormalizedFilters {
  readonly kinds: readonly string[];
  readonly feature: string | null;
  readonly status: string;
  readonly basis: readonly string[];
  readonly tags: readonly string[];
  readonly limit: number;
  readonly excludeHiddenChecks: true;
}

export interface SqlFilter {
  readonly sql: string;
  readonly params: Record<string, SqlValue>;
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_LIMIT;
  const truncated = Math.trunc(limit);
  if (truncated < 1) return 1;
  if (truncated > SEARCH_PAGE_MAX) return SEARCH_PAGE_MAX;
  return truncated;
}

export function normalizeFilters(input: SearchFilters): NormalizedFilters {
  const status = input.status === undefined ? "active" : input.status;
  return {
    kinds: uniqueSorted(input.kinds),
    feature: input.feature === undefined ? null : input.feature,
    status,
    basis: uniqueSorted(input.basis),
    tags: uniqueSorted(input.tags),
    limit: clampLimit(input.limit),
    excludeHiddenChecks: true,
  };
}

/**
 * Predicate over `nodes` using the primary key and `nodes_kind_feature`
 * (`kind`, `feature` WHERE `status = 'active'`). Values are bound, never concatenated.
 */
export function nodeFilterSql(filters: NormalizedFilters, options: { excludeHiddenChecks: boolean }): SqlFilter {
  const parts: string[] = [];
  const params: Record<string, SqlValue> = {};
  if (NODE_STATUSES.has(filters.status)) {
    parts.push(`n.status = '${filters.status}'`);
  } else {
    parts.push("n.status = :status");
    params.status = filters.status;
  }
  if (filters.feature !== null) {
    parts.push("n.feature = :feature");
    params.feature = filters.feature;
  }
  if (filters.kinds.length === 1) {
    parts.push("n.kind = :kind");
    params.kind = filters.kinds[0] ?? "";
  } else if (filters.kinds.length > 1) {
    parts.push("n.kind IN (SELECT value FROM json_each(:kinds_json))");
    params.kinds_json = JSON.stringify(filters.kinds);
  }
  if (filters.basis.length === 1) {
    parts.push("n.basis = :basis");
    params.basis = filters.basis[0] ?? "";
  } else if (filters.basis.length > 1) {
    parts.push("n.basis IN (SELECT value FROM json_each(:basis_json))");
    params.basis_json = JSON.stringify(filters.basis);
  }
  if (filters.tags.length > 0) {
    parts.push(`(
      SELECT count(DISTINCT want.value)
        FROM json_each(:tags_json) AS want
       WHERE EXISTS (
               SELECT 1 FROM json_each(n.fields, '$.tags') AS got WHERE got.value = want.value
             )
          OR EXISTS (
               SELECT 1 FROM json_each(n.fields, '$.touches') AS got WHERE got.value = want.value
             )
    ) = :tag_count`);
    params.tags_json = JSON.stringify(filters.tags);
    params.tag_count = filters.tags.length;
  }
  if (options.excludeHiddenChecks) {
    // Each term must be a real boolean. `NOT (NULL OR …)` is NULL and would drop every row.
    parts.push(`COALESCE(json_extract(n.fields, '$.hidden_check'), 0) NOT IN (1, '1', 'true')
      AND COALESCE(json_type(n.fields, '$.hidden_check'), '') != 'true'
      AND COALESCE(json_extract(n.fields, '$.sealed_oracle'), 0) NOT IN (1, '1', 'true')
      AND COALESCE(json_type(n.fields, '$.sealed_oracle'), '') != 'true'
      AND lower(COALESCE(json_extract(n.fields, '$.visibility'), '')) != 'hidden'
      AND COALESCE(json_extract(n.fields, '$.held_back'), 0) NOT IN (1, '1', 'true')
      AND COALESCE(json_type(n.fields, '$.held_back'), '') != 'true'`);
  }
  return { sql: parts.join(" AND "), params };
}

export function hashFilters(filters: NormalizedFilters): {
  basis: string[];
  excludeHiddenChecks: true;
  feature: string | null;
  kinds: string[];
  limit: number;
  status: string;
  tags: string[];
} {
  return {
    basis: [...filters.basis],
    excludeHiddenChecks: true,
    feature: filters.feature,
    kinds: [...filters.kinds],
    limit: filters.limit,
    status: filters.status,
    tags: [...filters.tags],
  };
}

function uniqueSorted(values: readonly string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) continue;
    unique.add(value.normalize("NFC"));
  }
  return [...unique].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
