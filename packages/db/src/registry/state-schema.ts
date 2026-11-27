import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { splitSearchText as canonicalSplitSearchText } from "@ef-harness/shared-contracts";

const RELATIONS_QUERY = "relations_in_fields";

let cachedStateSql: string | undefined;
let cachedQueries: Map<string, string> | undefined;

function repositoryRoot(): string {
  const starts = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (let hop = 0; hop < 8; hop += 1) {
      const stateSql = path.join(dir, "schema", "state.sql");
      const queriesSql = path.join(dir, "schema", "queries.sql");
      if (fs.existsSync(stateSql) && fs.existsSync(queriesSql)) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("Could not locate schema/state.sql and schema/queries.sql.");
}

function readSchemaFile(name: "state.sql" | "queries.sql"): string {
  return fs.readFileSync(path.join(repositoryRoot(), "schema", name), "utf8").replaceAll("\r\n", "\n");
}

/** Canonical `ef_search_text` splitter shared with every state.db connection. */
export function splitSearchText(value: SQLOutputValue): string {
  return canonicalSplitSearchText(value);
}

export function stateSchemaSql(): string {
  cachedStateSql ??= readSchemaFile("state.sql");
  return cachedStateSql;
}

export function namedQuery(name: string): string {
  cachedQueries ??= parseNamedQueries(readSchemaFile("queries.sql"));
  const sql = cachedQueries.get(name);
  if (sql === undefined) {
    throw new Error(`schema/queries.sql has no statement named ${name}.`);
  }
  return sql;
}

export function relationsInFieldsSql(): string {
  return namedQuery(RELATIONS_QUERY);
}

/**
 * In-memory `state.db` with the canonical schema and `ef_search_text`.
 * Task 013's `ProjectStateDb` writer is the same `node:sqlite` connection once it exists.
 */
export function openMemoryStateDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.function("ef_search_text", { deterministic: true }, splitSearchText);
  db.exec(stateSchemaSql());
  return db;
}

function parseNamedQueries(text: string): Map<string, string> {
  const queries = new Map<string, string>();
  for (const block of text.split(/^-- name: /m).slice(1)) {
    const [nameLine, ...rest] = block.split("\n");
    const name = (nameLine ?? "").trim();
    if (!name) continue;
    const sql = rest
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/, "");
    queries.set(name, sql);
  }
  return queries;
}
