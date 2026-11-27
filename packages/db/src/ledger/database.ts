import { DatabaseSync } from "node:sqlite";
import { splitSearchText } from "@ef-harness/shared-contracts";
import { loadCanonicalQueries } from "./canonical-queries.js";

export function openLedgerDatabase(filename = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(filename, { timeout: 5_000 });
  db.exec("PRAGMA foreign_keys = ON");
  if (filename !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }
  db.function("ef_search_text", { deterministic: true }, (value) => splitSearchText(value));
  db.exec(loadCanonicalQueries().stateSchema);
  return db;
}
