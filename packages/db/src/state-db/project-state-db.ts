import fs from "node:fs";
import path from "node:path";
import {
  lookupNamedQuery,
  ReaderPool,
  type DbHandle,
  type SqliteConnection as DriverSqliteConnection,
} from "../driver/index.js";
import { DatabaseNewerThanAppError } from "../migrations/errors.js";
import { upgradeDatabaseOnOpen } from "../migrations/open-upgrade.js";
import { PRODUCTION_SCHEMA_VERSION } from "../migrations/production.js";
import {
  APP_SUPPORTED_SCHEMA_VERSION,
  DEFAULT_APP_VERSION,
  INITIAL_STREAM_EPOCH,
  INITIAL_WRITER_EPOCH,
  META_KEYS,
  WEEK_MS,
} from "./constants.js";
import { bootstrapStateDatabase, discardSqliteFile } from "./bootstrap.js";
import {
  ClosedDatabaseError,
  DatabaseSchemaVersionError,
  DatabaseVersionTooNewError,
  ProjectSafeModeError,
  ReadOnlyDatabaseError,
} from "./errors.js";
import { createDefaultLogger } from "./logger.js";
import { ensureProjectDirectories, resolveProjectPaths, type ProjectPaths } from "./paths.js";
import { classifyOwner, currentProcessIdentity } from "./process-identity.js";
import { SafeModeController } from "./safe-mode.js";
import { sleepMs } from "./rename-retry.js";
import {
  asSafeInteger,
  classifyWriteFailure,
  integrityReportOk,
  openStateConnection,
  probeUserVersion,
  readIntegrityReport,
  type StateConnection,
} from "./sqlite-session.js";
import type {
  DataVersionCheck,
  DatabaseMode,
  IntegrityCheckResult,
  OpenProjectStateDbOptions,
  ProjectRuntimeRow,
  ResyncRequiredPayload,
  SafeModeDiagnostics,
  SafeModeReason,
  SafeModeStatusPayload,
  SchemaMigrationRow,
  StateDbLogger,
  StaleOwnerReason,
  StreamEpochBumpReason,
  WriterLockStatus,
  WriterOwner,
} from "./types.js";
import { errorMessage, ExclusiveWriterLock, sqliteErrorCode } from "./writer-lock.js";

const openProjects = new Map<string, ProjectStateDb>();

export function openProjectStateDb(options: OpenProjectStateDbOptions): ProjectStateDb {
  const paths = resolveProjectPaths(options.projectId, options.rootDir);
  const existing = openProjects.get(options.projectId);
  if (existing && !existing.isClosed()) return existing;
  const db = new ProjectStateDb(options, paths);
  openProjects.set(options.projectId, db);
  try {
    db.open();
    return db;
  } catch (error) {
    if (openProjects.get(options.projectId) === db) openProjects.delete(options.projectId);
    db.abandon();
    throw error;
  }
}

export class ProjectStateDb implements DbHandle {
  readonly projectId: string;
  private readonly paths: ProjectPaths;
  private readonly logger: StateDbLogger;
  private readonly clock: () => number;
  private readonly appVersion: string;
  private readonly supportedSchemaVersion: number;
  private readonly beforePublish: (() => void) | undefined;
  private readonly safeMode: SafeModeController;
  private readonly resyncListeners = new Set<(payload: ResyncRequiredPayload) => void>();
  private session: StateConnection | undefined;
  private readersPool: ReaderPool | undefined;
  private lock: ExclusiveWriterLock | undefined;
  private modeValue: DatabaseMode | undefined;
  private closed = false;
  private cachedDataVersion: number | undefined;
  private userVersionValue = 0;
  private lastQuickCheck: string | null = null;

  constructor(options: OpenProjectStateDbOptions, paths: ProjectPaths) {
    this.projectId = options.projectId;
    this.paths = paths;
    this.logger = options.logger ?? createDefaultLogger();
    this.clock = options.now ?? (() => Date.now());
    this.appVersion = options.appVersion ?? DEFAULT_APP_VERSION;
    this.supportedSchemaVersion = options.supportedSchemaVersion ?? APP_SUPPORTED_SCHEMA_VERSION;
    this.beforePublish = options.beforePublish;
    this.safeMode = new SafeModeController(this.projectId, this.logger);
    if (options.onSafeMode) this.safeMode.subscribe(options.onSafeMode);
    if (options.onResyncRequired) this.resyncListeners.add(options.onResyncRequired);
  }

