import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  listBackupFiles,
  inspectBackupFile,
  isRebuildOnlyDatabase,
} from "./backup-scheduler.js";
import { realSleeper, SystemClock, type Clock, type Sleeper } from "./clock.js";
import { withRotationLock } from "./lock.js";
import { moveOptionalFile, renameWithRetry } from "./rename.js";
import {
  FilesystemReplaySourceAdapter,
  replayPostBackupState,
  type ReplayResult,
  type ReplaySourceAdapter,
} from "./replay.js";
import { salvageCorruptDatabase } from "./salvage.js";
import {
  classifySqliteError,
  closeQuietly,
  createDatabaseFromSchema,
  errorMessage,
  openDatabase,
  readLastRev,
  readMeta,
  readSchema,
  registerSearchText,
  runPragmaCheck,
  writeMeta,
  type SchemaName,
} from "./sqlite-io.js";
import {
  RecoveryError,
  type BackupFileInfo,
  type DetectionKind,
  type GlobalBrokerDb,
  type ProjectStateDb,
  type RecoveryOutcome,
  type RecoveryReport,
  type RecoverySchedule,
  type SqliteCorruptCode,
  type UnrecoveredGap,
} from "./types.js";

export interface CorruptionRecoveryEngineOptions {
  readonly project: ProjectStateDb;
  readonly globalDb: GlobalBrokerDb;
  readonly backupsDir?: string;
  readonly historyDir?: string | null;
  readonly repoDir?: string | null;
  readonly telemetryDbPath?: string | null;
  readonly codeIndexDbPath?: string | null;
  readonly clock?: Clock;
  readonly sleeper?: Sleeper;
  readonly replay?: ReplaySourceAdapter;
}

export interface RestoreResult {
  readonly backup: BackupFileInfo | null;
  readonly skippedCorruptBackups: readonly string[];
  readonly quarantinedPath: string | null;
}

function detectionKind(schedule: RecoverySchedule): DetectionKind {
  if (schedule === "weekly") return "integrity_check";
  if (schedule === "runtime_error") return "runtime_error";
  if (schedule === "manual") return "manual";
  return "quick_check";
}

function bumpStreamEpoch(db: DatabaseSync): number {
  const raw = readMeta(db, "stream_epoch");
  const current = raw === null ? 0 : Number(raw);
  const next = Number.isFinite(current) ? current + 1 : 1;
  writeMeta(db, "stream_epoch", String(next));
  return next;
}

function quarantineDirectory(backupsDir: string, now: number): string {
  fs.mkdirSync(backupsDir, { recursive: true });
  let dir = path.join(backupsDir, `corrupt-${now}`);
  let suffix = 2;
  while (fs.existsSync(dir)) {
    dir = path.join(backupsDir, `corrupt-${now}-${suffix}`);
    suffix += 1;
  }
  fs.mkdirSync(dir);
  return dir;
}

async function quarantineLiveDatabase(
  stateDbPath: string,
  quarantineDir: string,
  sleeper: Sleeper,
): Promise<void> {
  const base = path.basename(stateDbPath);
  await moveOptionalFile(`${stateDbPath}-wal`, path.join(quarantineDir, `${base}-wal`), sleeper);
  await moveOptionalFile(`${stateDbPath}-shm`, path.join(quarantineDir, `${base}-shm`), sleeper);
  await moveOptionalFile(
    `${stateDbPath}-journal`,
    path.join(quarantineDir, `${base}-journal`),
    sleeper,
  );
  await moveOptionalFile(stateDbPath, path.join(quarantineDir, base), sleeper);
}

async function installDatabaseCopy(
  sourcePath: string,
  stateDbPath: string,
  sleeper: Sleeper,
): Promise<void> {
  const incoming = `${stateDbPath}.incoming.tmp`;
  fs.rmSync(incoming, { force: true });
  fs.copyFileSync(sourcePath, incoming);
  try {
    await renameWithRetry(incoming, stateDbPath, sleeper);
  } finally {
    if (fs.existsSync(incoming)) fs.rmSync(incoming, { force: true });
  }
}

