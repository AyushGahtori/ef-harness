import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue, type StatementSync } from "node:sqlite";

const here = path.dirname(fileURLToPath(import.meta.url));

/** packages/sim/src/m0 -> repository root. */
export const repoRoot = path.resolve(here, "../../../..");

export function splitSearchText(value: SQLOutputValue): string {
  if (typeof value !== "string" || value.length === 0) return "";
  const extra = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ");
  return `${value} ${extra}`;
}

export function registerSearch(db: DatabaseSync): void {
  db.function("ef_search_text", { deterministic: true }, (value: SQLOutputValue) => splitSearchText(value));
}

let stateSql: string | undefined;
let globalSql: string | undefined;
let stateTemplate: Uint8Array | undefined;
let globalTemplate: Uint8Array | undefined;
let queryMap: Map<string, string> | undefined;

export function readSchema(name: "state.sql" | "global.sql" | "queries.sql"): string {
  return fs.readFileSync(path.join(repoRoot, "schema", name), "utf8");
}

export function stateSchemaSql(): string {
  stateSql ??= readSchema("state.sql");
  return stateSql;
}

export function globalSchemaSql(): string {
  globalSql ??= readSchema("global.sql");
  return globalSql;
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

function templateFor(sql: string, register: boolean): Uint8Array {
  const db = new DatabaseSync(":memory:");
  try {
    if (register) registerSearch(db);
    db.exec(sql);
    return db.serialize();
  } finally {
    db.close();
  }
}

export function emptyStateTemplate(): Uint8Array {
  stateTemplate ??= templateFor(stateSchemaSql(), true);
  return stateTemplate;
}

export function emptyGlobalTemplate(): Uint8Array {
  globalTemplate ??= templateFor(globalSchemaSql(), false);
  return globalTemplate;
}

export function applyMemoryPragmas(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA temp_store = MEMORY");
}

export function applyDiskPragmas(db: DatabaseSync): void {
  const journal = db.prepare("PRAGMA journal_mode = WAL").get();
  const mode = journal ? Object.values(journal)[0] : undefined;
  if (mode !== "wal") {
    throw new Error(`expected WAL journal, got ${String(mode)}`);
  }
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA secure_delete = ON");
  db.exec("PRAGMA journal_size_limit = 67108864");
  db.exec("PRAGMA temp_store = MEMORY");
}

export function openMemory(template: Uint8Array, register: boolean): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applyMemoryPragmas(db);
  if (register) registerSearch(db);
  db.deserialize(template);
  applyMemoryPragmas(db);
  if (register) registerSearch(db);
  return db;
}

export function openDisk(file: string, register: boolean, sql: string): DatabaseSync {
  const db = new DatabaseSync(file);
  applyDiskPragmas(db);
  if (register) registerSearch(db);
  db.exec(sql);
  applyDiskPragmas(db);
  if (register) registerSearch(db);
  return db;
}

export function reopenDisk(file: string, register: boolean): DatabaseSync {
  const db = new DatabaseSync(file);
  applyDiskPragmas(db);
  if (register) registerSearch(db);
  return db;
}

export type SqlRow = Record<string, SQLOutputValue>;

export function asNumber(value: SQLOutputValue | undefined, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`${label} was not a number`);
}

export function asString(value: SQLOutputValue | undefined, label: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  throw new Error(`${label} was not a string`);
}

export function runNamed(
  statement: StatementSync,
  params: Record<string, SQLInputValue>,
): number {
  return Number(statement.run(params).changes);
}

export function allNamed(statement: StatementSync, params: Record<string, SQLInputValue>): SqlRow[] {
  return statement.all(params) as SqlRow[];
}