  get databasePath(): string {
    return this.paths.databasePath;
  }

  get backupDirectory(): string {
    return this.paths.backupDirectory;
  }

  get mode(): DatabaseMode {
    this.assertOpen();
    return this.modeValue ?? "readonly";
  }

  get writer(): DriverSqliteConnection {
    return this.connection().driver;
  }

  get readers(): ReaderPool {
    this.assertOpen();
    if (this.readersPool === undefined) {
      this.readersPool = new ReaderPool({
        location: this.paths.databasePath,
        role: "state",
        size: 2,
        lazy: true,
      });
    }
    return this.readersPool;
  }

  query(name: string): string {
    this.assertOpen();
    return lookupNamedQuery(name);
  }

  isClosed(): boolean {
    return this.closed;
  }

  open(): void {
    ensureProjectDirectories(this.paths);
    const lock = ExclusiveWriterLock.tryAcquire(this.paths.lockPath);
    if (lock === "busy") {
      this.openReadonly("exclusive writer lock is held");
      return;
    }
    this.lock = lock;
    try {
      discardSqliteFile(this.paths.initTempPath);
      if (!fs.existsSync(this.paths.databasePath)) {
        this.publishNewDatabase();
      }
      this.migrateForward();
      this.modeValue = "readwrite";
      this.session = openStateConnection(this.paths.databasePath, "readwrite");
      this.reconcileOwner();
      this.refreshCachedDataVersion();
      this.runStartupChecks();
    } catch (error) {
      this.recoverOpenFailure(error);
    }
  }

  close(): void {
    if (this.closed) return;
    this.releaseResources(true);
    this.unregister();
  }

  abandon(): void {
    this.releaseResources(false);
    this.unregister();
  }

  getMeta(key: string): string | null {
    assertMetaKey(key);
    this.assertOpen();
    return this.readMeta(key);
  }

  setMeta(key: string, value: string): void {
    assertMetaKey(key);
    this.writeMeta(key, value);
  }

  getOwner(): WriterOwner | null {
    this.assertOpen();
    return this.readOwner();
  }

  acquireWriterLock(): WriterLockStatus {
    this.assertOpen();
    return {
      acquired: this.modeValue === "readwrite" && this.lock !== undefined,
      mode: this.mode,
      owner: this.readOwner(),
    };
  }

  checkDataVersion(): DataVersionCheck {
    this.assertOpen();
    this.safeMode.refuseIfActive();
    const current = this.connection().pragmaInteger("data_version");
    const previous = this.cachedDataVersion;
    if (previous === undefined || current === previous) {
      this.cachedDataVersion = current;
      return { dataVersion: current, foreignWrite: false };
    }
    const quickCheck = readIntegrityReport(this.connection(), "quick_check");
    this.lastQuickCheck = quickCheck;
    const reason: SafeModeReason = integrityReportOk(quickCheck) ? "foreign_write" : "corrupt";
    const diagnostics = this.diagnostics(
      `Another connection committed to state.db (PRAGMA data_version ${previous} -> ${current}).`,
      { quickCheck, dataVersion: current, previousDataVersion: previous },
    );
    this.enterSafeMode(reason, diagnostics);
    throw new ProjectSafeModeError(reason, diagnostics);
  }

  enterSafeMode(reason: SafeModeReason, diagnostics: SafeModeDiagnostics): void {
    this.assertOpen();
    const stored = this.safeMode.arm(reason, diagnostics);
    this.persistSafeMode(reason, stored);
    this.safeMode.publish(this.modeValue ?? "readonly");
  }

  isSafeMode(): boolean {
    this.assertOpen();
    return this.safeMode.isActive();
  }

  getSafeModeStatus(): SafeModeStatusPayload | null {
    this.assertOpen();
    return this.safeMode.statusPayload();
  }

  getLastQuickCheck(): string | null {
    this.assertOpen();
    return this.lastQuickCheck;
  }

