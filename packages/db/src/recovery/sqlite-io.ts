import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { splitSearchText as canonicalSplitSearchText } from "@ef-harness/shared-contracts";
import type { SqliteCorruptCode } from "./types.js";
import { RecoveryError } from "./types.js";

export type SchemaName =
  | "state.sql"
  | "global.sql"
  | "telemetry.sql"
  | "code-index.sql"
  | "queries.sql";

const schemaCache = new Map<string, string>();

export function repoRootFrom(moduleUrl: string = import.meta.url): string {
  const starts = [path.dirname(fileURLToPath(moduleUrl)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (let depth = 0; depth < 10; depth += 1) {
      if (
        fs.existsSync(path.join(dir, "schema", "state.sql")) &&
        fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))
      ) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new RecoveryError(
    "schema_missing",
    "Unable to locate schema/state.sql from the recovery module",
  );
}

export function readSchema(name: SchemaName, moduleUrl: string = import.meta.url): string {
  const full = path.join(repoRootFrom(moduleUrl), "schema", name);
  const cached = schemaCache.get(full);
  if (cached !== undefined) return cached;
  const text = fs.readFileSync(full, "utf8");
  schemaCache.set(full, text);
  return text;
}

export function loadNamedQueries(sql: string): Map<string, string> {
  const queries = new Map<string, string>();
  for (const block of sql.split(/^-- name: /m).slice(1)) {
    const newline = block.indexOf("\n");
    const name = (newline === -1 ? block : block.slice(0, newline)).trim();
    const body = (newline === -1 ? "" : block.slice(newline + 1))
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/, "");
    if (name) queries.set(name, body);
  }
  return queries;
}

let namedQueries: Map<string, string> | null = null;

export function namedQuery(name: string): string {
  if (!namedQueries) namedQueries = loadNamedQueries(readSchema("queries.sql"));
  const sql = namedQueries.get(name);
  if (!sql) {
    throw new RecoveryError("query_missing", `Schema query ${name} is not in schema/queries.sql`);
  }
  return sql;
}

export function openDatabase(filePath: string, readOnly: boolean): DatabaseSync {
  return new DatabaseSync(filePath, {
    readOnly,
    timeout: 5_000,
    enableForeignKeyConstraints: true,
  });
}

export function splitSearchText(value: SQLOutputValue): string {
  return canonicalSplitSearchText(value);
}

export function registerSearchText(db: DatabaseSync): void {
  db.function("ef_search_text", { deterministic: true }, splitSearchText);
}

export function createDatabaseFromSchema(filePath: string, schemaSql: string): DatabaseSync {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.rmSync(filePath, { force: true });
  fs.rmSync(`${filePath}-wal`, { force: true });
  fs.rmSync(`${filePath}-shm`, { force: true });
  const db = openDatabase(filePath, false);
  registerSearchText(db);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(schemaSql);
  return db;
}

