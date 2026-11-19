import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QueryCatalogError, UnknownCanonicalQueryError } from "./errors.js";

export const CANONICAL_GRANT_QUERIES = [
  "deposit_grant",
  "deposit_grant_budget",
  "close_grant",
  "close_grant_receipt",
  "global_expire_grants",
] as const;

export type CanonicalGrantQueryName = (typeof CANONICAL_GRANT_QUERIES)[number];

const PARAMETER_PATTERN = /(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g;

export interface QueryCatalog {
  readonly root: string;
  sql(name: string): string;
  parameterNames(name: string): readonly string[];
}

export function findRepositoryRoot(): string {
  const starts = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (let depth = 0; depth < 10; depth += 1) {
      const queries = path.join(dir, "schema", "queries.sql");
      const state = path.join(dir, "schema", "state.sql");
      const globalSql = path.join(dir, "schema", "global.sql");
      if (fs.existsSync(queries) && fs.existsSync(state) && fs.existsSync(globalSql)) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  throw new QueryCatalogError("schema/queries.sql was not found from the grant package.");
}

export function loadQueryCatalog(root = findRepositoryRoot()): QueryCatalog {
  const file = path.join(root, "schema", "queries.sql");
  const text = fs.readFileSync(file, "utf8");
  const queries = new Map<string, string>();
  for (const block of text.split(/^-- name: /m).slice(1)) {
    const [rawName, ...rest] = block.split("\n");
    const name = rawName?.trim() ?? "";
    if (!name) {
      continue;
    }
    const sql = rest
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/, "");
    queries.set(name, sql);
  }
  for (const name of CANONICAL_GRANT_QUERIES) {
    if (!queries.has(name)) {
      throw new QueryCatalogError(`schema/queries.sql is missing ${name}.`);
    }
  }
  return {
    root,
    sql(name: string): string {
      const sql = queries.get(name);
      if (sql === undefined) {
        throw new UnknownCanonicalQueryError(name);
      }
      return sql;
    },
    parameterNames(name: string): readonly string[] {
      const sql = queries.get(name);
      if (sql === undefined) {
        throw new UnknownCanonicalQueryError(name);
      }
      const names = new Set<string>();
      for (const match of sql.matchAll(PARAMETER_PATTERN)) {
        const parameter = match[1];
        if (parameter) {
          names.add(parameter);
        }
      }
      return [...names];
    },
  };
}

export function schemaFile(root: string, name: "state.sql" | "global.sql"): string {
  return fs.readFileSync(path.join(root, "schema", name), "utf8");
}
