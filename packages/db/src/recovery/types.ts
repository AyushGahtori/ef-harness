/**
 * Structural stand-in for the Task 013 project database handle.
 * Task 013 owns the concrete class; recovery only needs the file and project id.
 */
export interface ProjectStateDb {
  readonly projectId: string;
  readonly filePath: string;
}

/**
 * Structural stand-in for the Task 014 global broker database.
 * CAS pins are written here and are never part of the project transaction.
 */
export interface GlobalBrokerDb {
  readonly filePath: string;
}

export type BackupCadence = "hourly" | "daily" | "pre-migration";

export type RecoveryOutcome = "salvaged" | "restored" | "rehydrated" | "manual_salvage";

export type DetectionKind = "quick_check" | "integrity_check" | "runtime_error" | "manual";

export type RecoverySchedule =
  | "project_open"
  | "daily_idle"
  | "weekly"
  | "runtime_error"
  | "manual";

export type SqliteCorruptCode = "SQLITE_CORRUPT" | "SQLITE_NOTADB";

export interface SpendGapWindow {
  readonly backupAt: number | null;
  readonly crashDetectedAt: number;
}

export interface UnrecoveredGap {
  readonly kind: "spend" | "knowledge" | "turns" | "git" | "other";
  readonly estimated: boolean;
  readonly detail: string;
  readonly window: SpendGapWindow | null;
}

export interface ReplayedChangeSet {
  readonly changeSetId: string;
  readonly rev: number;
  readonly applied: boolean;
  readonly detail: string;
}

export interface ReverificationTask {
  readonly taskId: string;
  readonly checks: readonly string[];
  readonly commitSha: string;
  readonly attemptId: string | null;
  readonly feature: string | null;
}

export interface ParkedAttempt {
  readonly taskId: string;
  readonly attemptId: string;
  readonly checkpointRef: string;
  readonly sha: string;
}

export interface RecoveryReport {
  readonly projectId: string;
  readonly outcome: RecoveryOutcome;
  readonly safeMode: true;
  readonly schedule: RecoverySchedule;
  readonly detectedBy: DetectionKind;
  readonly detectedCode: SqliteCorruptCode | null;
  readonly recoveredRevision: number | null;
  readonly backupId: string | null;
  readonly backupAt: number | null;
  readonly crashDetectedAt: number;
  readonly streamEpoch: number | null;
  readonly replayedChangeSets: readonly ReplayedChangeSet[];
  readonly tasksQueuedForReverification: readonly ReverificationTask[];
  readonly parkedAttempts: readonly ParkedAttempt[];
  readonly quarantinedPath: string | null;
  readonly spendGapEstimated: boolean;
  readonly spendGapWindow: SpendGapWindow | null;
  readonly unrecoveredGaps: readonly UnrecoveredGap[];
  readonly telemetryRebuilt: boolean;
  readonly codeIndexRebuilt: boolean;
  readonly salvageAccepted: boolean;
  readonly skippedCorruptBackups: readonly string[];
  readonly summary: string;
}

export interface InvariantFailure {
  readonly name: string;
  readonly detail: string;
}

export interface InvariantReport {
  readonly ok: boolean;
  readonly failures: readonly InvariantFailure[];
}

export class RecoveryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RecoveryError";
    this.code = code;
  }
}

export interface BackupFileInfo {
  readonly id: string;
  readonly fileName: string;
  readonly fullPath: string;
  readonly cadence: BackupCadence;
  readonly createdAt: number;
  readonly tag: string | null;
}

export interface WrittenBackup {
  readonly status: "written";
  readonly id: string;
  readonly path: string;
  readonly cadence: BackupCadence;
  readonly createdAt: number;
  readonly holderId: string;
  readonly lastRev: number | null;
  readonly pinnedHashes: readonly string[];
}

export interface SkippedBackup {
  readonly status: "skipped";
  readonly cadence: BackupCadence;
  readonly reason: "idle" | "not_due";
}

export type BackupWriteResult = WrittenBackup | SkippedBackup;
