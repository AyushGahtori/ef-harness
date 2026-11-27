import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** packages/sim/src/m0 -> repository root. */
export const repoRoot = path.resolve(here, "../../../..");

export type SqlCell = string | number | bigint | Uint8Array | null;
export type SqlRow = Record<string, SqlCell>;
export type SqlParam = SqlCell;

let queryMap: Map<string, string> | undefined;

export function readSchema(name: "state.sql" | "global.sql" | "queries.sql"): string {
  return fs.readFileSync(path.join(repoRoot, "schema", name), "utf8");
}

export function loadQueries(): ReadonlyMap<string, string> {
  if (!queryMap) {
    queryMap = new Map();
    const sql = readSchema("queries.sql");
    for (const block of sql.split(/^-- name: /m).slice(1)) {
      const newline = block.indexOf("\n");
      const name = block.slice(0, newline).trim();
      const body = block
        .slice(newline + 1)
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
        .replace(/;\s*$/, "");
      queryMap.set(name, body);
    }
  }
  return queryMap;
}

export function querySql(name: string): string {
  const sql = loadQueries().get(name);
  if (!sql) throw new Error(`missing canonical query ${name}`);
  return sql;
}

export function asNumber(value: SqlCell | undefined, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`${label} was not a number`);
}

export function asString(value: SqlCell | undefined, label: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  throw new Error(`${label} was not a string`);
}

export interface NamedStatement {
  run(params: Record<string, SqlParam>): { changes: number };
  all(params: Record<string, SqlParam>): SqlRow[];
}

export function runNamed(statement: NamedStatement, params: Record<string, SqlParam>): number {
  return Number(statement.run(params).changes);
}

export function allNamed(statement: NamedStatement, params: Record<string, SqlParam>): SqlRow[] {
  return statement.all(params);
}
