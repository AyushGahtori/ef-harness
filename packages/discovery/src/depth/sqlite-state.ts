import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";

/**
 * Resolves `schema/state.sql`. This is the same asset as
 * `canonicalAssetAbsolute("stateSql")` from `@ef-harness/shared-contracts`.
 * The published barrel points at `dist`, which is not built on this base, so
 * the depth package reads the schema file directly until that barrel is wired.
 */
export function stateSchemaPath(): string {
  return fileURLToPath(new URL("../../../../schema/state.sql", import.meta.url));
}

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
  db.function("ef_search_text", { deterministic: true }, (value: SQLOutputValue) => splitSearchText(value ?? null));
  const existing = db
    .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'nodes'")
    .get() as { c: number } | undefined;
  if (!existing || Number(existing.c) === 0) {
    db.exec(fs.readFileSync(stateSchemaPath(), "utf8"));
  }
  return db;
}

export function splitSearchText(value: SQLOutputValue): string {
  if (typeof value !== "string" || value.length === 0) return "";
  const extra = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ");
  return `${value} ${extra}`;
}