/**
 * Promote the newest backup that passes quick_check and foreign_key_check.
 * WAL and SHM sidecars are quarantined before the backup bytes replace state.db.
 */
export async function restoreNewestGoodBackup(input: {
  readonly stateDbPath: string;
  readonly backupsDir: string;
  readonly quarantineDir: string;
  readonly sleeper: Sleeper;
}): Promise<RestoreResult> {
  const skipped: string[] = [];
  for (const backup of listBackupFiles(input.backupsDir)) {
    const health = inspectBackupFile(backup.fullPath);
    if (!health.ok) {
      skipped.push(backup.fileName);
      continue;
    }
    await quarantineLiveDatabase(input.stateDbPath, input.quarantineDir, input.sleeper);
    await installDatabaseCopy(backup.fullPath, input.stateDbPath, input.sleeper);
    return {
      backup,
      skippedCorruptBackups: skipped,
      quarantinedPath: input.quarantineDir,
    };
  }
  return { backup: null, skippedCorruptBackups: skipped, quarantinedPath: null };
}

export async function recreateRebuildableDatabase(input: {
  readonly filePath: string;
  readonly schema: SchemaName;
  readonly quarantineDir: string;
  readonly sleeper: Sleeper;
}): Promise<void> {
  if (!isRebuildOnlyDatabase(input.filePath)) {
    throw new RecoveryError(
      "not_rebuildable",
      "Only telemetry.db and code-index.db are recreated instead of restored",
    );
  }
  fs.mkdirSync(input.quarantineDir, { recursive: true });
  if (fs.existsSync(input.filePath)) {
    await moveOptionalFile(
      input.filePath,
      path.join(input.quarantineDir, path.basename(input.filePath)),
      input.sleeper,
    );
    fs.rmSync(`${input.filePath}-wal`, { force: true });
    fs.rmSync(`${input.filePath}-shm`, { force: true });
  }
  const db = createDatabaseFromSchema(input.filePath, readSchema(input.schema));
  closeQuietly(db);
}

function databaseIsCorrupt(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  let db: DatabaseSync | null = null;
  try {
    db = openDatabase(filePath, true);
    return !runPragmaCheck(db, "quick_check").ok;
  } catch {
    return true;
  } finally {
    closeQuietly(db);
  }
}

export class CorruptionRecoveryEngine {
  private readonly project: ProjectStateDb;
  private readonly globalDb: GlobalBrokerDb;
  private readonly backupsDir: string;
  private readonly historyDir: string | null;
  private readonly telemetryDbPath: string | null;
  private readonly codeIndexDbPath: string | null;
  private readonly clock: Clock;
  private readonly sleeper: Sleeper;
  private readonly replay: ReplaySourceAdapter;

  constructor(options: CorruptionRecoveryEngineOptions) {
    this.project = options.project;
    this.globalDb = options.globalDb;
    this.backupsDir =
      options.backupsDir ?? path.join(path.dirname(options.project.filePath), "backups");
    this.historyDir = options.historyDir ?? null;
    this.telemetryDbPath = options.telemetryDbPath ?? null;
    this.codeIndexDbPath = options.codeIndexDbPath ?? null;
    this.clock = options.clock ?? new SystemClock();
    this.sleeper = options.sleeper ?? realSleeper;
    this.replay =
      options.replay ??
      new FilesystemReplaySourceAdapter({
        historyDir: this.historyDir,
        repoDir: options.repoDir ?? null,
      });
  }

  async onProjectOpen(): Promise<RecoveryReport | null> {
    return this.detect("project_open", "quick_check");
  }

  async onDailyIdle(): Promise<RecoveryReport | null> {
    return this.detect("daily_idle", "quick_check");
  }

  async onWeekly(): Promise<RecoveryReport | null> {
    return this.detect("weekly", "integrity_check");
  }

  async onRuntimeError(error: unknown): Promise<RecoveryReport | null> {
    const code = classifySqliteError(error);
    if (!code) return null;
    return this.recover("runtime_error", code);
  }

