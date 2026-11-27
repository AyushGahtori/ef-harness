import fs from "node:fs";
import path from "node:path";
import {
  assertDiskSpace,
  diskProbeDirectory,
  listPreMigrationBackups,
  preMigrationBackupName,
  restoreVacuumBackup,
  restoreVacuumBackupSync,
  statfsDiskSpace,
  vacuumBytesNeeded,
  vacuumInto,
} from "./backup.js";
import {
  DatabaseNewerThanAppError,
  MigrationFailedError,
  ReadersActiveError,
  RebuildContractError,
  SchemaInvariantError,
  SchemaVersionGapError,
  WorkNotParkedError,
} from "./errors.js";
import { createNodeSqliteConnectionFactory } from "./connection.js";
import { markProjectNeedsRepair, readArtifactHashes } from "./needs-repair.js";
import { PRODUCTION_SCHEMA_VERSION } from "./production.js";
import {
  assertForeignKeyCheck,
  assertNodesIntegerPrimaryKey,
  assertQuickCheck,
  attachRebuildAuditHook,
  clearRebuildAuditHook,
  clearSearchRebuildPending,
  readSearchRebuildPending,
  rebuildNodesSearchIndexes,
  setRecoveryBackupPath,
} from "./rebuild.js";
import { maxKnownSchemaVersion, pendingMigrations, validateMigrationRegistry } from "./registry.js";
import { CODE_INDEX_BASELINE_NAME, SCHEMA_MIGRATIONS_DDL } from "./v2.js";
import { errorText, isSqliteLocked, readUserVersion, rollbackIfOpen, setUserVersion, tableExists } from "./sql.js";
import {
  REPAIR_OPTIONS,
  systemClock,
  type AppliedMigration,
  type Clock,
  type DiskSpaceProbe,
  type GlobalBrokerDb,
  type MigrateDatabaseOptions,
  type MigrationDefinition,
  type MigrationOutcome,
  type MigrationSuccess,
  type ProjectTarget,
  type SqliteConnection,
  type SqliteConnectionFactory,
  type TargetDb,
  type WorkerReaderPool,
} from "./types.js";

const DEFAULT_READER_TIMEOUT_MS = 5_000;
const UNPARKED_TASK_STATES = "('LEASED','CODING','STATIC_AUDIT','CLEAN_VERIFY')";

export interface MigrateToLatestTarget {
  readonly dbPath: string;
  readonly targetDb: TargetDb;
  readonly backupsDir?: string;
  readonly projectId?: string;
}

export interface MigrationRunnerOptions {
  readonly globalDbPath: string;
  readonly globalDb: GlobalBrokerDb;
  readonly migrations: readonly MigrationDefinition[];
  readonly appVersion: string;
  readonly readers: WorkerReaderPool;
  readonly baselineSchemaVersion?: number;
  readonly readerDrainTimeoutMs?: number;
  readonly clock?: Clock;
  readonly diskSpace?: DiskSpaceProbe;
  readonly connectionFactory?: SqliteConnectionFactory;
}

export class MigrationRunner {
  constructor(private readonly options: MigrationRunnerOptions) {
    validateMigrationRegistry(
      options.migrations,
      options.baselineSchemaVersion ?? PRODUCTION_SCHEMA_VERSION,
    );
  }

  /** Daemon startup migrates global.db only and does not open project databases. */
  migrateOnStartup(): Promise<MigrationSuccess> {
    return this.migrateGlobalDatabase();
  }

  async migrateGlobalDatabase(): Promise<MigrationSuccess> {
    const outcome = await migrateDatabase(this.commonOptions(this.options.globalDbPath, "global"));
    if (!outcome.ok) {
      throw new MigrationFailedError("global.db migration cannot be isolated as needs_repair", {
        cause: outcome,
        backupPath: outcome.backupPath,
        restored: true,
      });
    }
    return outcome;
  }

