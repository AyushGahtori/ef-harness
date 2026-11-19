import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LedgerInvariantError } from "./errors.js";

export type CanonicalQueryName = "reserve" | "settle" | "settle_mark" | "release" | "budget_remaining";

export interface CanonicalQueries {
  reserve: string;
  settle: string;
  settle_mark: string;
  release: string;
  budget_remaining: string;
  stateSchema: string;
}

let cached: CanonicalQueries | undefined;

export function loadCanonicalQueries(): CanonicalQueries {
  if (cached) return cached;
  const root = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
  const queries = parseNamedQueries(fs.readFileSync(path.join(root, "schema", "queries.sql"), "utf8"));
  const loaded = {
    reserve: requiredQuery(queries, "reserve"),
    settle: requiredQuery(queries, "settle"),
    settle_mark: requiredQuery(queries, "settle_mark"),
    release: requiredQuery(queries, "release"),
    budget_remaining: requiredQuery(queries, "budget_remaining"),
    stateSchema: fs.readFileSync(path.join(root, "schema", "state.sql"), "utf8"),
  };
  cached = loaded;
  return loaded;
}

function requiredQuery(queries: Map<string, string>, name: CanonicalQueryName): string {
  const sql = queries.get(name);
  if (!sql) throw new LedgerInvariantError(`schema/queries.sql is missing ${name}`);
  return sql;
}

export function parseNamedQueries(sql: string): Map<string, string> {
  const queries = new Map<string, string>();
  for (const block of sql.split(/^-- name: /m).slice(1)) {
    const [name, ...rest] = block.split("\n");
    if (!name) continue;
    const text = rest
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/u, "");
    queries.set(name.trim(), text);
  }
  return queries;
}

function findRepoRoot(start: string): string {
  let dir = start;
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      fs.existsSync(path.join(dir, "schema", "queries.sql")) &&
      fs.existsSync(path.join(dir, "schema", "state.sql"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new LedgerInvariantError("Cannot locate schema/queries.sql from the ledger package");
}