  async recover(
    schedule: RecoverySchedule = "manual",
    detectedCode: SqliteCorruptCode | null = null,
  ): Promise<RecoveryReport> {
    return withRotationLock(this.backupsDir, async () => {
      const crashDetectedAt = this.clock.now();
      const gaps: UnrecoveredGap[] = [];
      const safeModeNote = this.enterSafeMode(crashDetectedAt, schedule, detectedCode);
      if (safeModeNote) {
        gaps.push({ kind: "other", estimated: false, detail: safeModeNote, window: null });
      }
      const quarantineDir = quarantineDirectory(this.backupsDir, crashDetectedAt);
      const salvagePath = path.join(this.backupsDir, `.salvage-${crashDetectedAt}.db`);
      let outcome: RecoveryOutcome = "manual_salvage";
      let salvageAccepted = false;
      let backupId: string | null = null;
      let backupAt: number | null = null;
      let skipped: readonly string[] = [];
      let quarantinedPath: string | null = null;
      let summary = "Manual salvage / fresh re-init";

      const salvage = fs.existsSync(this.project.filePath)
        ? salvageCorruptDatabase(this.project.filePath, salvagePath)
        : {
            accepted: false,
            outputPath: null,
            failures: [{ name: "readable_content", detail: "state.db is missing" }],
            method: "unavailable" as const,
            detail: "state.db is missing",
          };

      if (salvage.accepted && salvage.outputPath) {
        await quarantineLiveDatabase(this.project.filePath, quarantineDir, this.sleeper);
        await installDatabaseCopy(salvage.outputPath, this.project.filePath, this.sleeper);
        fs.rmSync(salvage.outputPath, { force: true });
        salvageAccepted = true;
        outcome = "salvaged";
        quarantinedPath = quarantineDir;
        summary = "Salvaged readable content and accepted it because every schema invariant passed.";
      } else {
        fs.rmSync(salvagePath, { force: true });
        for (const failure of salvage.failures) {
          gaps.push({
            kind: "other",
            estimated: false,
            detail: `Salvage ${failure.name}: ${failure.detail}`,
            window: null,
          });
        }
        const restored = await restoreNewestGoodBackup({
          stateDbPath: this.project.filePath,
          backupsDir: this.backupsDir,
          quarantineDir,
          sleeper: this.sleeper,
        });
        skipped = restored.skippedCorruptBackups;
        if (restored.backup) {
          outcome = "restored";
          backupId = restored.backup.id;
          backupAt = restored.backup.createdAt;
          quarantinedPath = restored.quarantinedPath;
          summary = `Restored backup ${restored.backup.id} after salvage was rejected.`;
        } else {
          await quarantineLiveDatabase(this.project.filePath, quarantineDir, this.sleeper);
          quarantinedPath = quarantineDir;
          const fresh = createDatabaseFromSchema(this.project.filePath, readSchema("state.sql"));
          writeMeta(fresh, "project_id", this.project.projectId);
          writeMeta(fresh, "last_rev", "0");
          writeMeta(fresh, "stream_epoch", "0");
          closeQuietly(fresh);
          const history = this.replay.loadKnowledgeChangeSets({
            projectId: this.project.projectId,
            afterRev: -1,
            historyDir: this.historyDir,
          });
          if (history.length > 0) {
            outcome = "rehydrated";
            summary = "No healthy backup was available. Rehydrated knowledge from harness-state history.";
          } else {
            outcome = "manual_salvage";
            summary = "Manual salvage / fresh re-init";
          }
        }
      }

      const replaySeed = outcome === "rehydrated" || outcome === "manual_salvage" ? -1 : null;
      let replay: ReplayResult = { changeSets: [], tasks: [], parked: [], gaps: [] };
      let streamEpoch: number | null = null;
      let recoveredRevision: number | null = null;
      const live = openDatabase(this.project.filePath, false);
      try {
        registerSearchText(live);
        const afterRev = replaySeed === null ? (readLastRev(live) ?? 0) : replaySeed;
        replay = replayPostBackupState({
          db: live,
          projectId: this.project.projectId,
          afterRev,
          backupAt,
          backupSha: null,
          historyDir: this.historyDir,
          adapter: this.replay,
        });
        streamEpoch = bumpStreamEpoch(live);
        recoveredRevision = readLastRev(live);
      } finally {
        closeQuietly(live);
      }

      const spendGapEstimated = outcome !== "salvaged";
      const spendGapWindow = spendGapEstimated
        ? { backupAt, crashDetectedAt }
        : null;
      if (spendGapEstimated) {
        gaps.push({
          kind: "spend",
          estimated: true,
          detail:
            "Spend between the backup and the crash is not reconstructed. The report keeps the time window only.",
          window: spendGapWindow,
        });
        gaps.push({
          kind: "turns",
          estimated: true,
          detail:
            "Turns that were not already in the recovered database or history segments stay unrecovered.",
          window: spendGapWindow,
        });
      }
      gaps.push(...replay.gaps);

      let telemetryRebuilt = false;
      let codeIndexRebuilt = false;
      if (this.telemetryDbPath && databaseIsCorrupt(this.telemetryDbPath)) {
        await recreateRebuildableDatabase({
          filePath: this.telemetryDbPath,
          schema: "telemetry.sql",
          quarantineDir,
          sleeper: this.sleeper,
        });
        telemetryRebuilt = true;
      }
      if (this.codeIndexDbPath && databaseIsCorrupt(this.codeIndexDbPath)) {
        await recreateRebuildableDatabase({
          filePath: this.codeIndexDbPath,
          schema: "code-index.sql",
          quarantineDir,
          sleeper: this.sleeper,
        });
        codeIndexRebuilt = true;
      }

      const report: RecoveryReport = {
        projectId: this.project.projectId,
        outcome,
        safeMode: true,
        schedule,
        detectedBy: detectionKind(schedule),
        detectedCode,
        recoveredRevision,
        backupId,
        backupAt,
        crashDetectedAt,
        streamEpoch,
        replayedChangeSets: replay.changeSets,
        tasksQueuedForReverification: replay.tasks,
        parkedAttempts: replay.parked,
        quarantinedPath,
        spendGapEstimated,
        spendGapWindow,
        unrecoveredGaps: gaps,
        telemetryRebuilt,
        codeIndexRebuilt,
        salvageAccepted,
        skippedCorruptBackups: skipped,
        summary,
      };
      return report;
    });
  }

