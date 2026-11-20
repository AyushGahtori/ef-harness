import fs from "node:fs";
import path from "node:path";
import {
  DAY_MS,
  HOUR_MS,
  SystemClock,
  realSleeper,
  type Clock,
  type Sleeper,
} from "./clock.js";
import { withRotationLock } from "./lock.js";
import { renameWithRetry } from "./rename.js";
import {
  activityFingerprint,
  asText,
  closeQuietly,
  errorMessage,
  foreignKeyViolations,
  listArtifactHashes,
  openDatabase,
  projectHasWork,
  readLastRev,
  runPragmaCheck,
  sqlStringLiteral,
} from "./sqlite-io.js";
import {
  RecoveryError,
  type BackupCadence,
  type BackupFileInfo,
  type BackupWriteResult,
  type GlobalBrokerDb,
  type ProjectStateDb,
  type WrittenBackup,
} from "./types.js";

const RETENTION: Record<BackupCadence, number | null> = {
  hourly: 24,
  daily: 7,
  "pre-migration": null,
};

const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HOURLY_PATTERN = /^hourly-(\d{16})-(\d+)\.db$/;
const DAILY_PATTERN = /^daily-(\d{16})-(\d+)\.db$/;
const PRE_PATTERN = /^pre-migration-([A-Za-z0-9][A-Za-z0-9._-]{0,63})-(\d{16})-(\d+)\.db$/;

export interface BackupExposeInfo {
  readonly holderId: string;
  readonly tempPath: string;
  readonly finalPath: string;
  readonly hashes: readonly string[];
}

export interface BackupSchedulerOptions {
  readonly project: ProjectStateDb;
  readonly globalDb: GlobalBrokerDb;
  readonly backupsDir?: string;
  readonly clock?: Clock;
  readonly sleeper?: Sleeper;
  readonly afterPinsBeforeExpose?: (info: BackupExposeInfo) => void;
}

interface SchedulerState {
  seq: number;
  lastHourlyAt: number | null;
  lastDailyAt: number | null;
  lastHourlyFingerprint: string | null;
}

export function isRebuildOnlyDatabase(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return base === "telemetry.db" || base === "code-index.db";
}

export function backupHolderId(projectId: string, backupId: string): string {
  return `${projectId}-backup-${backupId}`;
}

export function assertBackupAllowed(filePath: string): void {
  if (isRebuildOnlyDatabase(filePath)) {
    throw new RecoveryError(
      "backup_not_applicable",
      "telemetry.db and code-index.db are rebuilt on corruption and are excluded from backup rotation",
    );
  }
}

function emptyState(): SchedulerState {
  return {
    seq: 0,
    lastHourlyAt: null,
    lastDailyAt: null,
    lastHourlyFingerprint: null,
  };
}

function statePath(backupsDir: string): string {
  return path.join(backupsDir, ".scheduler-state.json");
}

function readState(backupsDir: string): SchedulerState {
  const file = statePath(backupsDir);
  if (!fs.existsSync(file)) return emptyState();
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null) return emptyState();
  const record = parsed as Record<string, unknown>;
  return {
    seq: typeof record.seq === "number" && record.seq >= 0 ? record.seq : 0,
    lastHourlyAt: typeof record.lastHourlyAt === "number" ? record.lastHourlyAt : null,
    lastDailyAt: typeof record.lastDailyAt === "number" ? record.lastDailyAt : null,
    lastHourlyFingerprint:
      typeof record.lastHourlyFingerprint === "string" ? record.lastHourlyFingerprint : null,
  };
}

function writeState(backupsDir: string, state: SchedulerState): void {
  fs.mkdirSync(backupsDir, { recursive: true });
  fs.writeFileSync(statePath(backupsDir), `${JSON.stringify(state, null, 2)}\n`);
}

export function parseBackupFile(backupsDir: string, fileName: string): BackupFileInfo | null {
  const hourly = HOURLY_PATTERN.exec(fileName);
  if (hourly?.[1] && hourly[2]) {
    return {
      id: fileName.slice(0, -3),
      fileName,
      fullPath: path.join(backupsDir, fileName),
      cadence: "hourly",
      createdAt: Number(hourly[1]),
      tag: null,
      seq: Number(hourly[2]),
    } as BackupFileInfo & { seq: number };
  }
  const daily = DAILY_PATTERN.exec(fileName);
  if (daily?.[1] && daily[2]) {
    return stamp(backupsDir, fileName, "daily", Number(daily[1]), null, Number(daily[2]));
  }
  const pre = PRE_PATTERN.exec(fileName);
  if (pre?.[1] && pre[2] && pre[3]) {
    return stamp(backupsDir, fileName, "pre-migration", Number(pre[2]), pre[1], Number(pre[3]));
  }
  return null;
}

function stamp(
  backupsDir: string,
  fileName: string,
  cadence: BackupCadence,
  createdAt: number,
  tag: string | null,
  seq: number,
): BackupFileInfo & { seq: number } {
  return {
    id: fileName.slice(0, -3),
    fileName,
    fullPath: path.join(backupsDir, fileName),
    cadence,
    createdAt,
    tag,
    seq,
  };
}

