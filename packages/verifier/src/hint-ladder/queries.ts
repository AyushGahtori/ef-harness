import { readFileSync } from "node:fs";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import { CanonicalQueryMissingError } from "./errors.js";

export type NamedQueries = ReadonlyMap<string, string>;

export function loadCanonicalQueries(): NamedQueries {
  const sql = readFileSync(canonicalAssetAbsolute("queriesSql"), "utf8").replace(/\r\n/g, "\n");
  const queries = new Map<string, string>();
  for (const block of sql.split(/^-- name: /m).slice(1)) {
    const [rawName, ...rest] = block.split("\n");
    if (!rawName) continue;
    const text = rest
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/, "");
    queries.set(rawName.trim(), text);
  }
  return queries;
}

export function requireQuery(queries: NamedQueries, name: string): string {
  const sql = queries.get(name);
  if (!sql) throw new CanonicalQueryMissingError(name);
  return sql;
}