  /** Lazy per-project migration. A failure isolates that project and leaves the others running. */
  migrateProject(project: ProjectTarget): Promise<MigrationOutcome> {
    return migrateDatabase({
      ...this.commonOptions(project.stateDbPath, "state"),
      projectId: project.id,
      globalDb: this.options.globalDb,
      ...(project.backupsDir !== undefined ? { backupsDir: project.backupsDir } : {}),
    });
  }

  /** Same lazy path as `migrateProject`, named for the open-project call site. */
  openProject(project: ProjectTarget): Promise<MigrationOutcome> {
    return this.migrateProject(project);
  }

  /**
   * Forward-migrate an already open writer connection.
   * The caller closes `conn`. This method closes it only when a failed
   * migration must restore the pre-upgrade backup over the live file.
   */
  migrateToLatest(conn: SqliteConnection, target: MigrateToLatestTarget): MigrationSuccess {
    const baseline = this.options.baselineSchemaVersion ?? PRODUCTION_SCHEMA_VERSION;
    const maxKnown = maxKnownSchemaVersion(this.options.migrations, target.targetDb, baseline);
    const clock = this.options.clock ?? systemClock;
    const diskSpace = this.options.diskSpace ?? statfsDiskSpace;
    const backupsDir = target.backupsDir ?? path.join(path.dirname(target.dbPath), "backups");
    let userVersion = readUserVersion(conn);
    if (target.targetDb === "code-index" && userVersion === 0 && tableExists(conn, "indexed_commits")) {
      stampCodeIndexBaseline(conn, this.options.appVersion, clock.now());
      userVersion = readUserVersion(conn);
    }
    if (!Number.isSafeInteger(userVersion) || userVersion < 0) {
      throw new SchemaVersionGapError(target.dbPath, userVersion, baseline);
    }
    if (userVersion > maxKnown) {
      throw new DatabaseNewerThanAppError({
        dbPath: target.dbPath,
        userVersion,
        maxKnownVersion: maxKnown,
        backupPaths: listPreMigrationBackups(backupsDir),
      });
    }
    if (userVersion < baseline) {
      throw new SchemaVersionGapError(target.dbPath, userVersion, baseline);
    }
    const pending = pendingMigrations(this.options.migrations, target.targetDb, userVersion);
    const pendingSearchBackup = readSearchRebuildPending(conn);
    if (pending.length === 0 && pendingSearchBackup === null) {
      return success(target.targetDb, userVersion, userVersion, null, []);
    }
    if (target.targetDb === "state" && !target.projectId) {
      throw new Error("State database migration requires a project id");
    }
    const drained = this.options.readers.drainAndClose(this.options.readerDrainTimeoutMs ?? DEFAULT_READER_TIMEOUT_MS);
    if (isPromise(drained)) {
      throw new ReadersActiveError("migrateToLatest requires readers to drain synchronously", {
        dbPath: target.dbPath,
      });
    }
    if (pending.length > 0 || pendingSearchBackup !== null) {
      assertWorkParked(conn, target.dbPath);
    }
    const bytesNeeded = vacuumBytesNeeded(conn);
    if (pending.length > 0) {
      assertDiskSpace({
        dbPath: target.dbPath,
        directory: diskProbeDirectory(backupsDir, target.dbPath),
        bytesNeeded,
        diskSpace,
      });
    }

    const fromVersion = userVersion;
    const applied: AppliedMigration[] = [];
    let migrationBackup: string | null = null;
    let resumeBackup: string | null = null;
    let startedMutation = false;
    let locked = false;
    try {
      acquireExclusiveWriterLock(conn, target.dbPath);
      locked = true;
      if (pendingSearchBackup !== null) {
        resumeBackup = pendingSearchBackup;
        setRecoveryBackupPath(conn, pendingSearchBackup);
        rebuildNodesSearchIndexes(conn);
        clearSearchRebuildPending(conn);
        resumeBackup = null;
      }
      if (pending.length > 0) {
        const lastPending = pending[pending.length - 1];
        if (!lastPending) throw new SchemaInvariantError("pending migration list was empty");
        const backupPath = allocateBackupPath(backupsDir, fromVersion, lastPending.version, clock.now());
        vacuumInto(conn, backupPath, target.targetDb, bytesNeeded);
        migrationBackup = backupPath;
        if (target.targetDb === "state" && target.projectId) {
          const hashes = readArtifactHashes(conn);
          this.options.globalDb.registerBackupCasPins({
            projectId: target.projectId,
            backupId: `${target.projectId}-backup-${path.basename(backupPath)}`,
            hashes,
            pinnedAt: clock.now(),
          });
        }
        setRecoveryBackupPath(conn, backupPath);
        startedMutation = true;
        for (const migration of pending) {
          const appliedAt = clock.now();
          applyMigration(conn, migration, this.options.appVersion, appliedAt);
          applied.push({
            version: migration.version,
            name: migration.name,
            kind: migration.kind,
            appVersion: this.options.appVersion,
            appliedAt,
          });
        }
        assertQuickCheck(conn);
        assertForeignKeyCheck(conn);
        assertNodesIntegerPrimaryKey(conn);
      }
      const toVersion = readUserVersion(conn);
      releaseExclusiveWriterLock(conn);
      locked = false;
      return success(target.targetDb, fromVersion, toVersion, migrationBackup, applied);
    } catch (error) {
      if (locked) {
        try {
          rollbackIfOpen(conn);
        } catch (rollbackError) {
          void rollbackError;
        }
        try {
          releaseExclusiveWriterLock(conn);
        } catch (unlockError) {
          void unlockError;
        }
      }
      const restoreFrom = startedMutation ? migrationBackup : resumeBackup;
      if (restoreFrom === null) throw error;
      try {
        conn.close();
      } catch (closeError) {
        void closeError;
      }
      try {
        restoreVacuumBackupSync(target.dbPath, restoreFrom);
      } catch (restoreError) {
        throw new MigrationFailedError(
          `Migration failed and the pre-migration backup could not be restored: ${errorText(restoreError)}`,
          { cause: error, backupPath: restoreFrom, restored: false },
        );
      }
      throw new MigrationFailedError(errorText(error), {
        cause: error,
        backupPath: restoreFrom,
        restored: true,
      });
    }
  }