  assertCanDispatch(): void {
    this.assertMutable();
  }

  onSafeMode(listener: (payload: SafeModeStatusPayload) => void): () => void {
    return this.safeMode.subscribe(listener);
  }

  getStreamEpoch(): number {
    this.assertOpen();
    return requireSafeInteger(this.readMeta(META_KEYS.streamEpoch), "stream_epoch");
  }

  bumpStreamEpoch(reason: StreamEpochBumpReason): ResyncRequiredPayload {
    this.assertMutable();
    this.checkDataVersion();
    let next = INITIAL_STREAM_EPOCH;
    try {
      this.connection().immediate(() => {
        next = requireSafeInteger(this.readMeta(META_KEYS.streamEpoch), "stream_epoch") + 1;
        this.upsert(META_KEYS.streamEpoch, String(next));
      });
    } catch (error) {
      this.handleWriteError(error);
    }
    this.refreshCachedDataVersion();
    const payload: ResyncRequiredPayload = {
      type: "resync_required",
      projectId: this.projectId,
      streamEpoch: next,
      reason,
    };
    this.logger.info("bumped stream_epoch", { event: "state_db.stream_epoch", ...payload });
    for (const listener of this.resyncListeners) {
      try {
        listener(payload);
      } catch (error) {
        this.logger.warn("resync listener failed", {
          event: "state_db.stream_epoch.listener_failed",
          message: errorMessage(error),
        });
      }
    }
    return payload;
  }

  onResyncRequired(listener: (payload: ResyncRequiredPayload) => void): () => void {
    this.resyncListeners.add(listener);
    return () => {
      this.resyncListeners.delete(listener);
    };
  }

  isIntegrityCheckDue(nowMs?: number): boolean {
    this.assertOpen();
    const now = nowMs ?? this.now();
    const raw = this.readMeta(META_KEYS.lastIntegrityCheckAt);
    if (raw === null) return true;
    const last = Number(raw);
    if (!Number.isSafeInteger(last)) return true;
    return now - last >= WEEK_MS;
  }

  runIntegrityCheckIfDue(nowMs?: number): IntegrityCheckResult {
    this.assertOpen();
    if (this.modeValue !== "readwrite") throw new ReadOnlyDatabaseError();
    const now = nowMs ?? this.now();
    if (!this.isIntegrityCheckDue(now)) return { ran: false, ok: true, report: "" };
    let report: string;
    try {
      report = readIntegrityReport(this.connection(), "integrity_check");
    } catch (error) {
      this.handleWriteError(error);
    }
    const ok = integrityReportOk(report);
    if (!ok) {
      const entering = !this.safeMode.isActive();
      const diagnostics = this.diagnostics(`PRAGMA integrity_check failed: ${report}`, { quickCheck: report });
      this.enterSafeMode("corrupt", diagnostics);
      if (entering) throw new ProjectSafeModeError("corrupt", diagnostics);
      return { ran: true, ok: false, report };
    }
    if (!this.safeMode.isActive()) this.writeMeta(META_KEYS.lastIntegrityCheckAt, String(now));
    this.logger.info("finished weekly integrity_check", {
      event: "state_db.integrity_check",
      projectId: this.projectId,
      ok: true,
    });
    return { ran: true, ok: true, report };
  }

  getUserVersion(): number {
    this.assertOpen();
    return this.userVersionValue;
  }

  getProjectRuntime(): ProjectRuntimeRow {
    this.assertOpen();
    const row = this.connection().get(
      "SELECT id, state, paused, updated_rev FROM project_runtime WHERE id = 1",
    );
    if (!row) throw new Error("project_runtime singleton is missing.");
    const id = asSafeInteger(row.id, "project_runtime.id");
    if (id !== 1) throw new Error("project_runtime.id must be 1.");
    return {
      id: 1,
      state: String(row.state),
      paused: asSafeInteger(row.paused, "project_runtime.paused"),
      updatedRev: asSafeInteger(row.updated_rev, "project_runtime.updated_rev"),
    };
  }

