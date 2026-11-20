import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import { splitSearchText } from "./search-text.js";
import { PurgeLockUnavailableError } from "./types.js";

const queryCache = new Map<string, string>();

function repositoryRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

function schemaFile(name: string): string {
  return path.join(repositoryRoot(), "schema", name);
}

export function loadNamedQuery(name: string): string {
  const cached = queryCache.get(name);
  if (cached !== undefined) return cached;
  const text = fs.readFileSync(schemaFile("queries.sql"), "utf8");
  for (const block of text.split(/^-- name: /m).slice(1)) {
    const [heading, ...rest] = block.split("\n");
    const queryName = heading?.trim() ?? "";
    const sql = rest
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/, "");
    queryCache.set(queryName, sql);
  }
  const found = queryCache.get(name);
  if (!found) throw new Error(`canonical query ${name} is missing from schema/queries.sql`);
  return found;
}

export function loadSchemaAsset(name: "state.sql" | "telemetry.sql" | "global.sql"): string {
  return fs.readFileSync(schemaFile(name), "utf8");
}

export function sqlText(value: SQLOutputValue | undefined): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return "";
}

export function sqlInteger(value: SQLOutputValue | undefined, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`expected integer column ${label}`);
}

export function sqlNullableText(value: SQLOutputValue | undefined): string | null {
  if (value == null) return null;
  const text = sqlText(value);
  return text;
}

export function ensureSearchTextFunction(db: DatabaseSync): void {
  try {
    db.prepare("SELECT ef_search_text('') AS probe").get();
  } catch {
    db.function("ef_search_text", { deterministic: true }, (value: SQLOutputValue) => {
      return splitSearchText(value == null ? "" : sqlText(value));
    });
  }
}

export function applyPurgePragmas(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA secure_delete = ON");
  const journal = db.prepare("PRAGMA journal_mode = WAL").get();
  const mode = journal ? sqlText(journal["journal_mode"]).toLowerCase() : "";
  if (mode !== "wal" && mode !== "memory") {
    throw new Error(`secret purge requires WAL journal mode, found ${mode || "unknown"}`);
  }
  const secure = db.prepare("PRAGMA secure_delete").get();
  const flag = secure ? sqlInteger(secure["secure_delete"], "secure_delete") : 0;
  if (flag !== 1) {
    throw new Error("PRAGMA secure_delete = ON could not be verified");
  }
}

export function truncateWal(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  const busy = row ? Number(row["busy"] ?? 0) : 0;
  if (busy !== 0) {
    throw new PurgeLockUnavailableError(
      "wal_checkpoint(TRUNCATE) is busy because a reader still holds the WAL. Purge stopped instead of leaving secret bytes in the WAL.",
    );
  }
}

export function assertQuickCheckClean(db: DatabaseSync): void {
  const rows = db.prepare("PRAGMA quick_check").all();
  const first = rows[0];
  if (rows.length !== 1 || !first || sqlText(first["quick_check"]) !== "ok") {
    throw new Error("PRAGMA quick_check failed after secret purge");
  }
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length > 0) {
    throw new Error("PRAGMA foreign_key_check failed after secret purge");
  }
}

export function sqliteStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function vacuumInto(db: DatabaseSync, destination: string): void {
  const literal = sqliteStringLiteral(destination.replaceAll("\\", "/"));
  db.exec(`VACUUM INTO ${literal}`);
}
