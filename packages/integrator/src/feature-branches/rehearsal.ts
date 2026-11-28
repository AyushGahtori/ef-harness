import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseDdl } from "./ddl.js";
import { LockfileIntegrityError } from "./errors.js";
import type { DdlStatement, MigrationFile } from "./types.js";

export interface RehearsalReport {
  readonly ok: boolean;
  readonly applied: readonly string[];
  readonly withheld: readonly string[];
  readonly error: string | null;
  readonly clonePath: string;
}

/**
 * Local port of Task 052 `TemplateDatabaseManager.cloneFromTemplate`: copy the template file,
 * then apply additive migrations in timestamp+hash / depends_on order.
 */
export class MigrationRehearsalChecker {
  rehearse(input: {
    readonly templatePath: string;
    readonly migrations: readonly MigrationFile[];
    readonly destPath: string;
  }): RehearsalReport {
    fs.copyFileSync(input.templatePath, input.destPath);
    const db = new DatabaseSync(input.destPath);
    const applied: string[] = [];
    const withheld: string[] = [];
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      const baseline = readTables(db);
      const known = new Set(baseline);
      for (const migration of input.migrations) {
        const statements = parseDdl(migration.sql);
        const additive = statements.filter((statement) => !statement.destructive && statement.kind !== "other");
        const skipped = statements.filter((statement) => statement.destructive);
        if (skipped.length > 0) withheld.push(migration.id);
        for (const statement of additive) {
          if (statement.targetTable && !known.has(statement.targetTable)) {
            return {
              ok: false,
              applied,
              withheld,
              error: `${migration.path} references missing table ${statement.targetTable}`,
              clonePath: input.destPath,
            };
          }
          try {
            db.exec(sqliteStatement(statement));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              ok: false,
              applied,
              withheld,
              error: `${migration.path}: ${message}`,
              clonePath: input.destPath,
            };
          }
          if (statement.kind === "create_table" && statement.name) known.add(statement.name);
          if (statement.kind === "create_enum" && statement.name) known.add(statement.name);
        }
        if (additive.length > 0) applied.push(migration.id);
      }
      return { ok: true, applied, withheld, error: null, clonePath: input.destPath };
    } finally {
      db.close();
    }
  }
}

export function createTemplateDatabase(filePath: string, sql: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

function readTables(db: DatabaseSync): string[] {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all();
  const names: string[] = [];
  for (const row of rows) {
    if (row && typeof row === "object" && "name" in row && typeof row.name === "string") names.push(row.name);
  }
  return names;
}

function sqliteStatement(statement: DdlStatement): string {
  if (statement.kind === "add_foreign_key" && statement.table && statement.columns.length > 0 && safeIdent(statement.table)) {
    const index = statement.name && safeIdent(statement.name) ? statement.name : `${statement.table}_${statement.columns.join("_")}_fk`;
    if (statement.columns.every((column) => safeIdent(column)) && safeIdent(index)) {
      return `CREATE INDEX IF NOT EXISTS "${index}" ON "${statement.table}" (${statement.columns.map((column) => `"${column}"`).join(", ")});`;
    }
  }
  if (statement.kind !== "create_enum") return statement.raw;
  const match = /^create\s+type\s+(\S+)\s+as\s+enum\s*\(([^)]*)\)/i.exec(statement.raw.replace(/\s+/g, " ").trim());
  if (!match?.[1]) return statement.raw;
  const values = (match[2] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const inserts = values.map((value) => `INSERT INTO ${match[1]} (value) VALUES (${value});`).join("\n");
  return `CREATE TABLE ${match[1]} (value TEXT PRIMARY KEY);\n${inserts}`;
}

function safeIdent(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

export function assertLockfileHasNoRemoteTarball(lockfile: string): void {
  for (const line of lockfile.split(/\r?\n/)) {
    const resolved = /^\s*(?:resolved|tarball):\s*(\S+)/.exec(line);
    const url = resolved?.[1];
    if (!url || !/^https?:\/\//.test(url)) continue;
    if (url.startsWith("https://registry.npmjs.org/")) continue;
    throw new LockfileIntegrityError(`lockfile points at a non-registry tarball ${url}`);
  }
}
