/** Consumed and produced contracts for the forward-only migration engine. */

export const REPAIR_OPTIONS = ["Retry", "Export", "Report"] as const;

export type RepairOption = (typeof REPAIR_OPTIONS)[number];

export type MigrationKind = "additive" | "rebuild" | "data";

export type TargetDb = "global" | "state" | "code-index";

export type ProjectStatus = "ok" | "needs_migration" | "needs_repair" | "offline" | "removed";

export type SqlValue = string | number | bigint | Uint8Array | null;

export interface SqlRow {
  readonly [column: string]: SqlValue | undefined;
}

export interface SqliteRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

/**
 * Statement surface used by migrations.
 * Task 012's SqliteConnection adapter must be able to supply this shape.
 */
export interface SqliteStatement {
  run(...params: readonly SqlValue[]): SqliteRunResult;
  get(...params: readonly SqlValue[]): SqlRow | undefined;
  all(...params: readonly SqlValue[]): SqlRow[];
}

/**
 * Minimal writer/reader connection consumed from Task 012.
 * The node:sqlite adapter in this package is the stand-in until that task lands.
 */
export interface SqliteConnection {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  registerFunction(name: string, fn: (value: SqlValue) => SqlValue): void;
  close(): void;
}

export interface SqliteConnectionFactory {
  open(dbPath: string, options: { readonly readOnly: boolean; readonly targetDb: TargetDb }): SqliteConnection;
}

export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/**
 * Reader threads must be drained before the migration lock.
 * `drainAndClose` resolves only after every reader connection is closed.
 */
export interface WorkerReaderPool {
  drainAndClose(timeoutMs: number): void | Promise<void>;
}

export interface DiskSpaceProbe {
  availableBytes(directory: string): number;
}

/**
 * Subset of Task 014's GlobalBrokerDb used for backup pins and repair isolation.
 */
export interface GlobalBrokerDb {
  setProjectStatus(projectId: string, status: ProjectStatus): void;
  registerBackupCasPins(pin: {
    readonly projectId: string;
    readonly backupId: string;
    readonly hashes: readonly string[];
    readonly pinnedAt: number;
  }): void;
}

export interface MigrationDefinition {
  readonly kind: MigrationKind;
  readonly version: number;
  readonly name: string;
  readonly targetDb: TargetDb;
  /**
   * For `additive` and `data`, runs inside the migration transaction.
   * For `rebuild`, must call `runTwelveStepRebuild` so the audit row commits
   * with the table swap. Must not open its own transaction for additive/data.
   */
  apply(conn: SqliteConnection): void;
  /** Optional invariant checked inside the same transaction, before commit. */
  check?(conn: SqliteConnection): void;
}

export interface TwelveStepRebuildPlan {
  readonly table: string;
  readonly newTable: string;
  readonly createTableSql: string;
  readonly copySql: string;
  /** Skip recreating these snapshotted objects so a forgotten view fails closed. */
  readonly omitDependentObjects?: readonly string[];
  readonly beforeCommit?: (conn: SqliteConnection) => void;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly kind: MigrationKind;
  readonly appVersion: string;
  readonly appliedAt: number;
}

export interface MigrationSuccess {
  readonly ok: true;
  readonly targetDb: TargetDb;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly backupPath: string | null;
  readonly applied: readonly AppliedMigration[];
}

export interface NeedsRepairResult {
  readonly ok: false;
  readonly status: "needs_repair";
  readonly options: typeof REPAIR_OPTIONS;
  readonly projectId: string;
  readonly backupPath: string;
  readonly message: string;
}

export type MigrationOutcome = MigrationSuccess | NeedsRepairResult;

export interface MigrateDatabaseOptions {
  readonly dbPath: string;
  readonly targetDb: TargetDb;
  readonly migrations: readonly MigrationDefinition[];
  readonly appVersion: string;
  readonly readers: WorkerReaderPool;
  readonly baselineSchemaVersion?: number;
  readonly readerDrainTimeoutMs?: number;
  readonly globalDb?: GlobalBrokerDb;
  readonly projectId?: string;
  readonly backupsDir?: string;
  readonly clock?: Clock;
  readonly diskSpace?: DiskSpaceProbe;
  readonly connectionFactory?: SqliteConnectionFactory;
  /** Dry run against a clone. Does not register pins or mark projects. */
  readonly rehearsal?: boolean;
}

export interface RehearsalReport {
  readonly sourceUnmodified: true;
  readonly ok: boolean;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly applied: readonly AppliedMigration[];
  readonly message: string;
}

export interface ProjectTarget {
  readonly id: string;
  readonly stateDbPath: string;
  readonly backupsDir?: string;
}