export function listBackupFiles(backupsDir: string): Array<BackupFileInfo & { seq: number }> {
  if (!fs.existsSync(backupsDir)) return [];
  const files: Array<BackupFileInfo & { seq: number }> = [];
  for (const name of fs.readdirSync(backupsDir)) {
    const parsed = parseBackupFile(backupsDir, name);
    if (!parsed) continue;
    files.push(parsed as BackupFileInfo & { seq: number });
  }
  files.sort((left, right) => right.createdAt - left.createdAt || right.seq - left.seq);
  return files;
}

export function inspectBackupFile(filePath: string): { ok: boolean; reason: string | null } {
  let db: ReturnType<typeof openDatabase> | null = null;
  try {
    db = openDatabase(filePath, true);
    const quick = runPragmaCheck(db, "quick_check");
    if (!quick.ok) {
      return { ok: false, reason: quick.messages.join("; ") || "quick_check failed" };
    }
    const foreignKeys = foreignKeyViolations(db);
    if (foreignKeys.length > 0) {
      return { ok: false, reason: foreignKeys.join("; ") };
    }
    return { ok: true, reason: null };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  } finally {
    closeQuietly(db);
  }
}

function vacuumInto(stateDbPath: string, tempPath: string): void {
  fs.rmSync(tempPath, { force: true });
  const db = openDatabase(stateDbPath, false);
  try {
    const target = tempPath.replaceAll("\\", "/");
    db.exec(`VACUUM INTO ${sqlStringLiteral(target)}`);
  } finally {
    closeQuietly(db);
  }
}

function withGlobal<T>(globalDbPath: string, fn: (db: ReturnType<typeof openDatabase>) => T): T {
  const db = openDatabase(globalDbPath, false);
  try {
    return fn(db);
  } finally {
    closeQuietly(db);
  }
}

function replaceBackupPins(
  globalDbPath: string,
  holderId: string,
  hashes: readonly string[],
  pinnedAt: number,
): void {
  withGlobal(globalDbPath, (db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM cas_pins WHERE holder_kind = 'backup' AND holder_id = ?").run(holderId);
      const insert = db.prepare(
        "INSERT INTO cas_pins(hash, holder_kind, holder_id, pinned_at) VALUES (?, 'backup', ?, ?)",
      );
      for (const hash of hashes) insert.run(hash, holderId, pinnedAt);
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  });
}

export function removeBackupPins(globalDbPath: string, holderId: string): void {
  withGlobal(globalDbPath, (db) => {
    db.prepare("DELETE FROM cas_pins WHERE holder_kind = 'backup' AND holder_id = ?").run(holderId);
  });
}

export function listBackupPins(
  globalDbPath: string,
  holderId: string,
): readonly string[] {
  return withGlobal(globalDbPath, (db) =>
    db
      .prepare(
        "SELECT hash FROM cas_pins WHERE holder_kind = 'backup' AND holder_id = ? ORDER BY hash",
      )
      .all(holderId)
      .map((row) => asText(row.hash))
      .filter((hash): hash is string => hash !== null),
  );
}

function clearStaleTemps(backupsDir: string): void {
  if (!fs.existsSync(backupsDir)) return;
  for (const name of fs.readdirSync(backupsDir)) {
    if (name.endsWith(".tmp.db")) fs.rmSync(path.join(backupsDir, name), { force: true });
  }
}

async function removeFileWithRetry(filePath: string, sleeper: Sleeper): Promise<void> {
  const delays = [50, 100, 200, 400, 800, 1000, 1000, 1000, 1000, 1000];
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(filePath, { force: true });
      return;
    } catch (error) {
      lastError = error;
      const code =
        typeof error === "object" && error !== null
          ? (error as { code?: string }).code
          : undefined;
      if ((code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") || attempt === 9) break;
      await sleeper.sleep(delays[attempt] ?? 1000);
    }
  }
  throw new RecoveryError(
    "backup_delete_failed",
    `Failed to delete rotated backup ${filePath}: ${errorMessage(lastError)}`,
  );
}

export class BackupScheduler {
  private readonly project: ProjectStateDb;
  private readonly globalDb: GlobalBrokerDb;
  private readonly backupsDir: string;
  private readonly clock: Clock;
  private readonly sleeper: Sleeper;
  private readonly afterPinsBeforeExpose: ((info: BackupExposeInfo) => void) | null;

  constructor(options: BackupSchedulerOptions) {
    this.project = options.project;
    this.globalDb = options.globalDb;
    this.backupsDir = options.backupsDir ?? path.join(path.dirname(options.project.filePath), "backups");
    this.clock = options.clock ?? new SystemClock();
    this.sleeper = options.sleeper ?? realSleeper;
    this.afterPinsBeforeExpose = options.afterPinsBeforeExpose ?? null;
  }