  private commonOptions(dbPath: string, targetDb: TargetDb): MigrateDatabaseOptions {
    return {
      dbPath,
      targetDb,
      migrations: this.options.migrations,
      appVersion: this.options.appVersion,
      readers: this.options.readers,
      ...(this.options.baselineSchemaVersion !== undefined
        ? { baselineSchemaVersion: this.options.baselineSchemaVersion }
        : {}),
      ...(this.options.readerDrainTimeoutMs !== undefined
        ? { readerDrainTimeoutMs: this.options.readerDrainTimeoutMs }
        : {}),
      ...(this.options.clock !== undefined ? { clock: this.options.clock } : {}),
      ...(this.options.diskSpace !== undefined ? { diskSpace: this.options.diskSpace } : {}),
      ...(this.options.connectionFactory !== undefined
        ? { connectionFactory: this.options.connectionFactory }
        : {}),
    };
  }
}

/**
 * Forward-only migration safety sequence:
 * 1. Confirm work is parked and reader threads are closed.
 * 2. Take the exclusive writer lock.
 * 3. VACUUM INTO a timestamped backup and quick_check it before any DDL.
 * 4. Apply each pending migration in its own transaction.
 * 5. quick_check, foreign_key_check, and schema invariants.
 * 6. Record schema_migrations and PRAGMA user_version inside that transaction.
 */