  listSchemaMigrations(): SchemaMigrationRow[] {
    this.assertOpen();
    return this.connection()
      .all("SELECT version, name, kind, app_version, applied_at FROM schema_migrations ORDER BY version")
      .map((row) => ({
        version: asSafeInteger(row.version, "schema_migrations.version"),
        name: String(row.name),
        kind: String(row.kind),
        appVersion: String(row.app_version),
        appliedAt: asSafeInteger(row.applied_at, "schema_migrations.applied_at"),
      }));
  }

  evaluateSearchText(value: string): string {
    this.assertOpen();
    const row = this.connection().get("SELECT ef_search_text(?) AS text", [value]);
    const text = row?.text;
    return text === undefined || text === null ? "" : String(text);
  }

  /** Caps allocated pages so the next large write raises SQLITE_FULL without filling the disk. */
  applyStorageCeiling(maxPageCount: number): void {
    this.assertWriter();
    this.safeMode.refuseIfActive();
    if (!Number.isSafeInteger(maxPageCount) || maxPageCount < 1) {
      throw new Error("Storage ceiling must be a positive safe integer page count.");
    }
    this.connection().exec(`PRAGMA max_page_count = ${maxPageCount}`);
  }

  getPageCount(): number {
    this.assertOpen();
    return this.connection().pragmaInteger("page_count");
  }

  private publishNewDatabase(): void {
    const request = {
      databasePath: this.paths.databasePath,
      tempPath: this.paths.initTempPath,
      projectId: this.projectId,
      nowMs: this.now(),
      appVersion: this.appVersion,
      supportedSchemaVersion: PRODUCTION_SCHEMA_VERSION,
      ...(this.beforePublish ? { beforePublish: this.beforePublish } : {}),
    };
    bootstrapStateDatabase(request);
    this.logger.info("initialized state.db", {
      event: "state_db.bootstrap",
      projectId: this.projectId,
      path: this.paths.databasePath,
    });
  }

  private openReadonly(message: string): void {
    try {
      this.waitForPublishedDatabase();
      this.assertOpenedVersion();
      this.modeValue = "readonly";
      this.session = openStateConnection(this.paths.databasePath, "readonly");
      this.logger.info("opened state.db read-only", {
        event: "state_db.readonly_fallback",
        projectId: this.projectId,
        message,
      });
      this.refreshCachedDataVersion();
      this.runStartupChecks();
    } catch (error) {
      this.recoverOpenFailure(error);
    }
  }

  private recoverOpenFailure(error: unknown): void {
    if (
      error instanceof ProjectSafeModeError ||
      error instanceof DatabaseVersionTooNewError ||
      error instanceof DatabaseSchemaVersionError
    ) {
      this.abandon();
      throw error;
    }
    const failure = classifyWriteFailure(error);
    if (failure === "other") {
      this.abandon();
      throw error instanceof Error ? error : new Error(errorMessage(error));
    }
    const reason: SafeModeReason = failure === "disk" ? "disk_io_error" : "corrupt";
    const code = sqliteErrorCode(error);
    const diagnostics = this.diagnostics(errorMessage(error), {
      ...(code === undefined ? {} : { sqliteCode: code }),
    });
    if (!this.session || this.closed) {
      this.abandon();
      throw new ProjectSafeModeError(reason, diagnostics);
    }
    try {
      this.enterSafeMode(reason, diagnostics);
    } catch (enterError) {
      this.abandon();
      if (enterError instanceof ProjectSafeModeError) throw enterError;
      throw new ProjectSafeModeError(reason, diagnostics);
    }
  }

  private readUserVersionOrThrow(): number {
    try {
      return probeUserVersion(this.paths.databasePath);
    } catch (error) {
      if (classifyWriteFailure(error) !== "corrupt") throw error;
      const code = sqliteErrorCode(error);
      throw new ProjectSafeModeError(
        "corrupt",
        this.diagnostics(`state.db could not be opened: ${errorMessage(error)}`, {
          ...(code === undefined ? {} : { sqliteCode: code }),
        }),
      );
    }
  }

