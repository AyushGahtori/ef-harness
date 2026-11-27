import { DatabaseSync } from "node:sqlite";
import { loadCanonicalSqlAsset, lookupNamedQuery } from "../driver/query-catalog.js";
import { registerEfSearchText } from "../driver/search-text.js";

const RELATIONS_QUERY = "relations_in_fields";

let cachedStateSql: string | undefined;

export function stateSchemaSql(): string {
  cachedStateSql ??= loadCanonicalSqlAsset("stateSql");
  return cachedStateSql;
}

export function namedQuery(name: string): string {
  return lookupNamedQuery(name);
}

export function relationsInFieldsSql(): string {
  return namedQuery(RELATIONS_QUERY);
}

/**
 * In-memory `state.db` with the canonical schema and `ef_search_text`.
 * Production callers pass `ProjectStateDb.writer` through `bindNameRegistry`.
 */
export function openMemoryStateDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  registerEfSearchText(db);
  db.exec(stateSchemaSql());
  return db;
}
