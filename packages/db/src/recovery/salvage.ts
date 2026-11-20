import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";
import { evaluateSchemaInvariants } from "./invariants.js";
import {
  asInteger,
  asText,
  closeQuietly,
  createDatabaseFromSchema,
  errorMessage,
  quoteIdent,
  readSchema,
  registerSearchText,
  sqlStringLiteral,
  openDatabase,
} from "./sqlite-io.js";
import type { InvariantFailure } from "./types.js";

export interface SalvageResult {
  readonly accepted: boolean;
  readonly outputPath: string | null;
  readonly failures: readonly InvariantFailure[];
  readonly method: "recovery_dump" | "table_copy" | "unavailable";
  readonly detail: string;
}

interface ColumnInfo {
  readonly name: string;
  readonly hidden: number;
}

function columnsOf(db: DatabaseSync, table: string): ColumnInfo[] {
  return db
    .prepare(`PRAGMA table_xinfo(${sqlStringLiteral(table)})`)
    .all()
    .map((row) => ({
      name: asText(row.name) ?? "",
      hidden: asInteger(row.hidden) ?? 0,
    }))
    .filter((column) => column.name !== "" && column.hidden === 0);
}

function tableSql(db: DatabaseSync): Map<string, string | null> {
  const tables = new Map<string, string | null>();
  for (const row of db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all()) {
    const name = asText(row.name);
    if (!name) continue;
    tables.set(name, asText(row.sql));
  }
  return tables;
}

function isCopyable(name: string, sql: string | null): boolean {
  if (name.startsWith("sqlite_") && name !== "sqlite_sequence") return false;
  if (name === "kb_words" || name === "kb_ident") return false;
  if (name.startsWith("kb_words_") || name.startsWith("kb_ident_")) return false;
  if (sql && /^\s*CREATE\s+VIRTUAL\s+/i.test(sql)) return false;
  return true;
}

function cell(value: SQLOutputValue | undefined): SQLInputValue {
  return value ?? null;
}

function copyTables(source: DatabaseSync, dest: DatabaseSync): string[] {
  const problems: string[] = [];
  const sourceTables = tableSql(source);
  const destTables = tableSql(dest);
  const triggers = dest
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL")
    .all()
    .map((row) => ({ name: asText(row.name) ?? "", sql: asText(row.sql) ?? "" }))
    .filter((trigger) => trigger.name !== "" && trigger.sql !== "");

  dest.exec("PRAGMA foreign_keys = OFF");
  for (const trigger of triggers) {
    dest.exec(`DROP TRIGGER IF EXISTS ${quoteIdent(trigger.name)}`);
  }
  for (const [name, sql] of destTables) {
    if (!isCopyable(name, sql)) continue;
    dest.exec(`DELETE FROM ${quoteIdent(name)}`);
  }

  for (const [name, sql] of destTables) {
    if (!isCopyable(name, sql)) continue;
    if (!sourceTables.has(name)) continue;
    const shared = columnsOf(dest, name).filter((column) =>
      columnsOf(source, name).some((sourceColumn) => sourceColumn.name === column.name),
    );
    if (shared.length === 0) {
      problems.push(`${name}: no shared columns`);
      continue;
    }
    const selected = shared.map((column) => quoteIdent(column.name)).join(", ");
    let rows: Record<string, SQLOutputValue>[];
    try {
      rows = source.prepare(`SELECT ${selected} FROM ${quoteIdent(name)}`).all();
    } catch (error) {
      problems.push(`${name}: ${errorMessage(error)}`);
      continue;
    }
    const placeholders = shared.map(() => "?").join(", ");
    const insert = dest.prepare(
      `INSERT INTO ${quoteIdent(name)} (${selected}) VALUES (${placeholders})`,
    );
    dest.exec("SAVEPOINT table_copy");
    try {
      for (const row of rows) {
        insert.run(...shared.map((column) => cell(row[column.name])));
      }
      dest.exec("RELEASE table_copy");
    } catch (error) {
      dest.exec("ROLLBACK TO table_copy");
      dest.exec("RELEASE table_copy");
      problems.push(`${name}: ${errorMessage(error)}`);
    }
  }

  for (const trigger of triggers) {
    dest.exec(trigger.sql);
  }
  registerSearchText(dest);
  try {
    if (destTables.has("nodes") && destTables.has("kb_words")) {
      dest.exec("DELETE FROM kb_words");
      dest.exec(
        `INSERT INTO kb_words(rowid, title, body)
         SELECT nid, ef_search_text(title), ef_search_text(text || ' ' || fields) FROM nodes`,
      );
    }
    if (destTables.has("nodes") && destTables.has("kb_ident")) {
      dest.exec(
        `INSERT INTO kb_ident(rowid, id, title)
         SELECT nid, id, title FROM nodes`,
      );
    }
  } catch (error) {
    problems.push(`fts_rebuild: ${errorMessage(error)}`);
  }
  dest.exec("PRAGMA foreign_keys = ON");
  return problems;
}