  async backupHourly(): Promise<BackupWriteResult> {
    assertBackupAllowed(this.project.filePath);
    return withRotationLock(this.backupsDir, async () => {
      const now = this.clock.now();
      const state = readState(this.backupsDir);
      if (state.lastHourlyAt !== null && now - state.lastHourlyAt < HOUR_MS) {
        return { status: "skipped", cadence: "hourly", reason: "not_due" };
      }
      const live = openDatabase(this.project.filePath, true);
      let fingerprint: string;
      let active: boolean;
      try {
        fingerprint = activityFingerprint(live);
        active = projectHasWork(live);
      } finally {
        closeQuietly(live);
      }
      const unchanged = fingerprint === state.lastHourlyFingerprint;
      if (unchanged || (state.lastHourlyFingerprint === null && !active)) {
        return { status: "skipped", cadence: "hourly", reason: "idle" };
      }
      const written = await this.writeBackup("hourly", null, state, fingerprint);
      return written;
    });
  }

  async backupDaily(): Promise<BackupWriteResult> {
    assertBackupAllowed(this.project.filePath);
    return withRotationLock(this.backupsDir, async () => {
      const now = this.clock.now();
      const state = readState(this.backupsDir);
      if (state.lastDailyAt !== null && now - state.lastDailyAt < DAY_MS) {
        return { status: "skipped", cadence: "daily", reason: "not_due" };
      }
      return this.writeBackup("daily", null, state, null);
    });
  }

  async backupPreMigration(tag: string): Promise<WrittenBackup> {
    assertBackupAllowed(this.project.filePath);
    if (!TAG_PATTERN.test(tag)) {
      throw new RecoveryError(
        "invalid_backup_tag",
        "Pre-migration backup tags must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}",
      );
    }
    return withRotationLock(this.backupsDir, async () => {
      const state = readState(this.backupsDir);
      return this.writeBackup("pre-migration", tag, state, null);
    });
  }

  private async writeBackup(
    cadence: BackupCadence,
    tag: string | null,
    state: SchedulerState,
    hourlyFingerprint: string | null,
  ): Promise<WrittenBackup> {
    fs.mkdirSync(this.backupsDir, { recursive: true });
    clearStaleTemps(this.backupsDir);
    const createdAt = this.clock.now();
    const seq = state.seq + 1;
    const suffix = String(seq).padStart(4, "0");
    const stampText = String(createdAt).padStart(16, "0");
    const fileName =
      cadence === "pre-migration"
        ? `pre-migration-${tag}-${stampText}-${suffix}.db`
        : `${cadence}-${stampText}-${suffix}.db`;
    const finalPath = path.join(this.backupsDir, fileName);
    const tempPath = path.join(this.backupsDir, `${fileName.slice(0, -3)}.tmp.db`);
    const id = fileName.slice(0, -3);
    const holderId = backupHolderId(this.project.projectId, id);
    try {
      vacuumInto(this.project.filePath, tempPath);
      const inspected = inspectBackupFile(tempPath);
      if (!inspected.ok) {
        throw new RecoveryError(
          "backup_quick_check_failed",
          inspected.reason ?? "Temporary backup failed PRAGMA quick_check",
        );
      }
      const temp = openDatabase(tempPath, true);
      let hashes: string[];
      let lastRev: number | null;
      try {
        hashes = listArtifactHashes(temp);
        lastRev = readLastRev(temp);
      } finally {
        closeQuietly(temp);
      }
      replaceBackupPins(this.globalDb.filePath, holderId, hashes, createdAt);
      try {
        this.afterPinsBeforeExpose?.({
          holderId,
          tempPath,
          finalPath,
          hashes,
        });
      } catch (error) {
        removeBackupPins(this.globalDb.filePath, holderId);
        throw error;
      }
      try {
        await renameWithRetry(tempPath, finalPath, this.sleeper);
      } catch (error) {
        removeBackupPins(this.globalDb.filePath, holderId);
        throw error;
      }
      await this.rotate(cadence);
      const next: SchedulerState = {
        seq,
        lastHourlyAt: cadence === "hourly" ? createdAt : state.lastHourlyAt,
        lastDailyAt: cadence === "daily" ? createdAt : state.lastDailyAt,
        lastHourlyFingerprint:
          cadence === "hourly" ? hourlyFingerprint : state.lastHourlyFingerprint,
      };
      writeState(this.backupsDir, next);
      return {
        status: "written",
        id,
        path: finalPath,
        cadence,
        createdAt,
        holderId,
        lastRev,
        pinnedHashes: hashes,
      };
    } finally {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
    }
  }

  private async rotate(cadence: BackupCadence): Promise<void> {
    const keep = RETENTION[cadence];
    if (keep === null) return;
    const extras = listBackupFiles(this.backupsDir)
      .filter((file) => file.cadence === cadence)
      .slice(keep);
    for (const file of extras) {
      await removeFileWithRetry(file.fullPath, this.sleeper);
      removeBackupPins(this.globalDb.filePath, backupHolderId(this.project.projectId, file.id));
    }
  }
}