export async function migrateDatabase(options: MigrateDatabaseOptions): Promise<MigrationOutcome> {
  if (typeof options.dbPath !== "string" || options.dbPath.trim() === "") {
    throw new Error("migrateDatabase requires a database path");
  }
  if (typeof options.appVersion !== "string" || options.appVersion.trim() === "") {
    throw new Error("migrateDatabase requires an app version");
  }
  const baseline = options.baselineSchemaVersion ?? PRODUCTION_SCHEMA_VERSION;
  validateMigrationRegistry(options.migrations, baseline);
  const maxKnown = maxKnownSchemaVersion(options.migrations, options.targetDb, baseline);
  const clock = options.clock ?? systemClock;
  const diskSpace = options.diskSpace ?? statfsDiskSpace;
  const factory = options.connectionFactory ?? createNodeSqliteConnectionFactory();
  const backupsDir = options.backupsDir ?? path.join(path.dirname(options.dbPath), "backups");
  const timeoutMs = options.readerDrainTimeoutMs ?? DEFAULT_READER_TIMEOUT_MS;

  const preview = factory.open(options.dbPath, { readOnly: true, targetDb: options.targetDb });
  let userVersion: number;
  let pending: MigrationDefinition[];
  let pendingSearchBackup: string | null;
  let bytesNeeded: number;
  try {
    userVersion = readUserVersion(preview);
    if (!Number.isSafeInteger(userVersion) || userVersion < 0) {
      throw new SchemaVersionGapError(options.dbPath, userVersion, baseline);
    }
    if (userVersion > maxKnown) {
      throw new DatabaseNewerThanAppError({
        dbPath: options.dbPath,
        userVersion,
        maxKnownVersion: maxKnown,
        backupPaths: listPreMigrationBackups(backupsDir),
      });
    }
    if (userVersion < baseline) {
      throw new SchemaVersionGapError(options.dbPath, userVersion, baseline);
    }
    pending = pendingMigrations(options.migrations, options.targetDb, userVersion);
    pendingSearchBackup = readSearchRebuildPending(preview);
    bytesNeeded = vacuumBytesNeeded(preview);
    if (pending.length > 0 || pendingSearchBackup !== null) {
      assertWorkParked(preview, options.dbPath);
    }
  } finally {
    preview.close();
  }

  if (pending.length === 0 && pendingSearchBackup === null) {
    return success(options.targetDb, userVersion, userVersion, null, []);
  }

  if (options.targetDb === "state" && options.rehearsal !== true) {
    if (!options.globalDb || !options.projectId) {
      throw new Error("State database migration requires a GlobalBrokerDb and project id");
    }
  }

  await drainReaders(options.readers, timeoutMs, options.dbPath);

  if (pending.length > 0) {
    assertDiskSpace({
      dbPath: options.dbPath,
      directory: diskProbeDirectory(backupsDir, options.dbPath),
      bytesNeeded,
      diskSpace,
    });
  }

  const fromVersion = userVersion;
  const applied: AppliedMigration[] = [];
  let write: SqliteConnection | undefined;
  let migrationBackup: string | null = null;
  let resumeBackup: string | null = null;
  let startedMutation = false;

  try {
    write = factory.open(options.dbPath, { readOnly: false, targetDb: options.targetDb });
    acquireExclusiveWriterLock(write, options.dbPath);
    if (pendingSearchBackup !== null) {
      resumeBackup = pendingSearchBackup;
      setRecoveryBackupPath(write, pendingSearchBackup);
      rebuildNodesSearchIndexes(write);
      clearSearchRebuildPending(write);
      resumeBackup = null;
    }
    if (pending.length > 0) {
      const lastPending = pending[pending.length - 1];
      if (!lastPending) throw new SchemaInvariantError("pending migration list was empty");
      const backupPath = allocateBackupPath(backupsDir, fromVersion, lastPending.version, clock.now());
      vacuumInto(write, backupPath, options.targetDb, bytesNeeded);
      migrationBackup = backupPath;
      if (options.targetDb === "state" && options.rehearsal !== true && options.globalDb && options.projectId) {
        const hashes = readArtifactHashes(write);
        options.globalDb.registerBackupCasPins({
          projectId: options.projectId,
          backupId: `${options.projectId}-backup-${path.basename(backupPath)}`,
          hashes,
          pinnedAt: clock.now(),
        });
      }
      setRecoveryBackupPath(write, backupPath);
      startedMutation = true;
      for (const migration of pending) {
        const appliedAt = clock.now();
        applyMigration(write, migration, options.appVersion, appliedAt);
        applied.push({
          version: migration.version,
          name: migration.name,
          kind: migration.kind,
          appVersion: options.appVersion,
          appliedAt,
        });
      }
      assertQuickCheck(write);
      assertForeignKeyCheck(write);
      assertNodesIntegerPrimaryKey(write);
    }
    const toVersion = readUserVersion(write);
    releaseExclusiveWriterLock(write);
    write.close();
    write = undefined;
    return success(options.targetDb, fromVersion, toVersion, migrationBackup, applied);
  } catch (error) {
    if (write) {
      try {
        rollbackIfOpen(write);
      } catch (rollbackError) {
        void rollbackError;
      }
      try {
        releaseExclusiveWriterLock(write);
      } catch (unlockError) {
        void unlockError;
      }
      write.close();
      write = undefined;
    }
    const restoreFrom = startedMutation ? migrationBackup : resumeBackup;
    if (restoreFrom === null) throw error;
    try {
      await restoreVacuumBackup(options.dbPath, restoreFrom);
    } catch (restoreError) {
      if (options.targetDb === "state" && options.rehearsal !== true && options.globalDb && options.projectId) {
        try {
          markProjectNeedsRepair(options.globalDb, options.projectId);
        } catch (statusError) {
          void statusError;
        }
      }
      throw new MigrationFailedError(
        `Migration failed and the pre-migration backup could not be restored: ${errorText(restoreError)}`,
        { cause: error, backupPath: restoreFrom, restored: false },
      );
    }
    if (options.targetDb === "state" && options.rehearsal !== true && options.globalDb && options.projectId) {
      markProjectNeedsRepair(options.globalDb, options.projectId);
      return {
        ok: false,
        status: "needs_repair",
        options: REPAIR_OPTIONS,
        projectId: options.projectId,
        backupPath: restoreFrom,
        message: errorText(error),
      };
    }
    throw new MigrationFailedError(errorText(error), {
      cause: error,
      backupPath: restoreFrom,
      restored: true,
    });
  } finally {
    write?.close();
  }
}

