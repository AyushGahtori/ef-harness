import { BackupNotVerifiedError, UncheckpointedWorkError, UpdateNotReadyError } from "./errors.js";
import type {
  AutoUpdateSettings,
  DaemonShutdownCoordinatorPort,
  ElectronUpdaterPort,
  PreUpgradeBackupPort,
  UpdateResourceHeadroomPort,
  WorkerParkPort,
} from "./ports.js";

export const UPDATE_AND_RESTART_LABEL = "Update & Restart";

export interface UpdatePill {
  readonly visible: boolean;
  readonly text: string;
}

export function updateReadyPillText(version: string): string {
  const label = version.startsWith("v") ? version : `v${version}`;
  return `Update ${label} ready — Restart when convenient`;
}

export interface ParkFirstAutoUpdaterDependencies {
  updater: ElectronUpdaterPort;
  work: WorkerParkPort;
  shutdown: DaemonShutdownCoordinatorPort;
  backup: PreUpgradeBackupPort;
  headroom: UpdateResourceHeadroomPort;
  settings: AutoUpdateSettings;
}

/**
 * Downloads quietly and installs only after every active build is checkpointed.
 * `quitAndInstall` is never called from the download path.
 */
export class ParkFirstAutoUpdater {
  private readyVersion: string | null = null;

  constructor(private readonly deps: ParkFirstAutoUpdaterDependencies) {}

  pill(): UpdatePill {
    if (this.readyVersion === null) return { visible: false, text: "" };
    return { visible: true, text: updateReadyPillText(this.readyVersion) };
  }

  async downloadQuietly(): Promise<UpdatePill> {
    if (this.deps.settings.manualUpdatesOnly) return this.pill();
    if (this.deps.headroom.networkLevel() !== "GREEN" || this.deps.headroom.diskLevel() !== "GREEN") {
      return this.pill();
    }
    const update = await this.deps.updater.downloadUpdate();
    this.readyVersion = update.version;
    return this.pill();
  }

  /** Handles the "Update & Restart" action. */
  async requestUpdateAndRestart(): Promise<{ installed: true }> {
    if (this.readyVersion === null) throw new UpdateNotReadyError();
    const active = this.deps.work.activeBuildVerificationOrMergeCount();
    if (!Number.isSafeInteger(active) || active < 0) {
      throw new UncheckpointedWorkError(0, 0);
    }
    if (active > 0) {
      const checkpoints = await this.deps.work.pauseAndCheckpointAllWorkers();
      if (checkpoints.length < active) {
        throw new UncheckpointedWorkError(active, checkpoints.length);
      }
    }
    await this.deps.shutdown.flushSqliteWal();
    await this.deps.shutdown.teardownJobObjects();
    const snapshot = await this.deps.backup.createVerifiedStateDbSnapshot();
    if (!snapshot.verified) throw new BackupNotVerifiedError(snapshot.snapshotPath);
    this.deps.updater.quitAndInstall();
    return { installed: true };
  }
}