  /** Read-only opens must already be at the migrated version. */
  private assertOpenedVersion(): void {
    const version = this.readUserVersionOrThrow();
    this.userVersionValue = version;
    if (version > this.supportedSchemaVersion) {
      throw new DatabaseVersionTooNewError(
        version,
        this.supportedSchemaVersion,
        this.paths.backupDirectory,
      );
    }
    if (version !== this.supportedSchemaVersion) {
      throw new DatabaseSchemaVersionError(version, this.supportedSchemaVersion);
    }
  }

  /** Writer opens run forward migrations until `user_version` matches this binary. */
  private migrateForward(): void {
    const version = this.readUserVersionOrThrow();
    if (version > this.supportedSchemaVersion) {
      throw new DatabaseVersionTooNewError(
        version,
        this.supportedSchemaVersion,
        this.paths.backupDirectory,
      );
    }
    if (version < PRODUCTION_SCHEMA_VERSION) {
      throw new DatabaseSchemaVersionError(version, this.supportedSchemaVersion);
    }
    if (version === this.supportedSchemaVersion) {
      this.userVersionValue = version;
      return;
    }
    try {
      const outcome = upgradeDatabaseOnOpen({
        dbPath: this.paths.databasePath,
        targetDb: "state",
        appVersion: this.appVersion,
        backupsDir: this.paths.backupDirectory,
        projectId: this.projectId,
        globalDbPath: path.join(this.paths.rootDir, "global.db"),
        clock: { now: () => this.now() },
      });
      this.userVersionValue = outcome.toVersion;
    } catch (error) {
      if (error instanceof DatabaseNewerThanAppError) {
        throw new DatabaseVersionTooNewError(
          error.userVersion,
          error.maxKnownVersion,
          this.paths.backupDirectory,
        );
      }
      throw error;
    }
    if (this.userVersionValue !== this.supportedSchemaVersion) {
      throw new DatabaseSchemaVersionError(this.userVersionValue, this.supportedSchemaVersion);
    }
  }

  private reconcileOwner(): void {
    const raw = this.readMeta(META_KEYS.owner);
    const previous = raw === null ? null : parseOwner(raw);
    if (raw !== null && previous === null) {
      this.takeOwnership(null, "pid_dead", this.readWriterEpoch() + 1);
      return;
    }
    const classification = classifyOwner(previous);
    if (classification.kind === "live-other") {
      this.becomeReadonly("owner row belongs to a live process");
      return;
    }
    if (classification.kind === "none") {
      this.takeOwnership(null, undefined, INITIAL_WRITER_EPOCH);
      return;
    }
    if (classification.kind === "self" && previous) {
      this.takeOwnership(previous, undefined, previous.epoch);
      return;
    }
    const priorEpoch = previous?.epoch ?? this.readWriterEpoch();
    const reason: StaleOwnerReason = classification.kind === "reused" ? "pid_reused" : "pid_dead";
    this.takeOwnership(previous, reason, priorEpoch + 1);
  }

  private takeOwnership(
    previous: WriterOwner | null,
    stale: StaleOwnerReason | undefined,
    epoch: number,
  ): void {
    const identity = currentProcessIdentity();
    const owner: WriterOwner = {
      pid: identity.pid,
      processStartTime: identity.processStartTime,
      epoch,
      hostname: identity.hostname,
      acquiredAt: this.now(),
    };
    try {
      this.connection().immediate(() => {
        this.upsert(META_KEYS.owner, JSON.stringify(owner));
        this.upsert(META_KEYS.writerEpoch, String(epoch));
      });
    } catch (error) {
      this.handleWriteError(error);
    }
    if (stale) {
      this.logger.warn("reclaimed stale state.db writer lock", {
        event: "state_db.writer_lock.reclaimed",
        projectId: this.projectId,
        reason: stale,
        previousOwner: previous,
        owner,
      });
    }
  }

  private becomeReadonly(message: string): void {
    const session = this.session;
    this.session = undefined;
    if (session) session.close();
    this.lock?.release();
    this.lock = undefined;
    this.modeValue = "readonly";
    this.session = openStateConnection(this.paths.databasePath, "readonly");
    this.logger.warn("opened state.db read-only", {
      event: "state_db.readonly_fallback",
      projectId: this.projectId,
      message,
    });
  }

