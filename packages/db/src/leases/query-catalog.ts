import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LEASE_QUERY_NAMES = [
  "claim_task",
  "create_attempt",
  "sweep_expired_leases",
  "fence_attempts",
  "open_sweep_intent",
  "grant_sweep_lease",
] as const;

export type LeaseQueryName = (typeof LEASE_QUERY_NAMES)[number];

let cachedFile: string | null = null;
let cachedCatalog: Map<string, string> | null = null;

export function loadQueryCatalog(sqlText: string): Map<string, string> {
  const queries = new Map<string, string>();
  for (const block of sqlText.split(/^-- name: /m).slice(1)) {
    const newline = block.indexOf("\n");
    const name = (newline === -1 ? block : block.slice(0, newline)).trim();
    const body = (newline === -1 ? "" : block.slice(newline + 1))
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/, "");
    if (name.length > 0) queries.set(name, body);
  }
  return queries;
}

export function canonicalQueriesFile(moduleUrl: string = import.meta.url): string {
  if (cachedFile) return cachedFile;
  const start = fileURLToPath(moduleUrl);
  let dir = path.dirname(start);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, "schema", "queries.sql");
    if (fs.existsSync(candidate)) {
      cachedFile = candidate;
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("schema/queries.sql was not found from the leases package");
}

export function repositoryRoot(moduleUrl: string = import.meta.url): string {
  return path.dirname(path.dirname(canonicalQueriesFile(moduleUrl)));
}

export function canonicalQueryCatalog(): ReadonlyMap<string, string> {
  if (cachedCatalog) return cachedCatalog;
  const text = fs.readFileSync(canonicalQueriesFile(), "utf8");
  cachedCatalog = loadQueryCatalog(text);
  return cachedCatalog;
}

export function canonicalQuery(name: LeaseQueryName): string {
  const sql = canonicalQueryCatalog().get(name);
  if (!sql) throw new Error(`canonical query ${name} is missing from schema/queries.sql`);
  return sql;
}
