import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MigrationIssue, MigrationStatement } from "./types.js";

const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?([a-zA-Z0-9_]+)/i;
const CREATE_INDEX =
  /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?["'`]?([a-zA-Z0-9_]+)["'`]?\s+on\s+["'`]?([a-zA-Z0-9_]+)/i;
const DROP_COLUMN = /alter\s+table\s+["'`]?([a-zA-Z0-9_]+)["'`]?\s+drop\s+column\s+["'`]?([a-zA-Z0-9_]+)/i;
const ADD_COLUMN = /alter\s+table\s+["'`]?([a-zA-Z0-9_]+)["'`]?\s+add\s+column\s+["'`]?([a-zA-Z0-9_]+)/i;
const REFERENCES = /references\s+["'`]?([a-zA-Z0-9_]+)/i;
const SEQUENCE = /^(\d{3,4})_/;

export function listMigrationFiles(root: string): string[] {
  const dir = path.join(root, "migrations");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => path.posix.join("migrations", name));
}

export function readMigrationFiles(root: string): { file: string; sql: string }[] {
  return listMigrationFiles(root).map((file) => ({
    file,
    sql: readFileSync(path.join(root, file), "utf8"),
  }));
}

export function parseMigration(file: string, sql: string): MigrationStatement[] {
  const statements: MigrationStatement[] = [];
  for (const part of sql.split(";")) {
    const statement = part.trim();
    if (!statement) continue;
    const createTable = CREATE_TABLE.exec(statement);
    const createIndex = CREATE_INDEX.exec(statement);
    const dropColumn = DROP_COLUMN.exec(statement);
    const addColumn = ADD_COLUMN.exec(statement);
    const references = REFERENCES.exec(statement);
    if (createTable?.[1]) {
      statements.push(statementOf(file, "create_table", createTable[1], createTable[1], "", references?.[1] ?? "", statement));
    } else if (createIndex?.[1] && createIndex[2]) {
      statements.push(statementOf(file, "create_index", createIndex[1], createIndex[2], "", "", statement));
    } else if (dropColumn?.[1] && dropColumn[2]) {
      statements.push(statementOf(file, "drop_column", dropColumn[2], dropColumn[1], dropColumn[2], "", statement));
    } else if (addColumn?.[1] && addColumn[2]) {
      statements.push(statementOf(file, "add_column", addColumn[2], addColumn[1], addColumn[2], references?.[1] ?? "", statement));
    } else {
      statements.push(statementOf(file, "sql", file, "", "", references?.[1] ?? "", statement));
    }
  }
  return statements;
}

function statementOf(
  file: string,
  kind: string,
  name: string,
  table: string,
  column: string,
  references: string,
  sql: string,
): MigrationStatement {
  return { file, kind, name, table, column, references, sql };
}

export function lintMigrations(files: readonly { file: string; sql: string }[]): MigrationIssue[] {
  const issues: MigrationIssue[] = [];
  const parsed = files.map((file) => ({ file: file.file, statements: parseMigration(file.file, file.sql) }));
  const sequences = new Map<string, string[]>();
  for (const file of files) {
    const match = SEQUENCE.exec(path.posix.basename(file.file));
    if (!match?.[1]) continue;
    const group = sequences.get(match[1]) ?? [];
    group.push(file.file);
    sequences.set(match[1], group);
  }
  for (const [sequence, group] of sequences) {
    if (group.length > 1) {
      issues.push({
        code: "sequence_collision",
        detail: `sequential migration prefix ${sequence} is shared by ${group.join(", ")}`,
        files: group,
      });
    }
  }
  const seen = new Map<string, string>();
  for (const file of parsed) {
    for (const statement of file.statements) {
      if (statement.kind !== "create_table" && statement.kind !== "create_index") continue;
      const key = `${statement.kind}:${statement.name}`;
      const prior = seen.get(key);
      if (prior && prior !== statement.file) {
        issues.push({
          code: "duplicate_object",
          detail: `${statement.kind} ${statement.name} is created by ${prior} and ${statement.file}`,
          files: [prior, statement.file],
        });
      }
      seen.set(key, statement.file);
    }
  }
  for (const file of parsed) {
    for (const drop of file.statements) {
      if (drop.kind !== "drop_column") continue;
      const clash = parsed.find((other) =>
        other.statements.some(
          (statement) =>
            statement.file !== drop.file &&
            statement.table === drop.table &&
            (statement.kind === "create_index" || statement.column === drop.column),
        ),
      );
      if (clash) {
        issues.push({
          code: "column_clash",
          detail: `${drop.file} drops ${drop.table}.${drop.column} while ${clash.file} still uses it`,
          files: [drop.file, clash.file],
        });
      }
    }
  }
  const createdAt = new Map<string, number>();
  parsed.forEach((file, index) => {
    for (const statement of file.statements) {
      if (statement.kind === "create_table" && !createdAt.has(statement.table)) createdAt.set(statement.table, index);
    }
  });
  parsed.forEach((file, index) => {
    for (const statement of file.statements) {
      if (!statement.references) continue;
      const target = createdAt.get(statement.references);
      if (target === undefined || target > index) {
        issues.push({
          code: "fk_order",
          detail: `${file.file} references ${statement.references} before that table is created`,
          files: [file.file],
        });
      }
    }
  });
  return issues;
}

export function renderMigrationAst(files: readonly { file: string; sql: string }[]): string {
  const lines: string[] = [];
  for (const file of files) {
    for (const statement of parseMigration(file.file, file.sql)) {
      const target = statement.references ? ` REFERENCES ${statement.references}` : "";
      lines.push(`${file.file} ${statement.kind} ${statement.table || statement.name}${target}`);
    }
  }
  return lines.join("\n");
}

export function orderMigrations(files: readonly { file: string; sql: string }[]): { file: string; sql: string }[] {
  const remaining = [...files];
  const ordered: { file: string; sql: string }[] = [];
  const created = new Set<string>();
  while (remaining.length > 0) {
    const readyIndex = remaining.findIndex((file) =>
      parseMigration(file.file, file.sql).every((statement) => !statement.references || created.has(statement.references)),
    );
    const next = remaining.splice(readyIndex >= 0 ? readyIndex : 0, 1)[0];
    if (!next) break;
    ordered.push(next);
    for (const statement of parseMigration(next.file, next.sql)) {
      if (statement.kind === "create_table") created.add(statement.table);
    }
  }
  return ordered;
}

export function timestampName(index: number, sql: string, slug: string): string {
  const hash = createHash("sha256").update(sql).digest("hex").slice(0, 6);
  const stamp = String(20261120120000 + index);
  const safe = slug.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "migration";
  return `${stamp}_${hash}_${safe}.sql`;
}

export function applyMigrationsFromScratch(options: {
  readonly templatePath: string | null;
  readonly destPath: string;
  readonly files: readonly { file: string; sql: string }[];
}): { ok: boolean; trace: string } {
  if (options.templatePath && existsSync(options.templatePath)) {
    copyFileSync(options.templatePath, options.destPath);
  }
  const db = new DatabaseSync(options.destPath);
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    for (const file of options.files) {
      db.exec(file.sql);
    }
    return { ok: true, trace: `applied ${options.files.length} migrations on a fresh template database` };
  } catch (error) {
    return { ok: false, trace: error instanceof Error ? error.message : String(error) };
  } finally {
    db.close();
  }
}