  private async detect(
    schedule: Extract<RecoverySchedule, "project_open" | "daily_idle" | "weekly">,
    pragma: "quick_check" | "integrity_check",
  ): Promise<RecoveryReport | null> {
    if (!fs.existsSync(this.project.filePath)) {
      return this.recover(schedule, "SQLITE_NOTADB");
    }
    let db: DatabaseSync | null = null;
    try {
      db = openDatabase(this.project.filePath, true);
      const check = runPragmaCheck(db, pragma);
      if (check.ok) return null;
      return this.recover(schedule, "SQLITE_CORRUPT");
    } catch (error) {
      return this.recover(schedule, classifySqliteError(error) ?? "SQLITE_CORRUPT");
    } finally {
      closeQuietly(db);
    }
  }

  private enterSafeMode(
    at: number,
    schedule: RecoverySchedule,
    detectedCode: SqliteCorruptCode | null,
  ): string | null {
    const projectDir = path.dirname(this.project.filePath);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "safe-mode.json"),
      `${JSON.stringify(
        {
          safeMode: true,
          projectId: this.project.projectId,
          at,
          schedule,
          detectedCode,
        },
        null,
        2,
      )}\n`,
    );
    let db: DatabaseSync | null = null;
    try {
      db = openDatabase(this.globalDb.filePath, false);
      db.prepare("UPDATE projects SET status = 'needs_repair' WHERE id = ?").run(this.project.projectId);
      writeMeta(
        db,
        `safe_mode:${this.project.projectId}`,
        JSON.stringify({ at, schedule, detectedCode }),
      );
      return null;
    } catch (error) {
      return `Safe mode was recorded locally, but global.db was not updated: ${errorMessage(error)}`;
    } finally {
      closeQuietly(db);
    }
  }
}