  private runStartupChecks(): void {
    let report: string;
    try {
      report = readIntegrityReport(this.connection(), "quick_check");
    } catch (error) {
      const failure = classifyWriteFailure(error);
      if (failure === "other") throw error;
      const reason: SafeModeReason = failure === "disk" ? "disk_io_error" : "corrupt";
      const code = sqliteErrorCode(error);
      this.enterSafeMode(
        reason,
        this.diagnostics(errorMessage(error), {
          ...(code === undefined ? {} : { sqliteCode: code }),
        }),
      );
      return;
    }
    this.lastQuickCheck = report;
    if (!integrityReportOk(report)) {
      this.enterSafeMode(
        "corrupt",
        this.diagnostics(`PRAGMA quick_check failed: ${report}`, { quickCheck: report }),
      );
    }
    this.restorePersistedSafeMode();
  }

  private restorePersistedSafeMode(): void {
    if (this.safeMode.isActive()) return;
    if (this.readMeta(META_KEYS.safeMode) !== "1") return;
    const reason = parseReason(this.readMeta(META_KEYS.safeModeReason));
    const diagnostics =
      parseDiagnostics(this.readMeta(META_KEYS.safeModeDiagnostics)) ??
      this.diagnostics("Project was already in safe mode.");
    this.enterSafeMode(reason, diagnostics);
  }

  private persistSafeMode(reason: SafeModeReason, diagnostics: SafeModeDiagnostics): void {
    if (this.modeValue !== "readwrite" || !this.session) return;
    try {
      this.session.immediate(() => {
        this.upsert(META_KEYS.safeMode, "1");
        this.upsert(META_KEYS.safeModeReason, reason);
        this.upsert(META_KEYS.safeModeDiagnostics, JSON.stringify(diagnostics));
      });
      this.refreshCachedDataVersion();
    } catch (error) {
      this.logger.error("safe mode flag could not be persisted", {
        event: "state_db.safe_mode.persist_failed",
        message: errorMessage(error),
      });
    }
  }

  private writeMeta(key: string, value: string): void {
    this.assertMutable();
    this.checkDataVersion();
    try {
      this.connection().immediate(() => {
        this.upsert(key, value);
      });
    } catch (error) {
      this.handleWriteError(error);
    }
    this.refreshCachedDataVersion();
  }

  private handleWriteError(error: unknown): never {
    const failure = classifyWriteFailure(error);
    if (failure === "other") {
      throw error instanceof Error ? error : new Error(errorMessage(error));
    }
    const reason: SafeModeReason = failure === "disk" ? "disk_io_error" : "corrupt";
    const code = sqliteErrorCode(error);
    const diagnostics = this.diagnostics(errorMessage(error), {
      ...(code === undefined ? {} : { sqliteCode: code }),
    });
    this.enterSafeMode(reason, diagnostics);
    throw new ProjectSafeModeError(reason, diagnostics);
  }

