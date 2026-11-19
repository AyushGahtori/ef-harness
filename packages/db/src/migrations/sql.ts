import type { SqlRow, SqliteConnection } from "./types.js";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function quoteIdent(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

export function sqlStringLiteral(value: string): string {
  if (value.includes("\u0000")) {
    throw new Error("SQL string literal cannot contain NUL");
  }
  return `'${value.replaceAll("'", "''")}'`;
}

export function sqlitePath(filePath: string): string {
  return sqlStringLiteral(filePath.replaceAll("\\", "/"));
}

export function tableExists(conn: SqliteConnection, name: string): boolean {
  const row = conn
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?")
    .get(name);
  return row !== undefined;
}

export function readUserVersion(conn: SqliteConnection): number {
  return readPragmaNumber(conn, "user_version");
}

export function setUserVersion(conn: SqliteConnection, version: number): void {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error(`Refusing to set PRAGMA user_version to ${version}`);
  }
  conn.exec(`PRAGMA user_version = ${version}`);
}

export function readPragmaNumber(conn: SqliteConnection, pragma: string): number {
  if (!IDENTIFIER.test(pragma)) {
    throw new Error(`Unsafe PRAGMA name: ${pragma}`);
  }
  const row = conn.prepare(`PRAGMA ${pragma}`).get();
  const value = row?.[pragma];
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 0;
}

export function firstColumn(row: SqlRow): string {
  const key = Object.keys(row)[0];
  if (key === undefined) return "";
  const value = row[key];
  if (value === undefined || value === null) return "";
  return String(value);
}

export function rollbackIfOpen(conn: SqliteConnection): void {
  try {
    conn.exec("ROLLBACK");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no transaction is active/i.test(message)) return;
    throw error;
  }
}

export function isSqliteLocked(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /database is locked|database schema is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message);
}

export function isDiskFullError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "errcode" in error && Number(error.errcode) === 13) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /disk is full|database or disk is full|SQLITE_FULL|ENOSPC|no space left/i.test(message);
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