function isPromise(value: unknown): value is Promise<void> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

function stampCodeIndexBaseline(conn: SqliteConnection, appVersion: string, appliedAt: number): void {
  conn.exec("BEGIN IMMEDIATE");
  try {
    conn.exec(SCHEMA_MIGRATIONS_DDL);
    conn
      .prepare(
        "INSERT OR IGNORE INTO schema_migrations(version, name, kind, app_version, applied_at) VALUES (1, ?, 'additive', ?, ?)",
      )
      .run(CODE_INDEX_BASELINE_NAME, appVersion, appliedAt);
    setUserVersion(conn, 1);
    conn.exec("COMMIT");
  } catch (error) {
    rollbackIfOpen(conn);
    throw error;
  }
}

function success(
  targetDb: TargetDb,
  fromVersion: number,
  toVersion: number,
  backupPath: string | null,
  applied: readonly AppliedMigration[],
): MigrationSuccess {
  return { ok: true, targetDb, fromVersion, toVersion, backupPath, applied };
}

function applyMigration(
  conn: SqliteConnection,
  migration: MigrationDefinition,
  appVersion: string,
  appliedAt: number,
): void {
  if (migration.kind === "rebuild") {
    let recorded = false;
    attachRebuildAuditHook(conn, () => {
      migration.check?.(conn);
      recordMigration(conn, migration, appVersion, appliedAt);
      recorded = true;
    });
    try {
      migration.apply(conn);
    } catch (error) {
      rollbackIfOpen(conn);
      throw error;
    } finally {
      clearRebuildAuditHook(conn);
    }
    if (!recorded) {
      throw new RebuildContractError(`Rebuild migration "${migration.name}" must call runTwelveStepRebuild`);
    }
    return;
  }

  conn.exec("BEGIN IMMEDIATE");
  try {
    migration.apply(conn);
    migration.check?.(conn);
    recordMigration(conn, migration, appVersion, appliedAt);
    conn.exec("COMMIT");
  } catch (error) {
    rollbackIfOpen(conn);
    throw error;
  }
}