  private upsert(key: string, value: string): void {
    this.connection().run(
      "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }

  private readMeta(key: string): string | null {
    const row = this.connection().get("SELECT value FROM meta WHERE key = ?", [key]);
    if (!row || row.value === undefined || row.value === null) return null;
    return String(row.value);
  }

  private readOwner(): WriterOwner | null {
    const raw = this.readMeta(META_KEYS.owner);
    if (raw === null) return null;
    return parseOwner(raw);
  }

  private readWriterEpoch(): number {
    const raw = this.readMeta(META_KEYS.writerEpoch);
    if (raw === null) return INITIAL_WRITER_EPOCH;
    return requireSafeInteger(raw, "writer_epoch");
  }

  private refreshCachedDataVersion(): void {
    this.cachedDataVersion = this.connection().pragmaInteger("data_version");
  }

  private waitForPublishedDatabase(): void {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (fs.existsSync(this.paths.databasePath)) return;
      sleepMs(50);
    }
    throw new Error(`state.db is not available at ${this.paths.databasePath}.`);
  }

  private releaseResources(checkpoint: boolean): void {
    if (this.closed) return;
    this.closed = true;
    const readers = this.readersPool;
    this.readersPool = undefined;
    if (readers) {
      void readers.close();
    }
    const session = this.session;
    this.session = undefined;
    if (session) {
      try {
        session.close(checkpoint && session.mode === "readwrite" ? undefined : { skipCheckpoint: true });
      } catch (error) {
        const message = errorMessage(error);
        if (!/not open|already closed/i.test(message)) {
          this.logger.warn("state.db close failed", { event: "state_db.close_failed", message });
        }
      }
    }
    this.lock?.release();
    this.lock = undefined;
  }

  private unregister(): void {
    if (openProjects.get(this.projectId) === this) openProjects.delete(this.projectId);
  }

  private connection(): StateConnection {
    if (this.closed || !this.session) throw new ClosedDatabaseError();
    return this.session;
  }

  private assertOpen(): void {
    if (this.closed || !this.session) throw new ClosedDatabaseError();
  }

  private assertWriter(): void {
    this.assertOpen();
    if (this.modeValue !== "readwrite") throw new ReadOnlyDatabaseError();
  }

  private assertMutable(): void {
    this.assertWriter();
    this.safeMode.refuseIfActive();
  }

  private now(): number {
    const value = this.clock();
    if (!Number.isSafeInteger(value)) {
      throw new Error("Clock did not return a safe integer millisecond timestamp.");
    }
    return value;
  }

  private diagnostics(
    message: string,
    extra?: {
      quickCheck?: string;
      sqliteCode?: number;
      dataVersion?: number;
      previousDataVersion?: number;
    },
  ): SafeModeDiagnostics {
    const diagnostics: SafeModeDiagnostics = {
      message,
      worktreesPreserved: true,
      checkpointsPreserved: true,
    };
    if (extra?.quickCheck !== undefined) diagnostics.quickCheck = extra.quickCheck;
    if (extra?.sqliteCode !== undefined) diagnostics.sqliteCode = extra.sqliteCode;
    if (extra?.dataVersion !== undefined) diagnostics.dataVersion = extra.dataVersion;
    if (extra?.previousDataVersion !== undefined) {
      diagnostics.previousDataVersion = extra.previousDataVersion;
    }
    return diagnostics;
  }
}

function assertMetaKey(key: string): void {
  if (key.length === 0 || key.length > 200 || key.includes("\u0000")) {
    throw new Error("meta key must be a non-empty string of at most 200 characters.");
  }
}

function requireSafeInteger(value: string | null, label: string): number {
  if (value === null) throw new Error(`${label} is missing from meta.`);
  return asSafeInteger(value, label);
}

function parseOwner(raw: string): WriterOwner | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const { pid, processStartTime, epoch, hostname, acquiredAt } = record;
    if (typeof pid !== "number" || !Number.isSafeInteger(pid)) return null;
    if (typeof processStartTime !== "string" || processStartTime.length === 0) return null;
    if (typeof epoch !== "number" || !Number.isSafeInteger(epoch)) return null;
    if (typeof hostname !== "string") return null;
    if (typeof acquiredAt !== "number" || !Number.isSafeInteger(acquiredAt)) return null;
    return { pid, processStartTime, epoch, hostname, acquiredAt };
  } catch (error) {
    const message = errorMessage(error);
    if (message.length === 0) return null;
    return null;
  }
}

function parseReason(value: string | null): SafeModeReason {
  if (value === "foreign_write" || value === "disk_io_error" || value === "corrupt") return value;
  return "corrupt";
}

function parseDiagnostics(raw: string | null): SafeModeDiagnostics | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (typeof record.message !== "string") return null;
    const diagnostics: SafeModeDiagnostics = {
      message: record.message,
      worktreesPreserved: true,
      checkpointsPreserved: true,
    };
    if (typeof record.quickCheck === "string") diagnostics.quickCheck = record.quickCheck;
    if (typeof record.sqliteCode === "number") diagnostics.sqliteCode = record.sqliteCode;
    if (typeof record.dataVersion === "number") diagnostics.dataVersion = record.dataVersion;
    if (typeof record.previousDataVersion === "number") {
      diagnostics.previousDataVersion = record.previousDataVersion;
    }
    return diagnostics;
  } catch (error) {
    const message = errorMessage(error);
    if (message.length === 0) return null;
    return null;
  }
}
