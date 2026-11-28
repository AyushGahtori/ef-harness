import { stepHysteresis, type PendingTarget } from "./hysteresis.js";
import type { DiskVolumeSnapshot } from "./ports/hardware-snapshot.js";
import {
  DISK_EMERGENCY_BYTES,
  DISK_PAUSE_BYTES,
  DISK_WARN_BYTES,
  ENTER_WORSE_MS,
  RECOVER_BETTER_MS,
  formatGbFromBytes,
} from "./thresholds.js";

export const DISK_TIERS = ["OK", "WARN", "PAUSE", "EMERGENCY"] as const;
export type DiskTier = (typeof DISK_TIERS)[number];

export interface DiskDriveView {
  readonly role: "project" | "appData";
  readonly letter: string;
  readonly freeBytes: number;
  readonly tier: DiskTier;
}

export interface DiskMaintenance {
  readonly backgroundCasGc: boolean;
  readonly expiredTempWorktreeCleanup: boolean;
  readonly oldLogCleanup: boolean;
  readonly aggressiveSafeCacheCleanup: boolean;
  readonly pauseNewLaunches: boolean;
  readonly pauseAllRunningWriters: boolean;
  readonly subtleYellowIndicator: boolean;
}

export interface DiskHeadroomView {
  readonly project: DiskDriveView;
  readonly appData: DiskDriveView;
  readonly maintenance: DiskMaintenance;
  readonly cardMessage: string | null;
  readonly cardDriveLetter: string | null;
  readonly resumeOffered: boolean;
  readonly tightestTier: DiskTier;
}

interface DriveState {
  tier: DiskTier;
  pending: PendingTarget<DiskTier> | null;
  letter: string;
  freeBytes: number;
}

function diskRank(tier: DiskTier): number {
  return DISK_TIERS.indexOf(tier);
}

export function diskTierForFreeBytes(freeBytes: number): DiskTier {
  if (freeBytes < DISK_EMERGENCY_BYTES) return "EMERGENCY";
  if (freeBytes < DISK_PAUSE_BYTES) return "PAUSE";
  if (freeBytes < DISK_WARN_BYTES) return "WARN";
  return "OK";
}

function maintenanceFor(project: DiskTier, appData: DiskTier): DiskMaintenance {
  const worst = diskRank(project) >= diskRank(appData) ? project : appData;
  const atLeastWarn = diskRank(worst) >= diskRank("WARN");
  const atLeastPause = diskRank(worst) >= diskRank("PAUSE");
  return {
    backgroundCasGc: atLeastWarn,
    expiredTempWorktreeCleanup: atLeastWarn,
    oldLogCleanup: atLeastWarn,
    aggressiveSafeCacheCleanup: atLeastPause,
    pauseNewLaunches: atLeastPause,
    pauseAllRunningWriters: worst === "EMERGENCY",
    subtleYellowIndicator: atLeastWarn,
  };
}

function cardFor(project: DriveState, appData: DriveState): {
  readonly message: string | null;
  readonly letter: string | null;
} {
  const ranked = [project, appData].sort((left, right) => {
    const byTier = diskRank(right.tier) - diskRank(left.tier);
    if (byTier !== 0) return byTier;
    return left.freeBytes - right.freeBytes;
  });
  const tightest = ranked[0];
  if (!tightest || tightest.tier === "OK" || tightest.tier === "WARN") {
    return { message: null, letter: null };
  }
  if (tightest.tier === "EMERGENCY") {
    return {
      letter: tightest.letter,
      message: `Disk ${tightest.letter} is below 2 GB (${formatGbFromBytes(tightest.freeBytes)} GB free) — writers paused to protect the database`,
    };
  }
  return {
    letter: tightest.letter,
    message: `Low disk space (< 5 GB on ${tightest.letter}) — Free space or clean caches`,
  };
}

/**
 * 15 GB warns and asks for safe GC, 5 GB pauses new launches, 2 GB hard-stops writers.
 * Each drive keeps its own 10 s / 30 s hysteresis. Under 2 GB jumps immediately.
 */
export class DiskHeadroomGuard {
  private project: DriveState = {
    tier: "OK",
    pending: null,
    letter: "",
    freeBytes: Number.POSITIVE_INFINITY,
  };
  private appData: DriveState = {
    tier: "OK",
    pending: null,
    letter: "",
    freeBytes: Number.POSITIVE_INFINITY,
  };
  private resumeOffered = false;

  observe(input: {
    readonly project: DiskVolumeSnapshot;
    readonly appData: DiskVolumeSnapshot;
    readonly nowMs: number;
    readonly instantRecovery?: boolean;
  }): DiskHeadroomView {
    const beforeProject = this.project.tier;
    const beforeApp = this.appData.tier;
    this.project = this.stepDrive(this.project, input.project, input.nowMs, input.instantRecovery === true);
    this.appData = this.stepDrive(this.appData, input.appData, input.nowMs, input.instantRecovery === true);
    this.resumeOffered =
      this.recoveredFromBlock(beforeProject, this.project.tier) ||
      this.recoveredFromBlock(beforeApp, this.appData.tier);
    return this.view();
  }

  recheck(input: {
    readonly project: DiskVolumeSnapshot;
    readonly appData: DiskVolumeSnapshot;
    readonly nowMs: number;
  }): DiskHeadroomView {
    return this.observe({ ...input, instantRecovery: true });
  }

  view(): DiskHeadroomView {
    const project = this.driveView("project", this.project);
    const appData = this.driveView("appData", this.appData);
    const card = cardFor(this.project, this.appData);
    const tightestTier =
      diskRank(this.project.tier) >= diskRank(this.appData.tier) ? this.project.tier : this.appData.tier;
    return {
      project,
      appData,
      maintenance: maintenanceFor(this.project.tier, this.appData.tier),
      cardMessage: card.message,
      cardDriveLetter: card.letter,
      resumeOffered: this.resumeOffered,
      tightestTier,
    };
  }

  private stepDrive(
    state: DriveState,
    volume: DiskVolumeSnapshot,
    nowMs: number,
    instantRecovery: boolean,
  ): DriveState {
    const target = diskTierForFreeBytes(volume.freeBytes);
    const stepped = stepHysteresis({
      level: state.tier,
      pending: state.pending,
      target,
      nowMs,
      rank: diskRank,
      enterMs: ENTER_WORSE_MS,
      recoverMs: RECOVER_BETTER_MS,
      instant: target === "EMERGENCY" && state.tier !== "EMERGENCY",
      instantRecovery,
    });
    return {
      tier: stepped.level,
      pending: stepped.pending,
      letter: volume.letter,
      freeBytes: volume.freeBytes,
    };
  }

  private driveView(role: "project" | "appData", state: DriveState): DiskDriveView {
    return {
      role,
      letter: state.letter,
      freeBytes: state.freeBytes,
      tier: state.tier,
    };
  }

  private recoveredFromBlock(before: DiskTier, after: DiskTier): boolean {
    return diskRank(before) >= diskRank("PAUSE") && diskRank(after) < diskRank(before);
  }
}
