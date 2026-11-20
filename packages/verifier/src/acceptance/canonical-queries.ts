const NAME_SPLIT = /^-- name: /m;

export function loadCanonicalQueries(sql: string): ReadonlyMap<string, string> {
  const queries = new Map<string, string>();
  for (const block of sql.split(NAME_SPLIT).slice(1)) {
    const [rawName, ...rest] = block.split("\n");
    const name = rawName?.trim();
    if (!name) continue;
    const body = rest
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/, "");
    queries.set(name, body);
  }
  return queries;
}

export const CANONICAL_ACCEPTANCE_QUERIES = [
  "stale_reads_for_acceptance",
  "stale_edge_reads_for_acceptance",
  "finish_submission",
  "register_delivery",
  "requirement_status_recompute",
  "archive_turn_log",
  "purge_archived_turn_log",
] as const;

export type CanonicalAcceptanceQuery = (typeof CANONICAL_ACCEPTANCE_QUERIES)[number];

export function requireCanonicalQuery(
  queries: ReadonlyMap<string, string>,
  name: CanonicalAcceptanceQuery,
): string {
  const sql = queries.get(name);
  if (!sql) {
    throw new Error(`canonical query missing from schema/queries.sql: ${name}`);
  }
  return sql;
}
