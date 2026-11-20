import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileFingerprint, vacuumInto } from "./backup.js";
import { createNodeSqliteConnectionFactory } from "./connection.js";
import { MigrationFailedError } from "./errors.js";
import { migrateDatabase } from "./runner.js";
import { readUserVersion } from "./sql.js";
import type {
  AppliedMigration,
  Clock,
  DiskSpaceProbe,
  MigrationDefinition,
  RehearsalReport,
  SqliteConnectionFactory,
  TargetDb,
  WorkerReaderPool,
} from "./types.js";

export interface RehearseMigrationOptions {
  readonly targetDb: TargetDb;
  readonly appVersion: string;
  readonly readers: WorkerReaderPool;
  readonly baselineSchemaVersion?: number;
  readonly readerDrainTimeoutMs?: number;
  readonly clock?: Clock;
  readonly diskSpace?: DiskSpaceProbe;
  readonly connectionFactory?: SqliteConnectionFactory;
}

/**
 * VACUUM INTO a temporary clone and migrate that clone.
 * The production database file, its WAL, and its rollback journal are not modified.
 */
export async function rehearseMigration(
  dbPath: string,
  migrations: readonly MigrationDefinition[],
  options: RehearseMigrationOptions,
): Promise<RehearsalReport> {
  const before = fileFingerprint(dbPath);
  const factory = options.connectionFactory ?? createNodeSqliteConnectionFactory();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ef-rehearse-"));
  const clonePath = path.join(tempRoot, "clone.db");
  const source = factory.open(dbPath, { readOnly: false, targetDb: options.targetDb });
  try {
    vacuumInto(source, clonePath, options.targetDb);
  } finally {
    source.close();
  }
  assertSourceUntouched(dbPath, before);

  let fromVersion = 0;
  const peek = factory.open(clonePath, { readOnly: true, targetDb: options.targetDb });
  try {
    fromVersion = readUserVersion(peek);
  } finally {
    peek.close();
  }

  try {
    const outcome = await migrateDatabase({
      dbPath: clonePath,
      targetDb: options.targetDb,
      migrations,
      appVersion: options.appVersion,
      readers: options.readers,
      rehearsal: true,
      backupsDir: path.join(tempRoot, "backups"),
      connectionFactory: factory,
      ...(options.baselineSchemaVersion !== undefined
        ? { baselineSchemaVersion: options.baselineSchemaVersion }
        : {}),
      ...(options.readerDrainTimeoutMs !== undefined
        ? { readerDrainTimeoutMs: options.readerDrainTimeoutMs }
        : {}),
      ...(options.clock !== undefined ? { clock: options.clock } : {}),
      ...(options.diskSpace !== undefined ? { diskSpace: options.diskSpace } : {}),
    });
    assertSourceUntouched(dbPath, before);
    if (!outcome.ok) {
      return report(false, fromVersion, fromVersion, [], outcome.message);
    }
    return report(true, outcome.fromVersion, outcome.toVersion, outcome.applied, "rehearsal passed");
  } catch (error) {
    assertSourceUntouched(dbPath, before);
    if (error instanceof MigrationFailedError) {
      return report(false, fromVersion, fromVersion, [], error.message);
    }
    throw error;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function report(
  ok: boolean,
  fromVersion: number,
  toVersion: number,
  applied: readonly AppliedMigration[],
  message: string,
): RehearsalReport {
  return { sourceUnmodified: true, ok, fromVersion, toVersion, applied, message };
}

function assertSourceUntouched(dbPath: string, before: string): void {
  if (fileFingerprint(dbPath) !== before) {
    throw new Error(`Rehearsal modified the source database "${dbPath}"`);
  }
}