export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function asText(value: SQLOutputValue | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

export function asInteger(value: SQLOutputValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function readMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return asText(row?.value);
}

export function writeMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO meta(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function readLastRev(db: DatabaseSync): number | null {
  const raw = readMeta(db, "last_rev");
  if (raw == null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface PragmaCheck {
  readonly ok: boolean;
  readonly messages: readonly string[];
}

export function runPragmaCheck(
  db: DatabaseSync,
  pragma: "quick_check" | "integrity_check",
): PragmaCheck {
  const rows = db.prepare(`PRAGMA ${pragma}`).all();
  const messages = rows.map((row) => {
    const value = Object.values(row)[0];
    return value == null ? "" : String(value);
  });
  return { ok: messages.length === 1 && messages[0] === "ok", messages };
}

export function foreignKeyViolations(db: DatabaseSync): readonly string[] {
  const rows = db.prepare("PRAGMA foreign_key_check").all();
  return rows.map((row) => {
    const table = asText(row.table) ?? "?";
    const parent = asText(row.parent) ?? "?";
    const rowid = asText(row.rowid) ?? "?";
    return `${table} row ${rowid} -> ${parent}`;
  });
}

export function classifySqliteError(error: unknown): SqliteCorruptCode | null {
  if (typeof error !== "object" || error === null) return null;
  const err = error as { errcode?: unknown; message?: unknown };
  const message = typeof err.message === "string" ? err.message : "";
  const code = typeof err.errcode === "number" ? err.errcode & 0xff : null;
  if (
    code === 11 ||
    message.includes("SQLITE_CORRUPT") ||
    message.includes("database disk image is malformed")
  ) {
    return "SQLITE_CORRUPT";
  }
  if (
    code === 26 ||
    message.includes("SQLITE_NOTADB") ||
    message.includes("file is not a database")
  ) {
    return "SQLITE_NOTADB";
  }
  return null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function listArtifactHashes(db: DatabaseSync): string[] {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => asText(row.name))
    .filter((name): name is string => name !== null);
  if (!tables.includes("artifacts")) return [];
  return db
    .prepare(
      "SELECT DISTINCT hash AS hash FROM artifacts WHERE hash IS NOT NULL AND length(hash) > 0 ORDER BY hash",
    )
    .all()
    .map((row) => asText(row.hash))
    .filter((hash): hash is string => hash !== null);
}

interface TableColumn {
  readonly name: string;
  readonly pk: number;
  readonly hidden: number;
}

function tableColumns(db: DatabaseSync, table: string): TableColumn[] {
  return db
    .prepare(`PRAGMA table_xinfo(${sqlStringLiteral(table)})`)
    .all()
    .map((row) => ({
      name: asText(row.name) ?? "",
      pk: asInteger(row.pk) ?? 0,
      hidden: asInteger(row.hidden) ?? 0,
    }))
    .filter((column) => column.name !== "");
}

function cellToken(value: SQLOutputValue): string {
  if (value == null) return "n:";
  if (typeof value === "bigint") return `b:${value.toString()}`;
  if (typeof value === "number") return `d:${String(value)}`;
  if (typeof value === "string") return `s:${value}`;
  return `u:${Buffer.from(value).toString("hex")}`;
}

const RUNTIME_TABLES = [
  "task_runtime",
  "feature_runtime",
  "project_runtime",
  "attempts",
  "attempt_checkpoints",
  "reservations",
  "reservation_scopes",
  "operations",
  "effects",
  "task_holds",
  "path_leases",
  "path_lease_prefixes",
  "turn_log",
  "env_processes",
  "ref_leases",
  "outbox",
  "inbox_items",
] as const;

function existingTables(db: DatabaseSync): Set<string> {
  return new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => asText(row.name))
      .filter((name): name is string => name !== null),
  );
}

function runtimeTableNames(db: DatabaseSync): string[] {
  const existing = existingTables(db);
  const names = new Set<string>(RUNTIME_TABLES);
  for (const name of existing) {
    if (name.endsWith("runtime")) names.add(name);
  }
  return [...names].filter((name) => existing.has(name)).sort();
}

/** Fingerprint of last_rev plus runtime tables. Knowledge history is represented by last_rev. */
export function activityFingerprint(db: DatabaseSync): string {
  const hash = createHash("sha256");
  hash.update("last_rev=");
  hash.update(readMeta(db, "last_rev") ?? "");
  hash.update("\n");
  for (const table of runtimeTableNames(db)) {
    const columns = tableColumns(db, table).filter((column) => column.hidden === 0);
    const order = columns
      .filter((column) => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((column) => quoteIdent(column.name));
    const selected = columns.map((column) => quoteIdent(column.name)).join(", ");
    const sql = `SELECT ${selected} FROM ${quoteIdent(table)}${order.length > 0 ? ` ORDER BY ${order.join(", ")}` : ""}`;
    const rows = db.prepare(sql).all();
    hash.update(table);
    hash.update("\n");
    for (const row of rows) {
      for (const column of columns) {
        hash.update(column.name);
        hash.update("=");
        hash.update(cellToken(row[column.name] ?? null));
        hash.update(";");
      }
      hash.update("\n");
    }
  }
  return hash.digest("hex");
}

export function projectHasWork(db: DatabaseSync): boolean {
  const lastRev = readMeta(db, "last_rev");
  if (lastRev !== null && lastRev !== "" && lastRev !== "0") return true;
  for (const table of runtimeTableNames(db)) {
    const row = db.prepare(`SELECT count(*) AS n FROM ${quoteIdent(table)}`).get();
    if ((asInteger(row?.n) ?? 0) > 0) return true;
  }
  return false;
}

export function closeQuietly(db: DatabaseSync | null): void {
  if (!db?.isOpen) return;
  db.close();
}
