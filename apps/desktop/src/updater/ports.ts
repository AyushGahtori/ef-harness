export type HeadroomLevel = "GREEN" | "YELLOW" | "ORANGE" | "RED";

export interface UpdateDescriptor {
  readonly version: string;
}

/**
 * Local port for `electron-updater`.
 * `@ef-harness/desktop` cannot take a new dependency until package.json wiring is approved.
 */
export interface ElectronUpdaterPort {
  downloadUpdate(): Promise<UpdateDescriptor>;
  quitAndInstall(): void;
}

/** Local port for Task 114 / Task 128 worker parking. */
export interface WorkerParkPort {
  activeBuildVerificationOrMergeCount(): number;
  pauseAndCheckpointAllWorkers(): Promise<readonly string[]>;
}

/** Local port for Task 131 `DaemonShutdownCoordinator`. */
export interface DaemonShutdownCoordinatorPort {
  flushSqliteWal(): Promise<void>;
  teardownJobObjects(): Promise<void>;
}

/** Local port for the Task 016 verified pre-upgrade snapshot. */
export interface PreUpgradeBackupPort {
  createVerifiedStateDbSnapshot(): Promise<{ verified: boolean; snapshotPath: string }>;
}

/** Local port for Task 118 network and disk headroom during a quiet download. */
export interface UpdateResourceHeadroomPort {
  networkLevel(): HeadroomLevel;
  diskLevel(): HeadroomLevel;
}

export interface AutoUpdateSettings {
  manualUpdatesOnly: boolean;
}

export interface StateDbBackupSnapshot {
  readonly verified: boolean;
  readonly snapshotPath: string;
}

/** Local port for Task 015 `MigrationAndRebuildEngine`. */
export interface MigrationAndRebuildEnginePort {
  createVerifiedBackup(): Promise<StateDbBackupSnapshot>;
  runBackupProtectedTransaction<T>(work: () => Promise<T> | T): Promise<T>;
}

export interface CheckpointStorePort {
  write(record: CheckpointRecord): void;
}

export interface CheckpointRecord {
  readonly id: string;
  readonly kind: string;
  readonly schemaVersion: number;
  readonly taskId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly integrationRef: string;
  readonly resumeDisposition: "resume" | "fresh_retry";
}
