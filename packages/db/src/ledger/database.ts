import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { loadCanonicalQueries } from "./canonical-queries.js";

export function openLedgerDatabase(filename = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(filename, { timeout: 5_000 });
  db.exec("PRAGMA foreign_keys = ON");
  if (filename !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }
  db.function("ef_search_text", { deterministic: true }, splitSearchText);
  db.exec(loadCanonicalQueries().stateSchema);
  return db;
}

function splitSearchText(value: SQLOutputValue): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const extra = text.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").replace(/[_\-./:]+/gu, " ");
  return `${text} ${extra}`;
}
