import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BackupVerificationError, InsufficientDiskSpaceError } from "./errors.js";
import { createNodeSqliteConnectionFactory } from "./connection.js";
import { errorText, isDiskFullError, readPragmaNumber, sqlitePath } from "./sql.js";
import type { DiskSpaceProbe, SqliteConnection, TargetDb } from "./types.js";

const RETRYABLE_RENAME = new Set(["EPERM", "EBUSY", "EACCES"]);

export function fileFingerprint(dbPath: string): string {
  const parts = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`];
  return parts
    .map((file) => {
      if (!fs.existsSync(file)) return "-";
      const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      return `${fs.statSync(file).size}:${hash}`;
    })
    .join("|");
}

export function bytesNeededForVacuum(pageCount: number, freelistCount: number, pageSize: number): number {
  const pages = Math.max(1, pageCount - Math.max(0, freelistCount));
  const size = pageSize > 0 ? pageSize : 4096;
  return pages * size;
}

export function vacuumBytesNeeded(conn: SqliteConnection): number {
  return bytesNeededForVacuum(
    readPragmaNumber(conn, "page_count"),
    readPragmaNumber(conn, "freelist_count"),
    readPragmaNumber(conn, "page_size"),
  );
}

export function statfsAvailableBytes(directory: string): number {
  const stats = fs.statfsSync(directory);
  return Number(stats.bavail) * Number(stats.bsize);
}

export const statfsDiskSpace: DiskSpaceProbe = {
  availableBytes: statfsAvailableBytes,
};

export function assertDiskSpace(input: {
  readonly dbPath: string;
  readonly directory: string;
  readonly bytesNeeded: number;
  readonly diskSpace: DiskSpaceProbe;
}): void {
  const bytesAvailable = input.diskSpace.availableBytes(input.directory);
  if (!Number.isFinite(bytesAvailable) || bytesAvailable < input.bytesNeeded) {
    throw new InsufficientDiskSpaceError({
      dbPath: input.dbPath,
      bytesNeeded: input.bytesNeeded,
      bytesAvailable: Number.isFinite(bytesAvailable) ? bytesAvailable : 0,
    });
  }
}

export function diskProbeDirectory(backupsDir: string, dbPath: string): string {
  let current = backupsDir;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return path.dirname(dbPath);
    current = parent;
  }
  return current;
}

export function preMigrationBackupName(oldVersion: number, newVersion: number, timestamp: number): string {
  return `pre-migration-v${oldVersion}-to-v${newVersion}-${timestamp}.db`;
}

export function listPreMigrationBackups(backupsDir: string): string[] {
  if (!fs.existsSync(backupsDir)) return [];
  const names = fs.readdirSync(backupsDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of names) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith("pre-migration-") || !entry.name.endsWith(".db")) continue;
    files.push(path.join(backupsDir, entry.name));
  }
  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "";
}

export async function renameWithRetry(
  from: string,
  to: string,
  deps?: {
    readonly rename?: (from: string, to: string) => void;
    readonly sleep?: (ms: number) => Promise<void>;
  },
): Promise<void> {
  const rename = deps?.rename ?? ((source: string, dest: string) => fs.renameSync(source, dest));
  const sleep = deps?.sleep ?? delay;
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const retry = RETRYABLE_RENAME.has(errorCode(error));
      if (!retry || attempt === maxAttempts) throw error;
      const wait = Math.min(1000, 50 * 2 ** (attempt - 1));
      await sleep(wait);
    }
  }
}

async function removeWithRetry(file: string): Promise<void> {
  if (!fs.existsSync(file)) return;
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      fs.rmSync(file, { force: true });
      return;
    } catch (error) {
      const retry = RETRYABLE_RENAME.has(errorCode(error));
      if (!retry || attempt === maxAttempts) throw error;
      await delay(Math.min(1000, 50 * 2 ** (attempt - 1)));
    }
  }
}

export async function removeSidecars(dbPath: string): Promise<void> {
  await removeWithRetry(`${dbPath}-wal`);
  await removeWithRetry(`${dbPath}-shm`);
  await removeWithRetry(`${dbPath}-journal`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function assertDatabaseFileHealthy(dbPath: string, targetDb: TargetDb = "state"): void {
  const factory = createNodeSqliteConnectionFactory();
  const conn = factory.open(dbPath, { readOnly: true, targetDb });
  try {
    const rows = conn.prepare("PRAGMA quick_check").all();
    const failures: string[] = [];
    for (const row of rows) {
      const value = row.quick_check;
      const text = value === undefined || value === null ? "" : String(value);
      if (text !== "ok") failures.push(text);
    }
    if (rows.length === 0 || failures.length > 0) {
      throw new BackupVerificationError(dbPath, failures.join("; ") || "quick_check returned no rows");
    }
  } finally {
    conn.close();
  }
}

/**
 * Consistent snapshot. The live database is not mutated; caller must already
 * hold the exclusive writer lock and must not run this inside a transaction.
 */
export function vacuumInto(
  conn: SqliteConnection,
  destination: string,
  targetDb: TargetDb,
  bytesNeeded = 0,
): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    conn.exec(`VACUUM INTO ${sqlitePath(destination)}`);
    if (!fs.existsSync(destination) || fs.statSync(destination).size <= 0) {
      throw new BackupVerificationError(destination, "VACUUM INTO did not create a non-empty file");
    }
    assertDatabaseFileHealthy(destination, targetDb);
  } catch (error) {
    fs.rmSync(destination, { force: true });
    if (error instanceof BackupVerificationError) throw error;
    if (isDiskFullError(error)) {
      throw new InsufficientDiskSpaceError({
        dbPath: destination,
        bytesNeeded,
        bytesAvailable: 0,
      });
    }
    throw new BackupVerificationError(destination, errorText(error), { cause: error });
  }
}

/**
 * Replace `livePath` with an exact byte copy of the VACUUM INTO backup.
 * Sidecars are removed before the restored file is promoted so SQLite cannot
 * replay a stale WAL over the healthy snapshot.
 */
export async function restoreVacuumBackup(livePath: string, backupPath: string): Promise<void> {
  if (!fs.existsSync(backupPath)) {
    throw new BackupVerificationError(backupPath, "backup file is missing");
  }
  const tempPath = `${livePath}.restore.tmp`;
  const displaced = `${livePath}.displaced`;
  fs.rmSync(tempPath, { force: true });
  fs.copyFileSync(backupPath, tempPath);
  await removeSidecars(livePath);
  if (fs.existsSync(displaced)) fs.rmSync(displaced, { force: true });
  await renameWithRetry(livePath, displaced);
  try {
    await renameWithRetry(tempPath, livePath);
  } catch (error) {
    try {
      await renameWithRetry(displaced, livePath);
    } catch (restoreError) {
      throw new BackupVerificationError(livePath, `restore swap failed: ${errorText(error)}; rollback also failed: ${errorText(restoreError)}`, {
        cause: error,
      });
    }
    throw error;
  }
  fs.rmSync(displaced, { force: true });
  await removeSidecars(livePath);
  const live = fs.readFileSync(livePath);
  const backup = fs.readFileSync(backupPath);
  if (!live.equals(backup)) {
    throw new BackupVerificationError(livePath, "restored file is not a bit-for-bit copy of the VACUUM INTO backup");
  }
}

function sleepSync(ms: number): void {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, ms);
}

function renameSyncWithRetry(from: string, to: string): void {
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      const retry = RETRYABLE_RENAME.has(errorCode(error));
      if (!retry || attempt === maxAttempts) throw error;
      sleepSync(Math.min(1000, 50 * 2 ** (attempt - 1)));
    }
  }
}

function removeSyncWithRetry(file: string): void {
  if (!fs.existsSync(file)) return;
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      fs.rmSync(file, { force: true });
      return;
    } catch (error) {
      const retry = RETRYABLE_RENAME.has(errorCode(error));
      if (!retry || attempt === maxAttempts) throw error;
      sleepSync(Math.min(1000, 50 * 2 ** (attempt - 1)));
    }
  }
}

function removeSidecarsSync(dbPath: string): void {
  removeSyncWithRetry(`${dbPath}-wal`);
  removeSyncWithRetry(`${dbPath}-shm`);
  removeSyncWithRetry(`${dbPath}-journal`);
}

/** Synchronous restore for open() paths that cannot await the async rename retry. */
export function restoreVacuumBackupSync(livePath: string, backupPath: string): void {
  if (!fs.existsSync(backupPath)) {
    throw new BackupVerificationError(backupPath, "backup file is missing");
  }
  const tempPath = `${livePath}.restore.tmp`;
  const displaced = `${livePath}.displaced`;
  fs.rmSync(tempPath, { force: true });
  fs.copyFileSync(backupPath, tempPath);
  removeSidecarsSync(livePath);
  if (fs.existsSync(displaced)) fs.rmSync(displaced, { force: true });
  renameSyncWithRetry(livePath, displaced);
  try {
    renameSyncWithRetry(tempPath, livePath);
  } catch (error) {
    try {
      renameSyncWithRetry(displaced, livePath);
    } catch (restoreError) {
      throw new BackupVerificationError(
        livePath,
        `restore swap failed: ${errorText(error)}; rollback also failed: ${errorText(restoreError)}`,
        { cause: error },
      );
    }
    throw error;
  }
  fs.rmSync(displaced, { force: true });
  removeSidecarsSync(livePath);
  const live = fs.readFileSync(livePath);
  const backup = fs.readFileSync(backupPath);
  if (!live.equals(backup)) {
    throw new BackupVerificationError(livePath, "restored file is not a bit-for-bit copy of the VACUUM INTO backup");
  }
}
