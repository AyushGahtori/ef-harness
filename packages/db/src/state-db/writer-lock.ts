import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

export class ExclusiveWriterLock {
  private constructor(private connection: DatabaseSync | null) {}

  static tryAcquire(lockPath: string): ExclusiveWriterLock | "busy" {
    const opened = openLockConnection(lockPath);
    if (opened === "busy") return "busy";
    try {
      opened.exec("PRAGMA busy_timeout = 0");
      opened.exec("PRAGMA journal_mode = DELETE");
      opened.exec("BEGIN IMMEDIATE");
      return new ExclusiveWriterLock(opened);
    } catch (error) {
      closeQuietly(opened);
      if (isSqliteBusy(error)) return "busy";
      throw error;
    }
  }

  release(): void {
    const connection = this.connection;
    if (!connection) return;
    this.connection = null;
    try {
      connection.exec("ROLLBACK");
    } catch (error) {
      if (!isNoTransaction(error) && !isSqliteBusy(error)) {
        closeQuietly(connection);
        return;
      }
    }
    closeQuietly(connection);
  }
}

function openLockConnection(lockPath: string): DatabaseSync | "busy" {
  try {
    return new DatabaseSync(lockPath, { timeout: 0, readBigInts: false });
  } catch (error) {
    if (isSqliteBusy(error)) return "busy";
    if (!isNotDatabase(error)) throw error;
  }
  if (!removeLockFile(lockPath)) return "busy";
  try {
    return new DatabaseSync(lockPath, { timeout: 0, readBigInts: false });
  } catch (error) {
    if (isSqliteBusy(error) || isNotDatabase(error)) return "busy";
    throw error;
  }
}

function removeLockFile(lockPath: string): boolean {
  const paths = [lockPath, `${lockPath}-journal`, `${lockPath}-wal`, `${lockPath}-shm`];
  for (const filePath of paths) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch (error) {
      const code = errorCode(error);
      if (code === "EPERM" || code === "EBUSY" || code === "EACCES") return false;
      throw error;
    }
  }
  return true;
}

function closeQuietly(connection: DatabaseSync): void {
  try {
    connection.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not open|already closed/i.test(message)) return;
  }
}

export function isSqliteBusy(error: unknown): boolean {
  const code = sqliteErrorCode(error);
  if (code === 5 || code === 6) return true;
  return /database is locked|database is busy/i.test(errorMessage(error));
}

export function isNotDatabase(error: unknown): boolean {
  if (sqliteErrorCode(error) === 26) return true;
  return /file is not a database|not a database/i.test(errorMessage(error));
}

export function isNoTransaction(error: unknown): boolean {
  return /no transaction is active/i.test(errorMessage(error));
}

export function sqliteErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("errcode" in error)) return undefined;
  const value = error.errcode;
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return value & 0xff;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}
