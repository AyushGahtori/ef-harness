import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CANONICAL_QUERY_NAMES = [
  "advance_feature_leaves_merged",
  "requirement_status_recompute",
  "register_delivery",
] as const;

export type CanonicalQueryName = (typeof CANONICAL_QUERY_NAMES)[number];

export function repositoryRootFromModule(moduleUrl: string = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..", "..", "..", "..");
}

export function canonicalQueriesPath(moduleUrl: string = import.meta.url): string {
  return path.join(repositoryRootFromModule(moduleUrl), "schema", "queries.sql");
}

export function canonicalStateSqlPath(moduleUrl: string = import.meta.url): string {
  return path.join(repositoryRootFromModule(moduleUrl), "schema", "state.sql");
}

/**
 * Parse `-- name:` blocks the same way schema/schema-test.js does, so the
 * statements executed here are the file text rather than a second copy.
 */
export function parseNamedQueries(sqlText: string): Map<string, string> {
  const queries = new Map<string, string>();
  for (const block of sqlText.split(/^-- name: /m).slice(1)) {
    const newline = block.indexOf("\n");
    const name = (newline === -1 ? block : block.slice(0, newline)).trim();
    const body = (newline === -1 ? "" : block.slice(newline + 1))
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/, "");
    if (name.length > 0 && body.length > 0) queries.set(name, body);
  }
  return queries;
}

export function loadCanonicalQueries(sqlText?: string): Map<string, string> {
  const text = sqlText ?? readFileSync(canonicalQueriesPath(), "utf8");
  const queries = parseNamedQueries(text);
  for (const name of CANONICAL_QUERY_NAMES) {
    if (!queries.has(name)) {
      throw new Error(`schema/queries.sql is missing canonical statement ${name}`);
    }
  }
  return queries;
}
