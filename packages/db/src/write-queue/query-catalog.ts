import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME_LINE = /^-- name:\s*(\S+)\s*$/;

let catalog: ReadonlyMap<string, string> | undefined;

/** Named statement from `schema/queries.sql`. The write queue uses `op_lookup` and `prune_operations`. */
export function canonicalQuery(name: string): string {
  const query = loadCatalog().get(name);
  if (!query) {
    throw new Error(`unknown canonical query: ${name}`);
  }
  return query;
}

export function loadQueryCatalog(sqlText: string): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  let current: string | undefined;
  const lines: string[] = [];
  const flush = (): void => {
    if (!current) return;
    const body = lines.join("\n").trim();
    if (body.length > 0) map.set(current, body);
    lines.length = 0;
  };
  for (const line of sqlText.split(/\r?\n/)) {
    const named = NAME_LINE.exec(line);
    if (named) {
      flush();
      current = named[1];
      continue;
    }
    if (current) lines.push(line);
  }
  flush();
  return map;
}

function loadCatalog(): ReadonlyMap<string, string> {
  if (catalog) return catalog;
  const sqlPath = findQueriesSql(path.dirname(fileURLToPath(import.meta.url)));
  catalog = loadQueryCatalog(readFileSync(sqlPath, "utf8"));
  return catalog;
}

function findQueriesSql(start: string): string {
  for (const origin of [start, process.cwd()]) {
    let dir = origin;
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = path.join(dir, "schema", "queries.sql");
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("schema/queries.sql was not found from the write-queue module");
}