function rebuildFromReadable(sourcePath: string, outputPath: string): SalvageResult {
  let source: DatabaseSync | null = null;
  let dest: DatabaseSync | null = null;
  try {
    source = openDatabase(sourcePath, true);
  } catch (error) {
    return {
      accepted: false,
      outputPath: null,
      method: "table_copy",
      failures: [{ name: "readable_content", detail: errorMessage(error) }],
      detail: "The database could not be opened for salvage",
    };
  }
  try {
    fs.rmSync(outputPath, { force: true });
    dest = createDatabaseFromSchema(outputPath, readSchema("state.sql"));
    const problems = copyTables(source, dest);
    const invariants = evaluateSchemaInvariants(dest);
    const failures = [
      ...problems.map((detail) => ({ name: "table_copy", detail })),
      ...invariants.failures,
    ];
    if (failures.length > 0) {
      return {
        accepted: false,
        outputPath: null,
        method: "table_copy",
        failures,
        detail: "Salvage failed the schema invariant gate",
      };
    }
    return {
      accepted: true,
      outputPath,
      method: "table_copy",
      failures: [],
      detail: "Table-by-table salvage passed every schema invariant",
    };
  } catch (error) {
    return {
      accepted: false,
      outputPath: null,
      method: "table_copy",
      failures: [{ name: "table_copy", detail: errorMessage(error) }],
      detail: "Table-by-table salvage aborted",
    };
  } finally {
    closeQuietly(source);
    closeQuietly(dest);
  }
}

let resolvedSqliteCli: string | null | undefined;

/**
 * sqlite3 is optional. A missing PATH entry must not be spawned: on Windows the
 * store alias can sit until the spawn timeout and fail the recovery tests at 5s.
 * Only a real, non-empty executable is used, and the lookup never executes it.
 */
function resolveSqliteCli(): string | null {
  if (resolvedSqliteCli !== undefined) return resolvedSqliteCli;
  const names = process.platform === "win32" ? ["sqlite3.exe", "sqlite3"] : ["sqlite3"];
  const dirs = (process.env.PATH ?? "").split(path.delimiter);
  for (const dir of dirs) {
    if (!dir || dir.toLowerCase().includes("windowsapps")) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        const stat = fs.lstatSync(candidate);
        if (!stat.isFile() || stat.size <= 0) continue;
        resolvedSqliteCli = candidate;
        return candidate;
      } catch {
        continue;
      }
    }
  }
  resolvedSqliteCli = null;
  return null;
}

function tryCliRecover(sourcePath: string, loosePath: string): boolean {
  const cli = resolveSqliteCli();
  if (!cli) return false;
  fs.rmSync(loosePath, { force: true });
  const result = spawnSync(cli, [sourcePath, ".recover"], {
    windowsHide: true,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || !result.stdout.trim()) return false;
  let db: DatabaseSync | null = null;
  try {
    db = openDatabase(loosePath, false);
    db.exec(result.stdout);
    return true;
  } catch {
    return false;
  } finally {
    closeQuietly(db);
  }
}

/**
 * Copy readable content into a new state.db.
 * Uses the sqlite3 CLI recovery dump when it is installed, then the
 * deterministic table-by-table fallback. The result is kept only when every
 * schema invariant passes.
 */
export function salvageCorruptDatabase(sourcePath: string, outputPath: string): SalvageResult {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ef-salvage-"));
  try {
    if (!fs.existsSync(sourcePath)) {
      return {
        accepted: false,
        outputPath: null,
        method: "unavailable",
        failures: [{ name: "readable_content", detail: "state.db is missing" }],
        detail: "Nothing to salvage",
      };
    }
    const isolated = path.join(scratch, "main.db");
    fs.copyFileSync(sourcePath, isolated);
    const loose = path.join(scratch, "loose.db");
    if (tryCliRecover(isolated, loose)) {
      const dumped = rebuildFromReadable(loose, outputPath);
      if (dumped.accepted) {
        return { ...dumped, method: "recovery_dump" };
      }
      fs.rmSync(outputPath, { force: true });
    }
    const copied = rebuildFromReadable(isolated, outputPath);
    if (!copied.accepted) fs.rmSync(outputPath, { force: true });
    return copied;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
