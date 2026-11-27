import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { registerEfSearchText } from "@ef-harness/db";
import { canonicalAssetAbsolute, splitSearchText as splitCanonicalSearchText } from "@ef-harness/shared-contracts";

export function stateSchemaPath(): string {
  return canonicalAssetAbsolute("stateSql");
}

export function splitSearchText(value: SQLOutputValue): string {
  return splitCanonicalSearchText(value);
}

/** Open state.db and apply schema/state.sql, including the search UDF the triggers call. */
export function openStateDatabase(filename: string): DatabaseSync {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA secure_delete = ON");
  db.exec("PRAGMA journal_size_limit = 67108864");
  db.exec("PRAGMA temp_store = MEMORY");
  db.exec("PRAGMA synchronous = FULL");
  if (filename !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }
  registerEfSearchText(db);
  const existing = db
    .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'nodes'")
    .get() as { c: number } | undefined;
  if (!existing || Number(existing.c) === 0) {
    db.exec(fs.readFileSync(stateSchemaPath(), "utf8"));
  }
  return db;
}