function recordMigration(
  conn: SqliteConnection,
  migration: MigrationDefinition,
  appVersion: string,
  appliedAt: number,
): void {
  const current = readUserVersion(conn);
  if (migration.version <= current) {
    throw new SchemaInvariantError(
      `Refusing to move PRAGMA user_version from ${current} to ${migration.version}`,
    );
  }
  if (!tableExists(conn, "schema_migrations")) {
    throw new Error("schema_migrations is missing; refusing to record a migration");
  }
  conn
    .prepare(
      "INSERT INTO schema_migrations(version, name, kind, app_version, applied_at) VALUES(?, ?, ?, ?, ?)",
    )
    .run(migration.version, migration.name, migration.kind, appVersion, appliedAt);
  setUserVersion(conn, migration.version);
}

function assertWorkParked(conn: SqliteConnection, dbPath: string): void {
  const active: string[] = [];
  if (tableExists(conn, "task_runtime")) {
    const rows = conn
      .prepare(`SELECT task, state FROM task_runtime WHERE state IN ${UNPARKED_TASK_STATES}`)
      .all();
    for (const row of rows) {
      active.push(`task ${String(row.task)}:${String(row.state)}`);
    }
  }
  if (tableExists(conn, "attempts")) {
    const rows = conn.prepare("SELECT id, task FROM attempts WHERE state = 'running'").all();
    for (const row of rows) {
      active.push(`attempt ${String(row.id)} on ${String(row.task)}`);
    }
  }
  if (active.length > 0) throw new WorkNotParkedError(dbPath, active);
}

function allocateBackupPath(
  backupsDir: string,
  oldVersion: number,
  newVersion: number,
  timestamp: number,
): string {
  fs.mkdirSync(backupsDir, { recursive: true });
  const base = preMigrationBackupName(oldVersion, newVersion, timestamp);
  const first = path.join(backupsDir, base);
  if (!fs.existsSync(first)) return first;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = path.join(backupsDir, base.replace(/\.db$/, `-${suffix}.db`));
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new SchemaInvariantError(`Could not allocate a pre-migration backup name for ${base}`);
}

function acquireExclusiveWriterLock(conn: SqliteConnection, dbPath: string): void {
  try {
    conn.exec("PRAGMA locking_mode = EXCLUSIVE");
    conn.exec("BEGIN IMMEDIATE");
    conn.exec("COMMIT");
  } catch (error) {
    if (isSqliteLocked(error)) {
      throw new ReadersActiveError("Exclusive migration lock could not be acquired because readers are still active", {
        cause: error,
        dbPath,
      });
    }
    throw error;
  }
}

function releaseExclusiveWriterLock(conn: SqliteConnection): void {
  conn.exec("PRAGMA locking_mode = NORMAL");
}

async function drainReaders(pool: WorkerReaderPool, timeoutMs: number, dbPath: string): Promise<void> {
  if (typeof pool?.drainAndClose !== "function") {
    throw new ReadersActiveError("WorkerReaderPool.drainAndClose() is required before the migration lock", {
      dbPath,
    });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new ReadersActiveError(`Readers did not close within ${timeoutMs} ms`, { dbPath }));
      }, timeoutMs);
      Promise.resolve()
        .then(() => pool.drainAndClose(timeoutMs))
        .then(
          () => {
            if (timer !== undefined) clearTimeout(timer);
            resolve();
          },
          (error: unknown) => {
            if (timer !== undefined) clearTimeout(timer);
            reject(error);
          },
        );
    });
  } catch (error) {
    if (error instanceof ReadersActiveError) throw error;
    throw new ReadersActiveError("Readers could not be closed before migration", { cause: error, dbPath });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
