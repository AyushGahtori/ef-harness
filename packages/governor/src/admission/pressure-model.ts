import type { HardwareSnapshot } from "./ports/hardware-snapshot.js";
import {
  COMMIT_RECOVER_RATIO,
  COMMIT_RED_RATIO,
  DEFENDER_CONTENTION_RATIO,
  DISK_EMERGENCY_BYTES,
  DISK_PAUSE_BYTES,
  RAM_GREEN_FREE_RATIO,
  RAM_ORANGE_FREE_RATIO,
  RAM_RED_FREE_RATIO,
  RAM_YELLOW_FREE_RATIO,
  UI_LATENCY_ORANGE_MS,
  UI_LATENCY_YELLOW_MS,
  formatGbFromBytes,
  formatGbFromMb,
} from "./thresholds.js";
import { pressureRank, type PressureLevel } from "./types.js";

export interface PressureSignals {
  readonly freeRatio: number;
  readonly availRamMb: number;
  readonly totalRamMb: number;
  readonly commitUsedRatio: number;
  readonly lowMemoryNotification: boolean;
  readonly defenderPressure: boolean;
  readonly uiLatencyMs: number;
  readonly tightestDiskFreeBytes: number;
  readonly tightestDiskLetter: string;
  readonly projectDiskLetter: string;
  readonly projectDiskFreeBytes: number;
  readonly appDataDiskLetter: string;
  readonly appDataDiskFreeBytes: number;
  readonly gpuAvailable: boolean;
  readonly vramBudgetMb: number;
  readonly vramUsedMb: number;
}

export interface PressureActions {
  readonly level: PressureLevel;
  readonly warmExecutionSlotCap: number;
  readonly officeAnimationsEnabled: boolean;
  readonly backgroundIndexingEnabled: boolean;
  readonly deferBackgroundIndexing: boolean;
  readonly deferBackgroundGc: boolean;
  readonly deferNonCriticalPrewarm: boolean;
  readonly pauseBackgroundTasks: boolean;
  readonly waitBeforeHeavyJobs: boolean;
  readonly haltNewExecutionLaunches: boolean;
  readonly pauseNonEssentialLocalModels: boolean;
  readonly preserveDbAndWorktreeIntegrity: boolean;
  readonly showHardwarePressureCard: boolean;
  readonly officeToBoardFallback: boolean;
}

export interface HardwarePressureCard {
  readonly headline: string;
  readonly ram: string;
  readonly disk: string;
  readonly gpu: string;
}

function finiteRatio(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return part / whole;
}

export function signalsFromSnapshot(snapshot: HardwareSnapshot): PressureSignals {
  const projectFree = snapshot.projectDisk.freeBytes;
  const appFree = snapshot.appDataDisk.freeBytes;
  const tightest =
    appFree < projectFree
      ? snapshot.appDataDisk
      : projectFree < appFree
        ? snapshot.projectDisk
        : snapshot.appDataDisk;
  const uiLatencyMs = snapshot.uiSampleValid ? snapshot.uiLatencyMs : 0;
  return {
    freeRatio: finiteRatio(snapshot.availPhysMb, snapshot.totalPhysMb),
    availRamMb: snapshot.availPhysMb,
    totalRamMb: snapshot.totalPhysMb,
    commitUsedRatio: finiteRatio(
      snapshot.totalCommitMb - snapshot.availCommitMb,
      snapshot.totalCommitMb,
    ),
    lowMemoryNotification: snapshot.lowMemoryNotification,
    defenderPressure:
      snapshot.avContentionActive || snapshot.defenderCpuRatio > DEFENDER_CONTENTION_RATIO,
    uiLatencyMs,
    tightestDiskFreeBytes: tightest.freeBytes,
    tightestDiskLetter: tightest.letter,
    projectDiskLetter: snapshot.projectDisk.letter,
    projectDiskFreeBytes: projectFree,
    appDataDiskLetter: snapshot.appDataDisk.letter,
    appDataDiskFreeBytes: appFree,
    gpuAvailable: snapshot.gpuAvailable,
    vramBudgetMb: snapshot.vramBudgetMb,
    vramUsedMb: snapshot.vramUsedMb,
  };
}

/** Level a fresh machine would enter. The 15–25% band stays GREEN here. */
export function enteredLevel(signals: PressureSignals): PressureLevel {
  if (
    signals.lowMemoryNotification ||
    signals.tightestDiskFreeBytes < DISK_EMERGENCY_BYTES
  ) {
    return "RED";
  }
  if (signals.freeRatio < RAM_RED_FREE_RATIO || signals.commitUsedRatio > COMMIT_RED_RATIO) {
    return "RED";
  }
  if (
    signals.freeRatio < RAM_ORANGE_FREE_RATIO ||
    signals.tightestDiskFreeBytes < DISK_PAUSE_BYTES ||
    signals.uiLatencyMs > UI_LATENCY_ORANGE_MS
  ) {
    return "ORANGE";
  }
  if (
    signals.freeRatio < RAM_YELLOW_FREE_RATIO ||
    signals.defenderPressure ||
    signals.uiLatencyMs > UI_LATENCY_YELLOW_MS
  ) {
    return "YELLOW";
  }
  return "GREEN";
}

/**
 * Worsening uses enter thresholds. Recovery stays put until headroom clears
 * the lower margin: leave RED at >= 8% and commit <= 90%, leave ORANGE at
 * >= 15% free, leave YELLOW only above 25% free.
 */
export function desiredLevel(current: PressureLevel, signals: PressureSignals): PressureLevel {
  const entered = enteredLevel(signals);
  if (pressureRank(entered) >= pressureRank(current)) return entered;

  if (current === "RED") {
    const diskCleared = signals.tightestDiskFreeBytes >= DISK_PAUSE_BYTES;
    const memoryCleared =
      signals.freeRatio >= RAM_ORANGE_FREE_RATIO &&
      signals.commitUsedRatio <= COMMIT_RECOVER_RATIO &&
      !signals.lowMemoryNotification;
    if (!diskCleared || !memoryCleared) return "RED";
  }

  if (pressureRank(current) >= pressureRank("ORANGE")) {
    const orangeCleared =
      signals.freeRatio >= RAM_YELLOW_FREE_RATIO &&
      signals.uiLatencyMs <= UI_LATENCY_YELLOW_MS &&
      signals.tightestDiskFreeBytes >= DISK_PAUSE_BYTES &&
      !signals.lowMemoryNotification;
    if (!orangeCleared) return "ORANGE";
  }

  if (pressureRank(current) >= pressureRank("YELLOW")) {
    const yellowCleared =
      signals.freeRatio > RAM_GREEN_FREE_RATIO &&
      !signals.defenderPressure &&
      signals.uiLatencyMs <= UI_LATENCY_YELLOW_MS;
    if (!yellowCleared) return "YELLOW";
  }

  return entered;
}

export function isEmergency(signals: PressureSignals): boolean {
  return (
    signals.lowMemoryNotification || signals.tightestDiskFreeBytes < DISK_EMERGENCY_BYTES
  );
}

export function activeDrivers(signals: PressureSignals): readonly string[] {
  const drivers: string[] = [];
  const letter = signals.tightestDiskLetter;
  if (signals.lowMemoryNotification) drivers.push("Windows low-memory notification");
  if (signals.tightestDiskFreeBytes < DISK_EMERGENCY_BYTES) {
    drivers.push(`Disk ${letter} < 2 GB`);
  }
  if (signals.commitUsedRatio > COMMIT_RED_RATIO) drivers.push("Commit charge > 95%");
  if (signals.freeRatio < RAM_RED_FREE_RATIO || signals.freeRatio < RAM_ORANGE_FREE_RATIO) {
    drivers.push(ramDriver(signals));
  } else if (signals.freeRatio < RAM_YELLOW_FREE_RATIO) {
    drivers.push(ramDriver(signals));
  }
  if (
    signals.tightestDiskFreeBytes >= DISK_EMERGENCY_BYTES &&
    signals.tightestDiskFreeBytes < DISK_PAUSE_BYTES
  ) {
    drivers.push(`Disk ${letter} < 5 GB`);
  }
  if (signals.uiLatencyMs > UI_LATENCY_YELLOW_MS) drivers.push("UI latency > 50 ms");
  if (signals.defenderPressure) drivers.push("Windows Defender scanning");
  return drivers;
}

function ramDriver(signals: PressureSignals): string {
  return `RAM low (${formatGbFromMb(signals.availRamMb)} GB free)`;
}

export function primaryDriver(signals: PressureSignals, recovering: boolean): string {
  if (recovering) return "Headroom recovered";
  return activeDrivers(signals)[0] ?? "Headroom recovered";
}

export function actionsFor(level: PressureLevel, baseWarmSlots: number): PressureActions {
  const base = Math.max(1, Math.floor(baseWarmSlots));
  if (level === "GREEN") {
    return {
      level,
      warmExecutionSlotCap: base,
      officeAnimationsEnabled: true,
      backgroundIndexingEnabled: true,
      deferBackgroundIndexing: false,
      deferBackgroundGc: false,
      deferNonCriticalPrewarm: false,
      pauseBackgroundTasks: false,
      waitBeforeHeavyJobs: false,
      haltNewExecutionLaunches: false,
      pauseNonEssentialLocalModels: false,
      preserveDbAndWorktreeIntegrity: true,
      showHardwarePressureCard: false,
      officeToBoardFallback: false,
    };
  }
  if (level === "YELLOW") {
    return {
      level,
      warmExecutionSlotCap: Math.max(1, base - 1),
      officeAnimationsEnabled: true,
      backgroundIndexingEnabled: false,
      deferBackgroundIndexing: true,
      deferBackgroundGc: true,
      deferNonCriticalPrewarm: true,
      pauseBackgroundTasks: false,
      waitBeforeHeavyJobs: false,
      haltNewExecutionLaunches: false,
      pauseNonEssentialLocalModels: false,
      preserveDbAndWorktreeIntegrity: true,
      showHardwarePressureCard: false,
      officeToBoardFallback: false,
    };
  }
  if (level === "ORANGE") {
    return {
      level,
      warmExecutionSlotCap: 1,
      officeAnimationsEnabled: false,
      backgroundIndexingEnabled: false,
      deferBackgroundIndexing: true,
      deferBackgroundGc: true,
      deferNonCriticalPrewarm: true,
      pauseBackgroundTasks: true,
      waitBeforeHeavyJobs: true,
      haltNewExecutionLaunches: false,
      pauseNonEssentialLocalModels: false,
      preserveDbAndWorktreeIntegrity: true,
      showHardwarePressureCard: false,
      officeToBoardFallback: true,
    };
  }
  return {
    level: "RED",
    warmExecutionSlotCap: 0,
    officeAnimationsEnabled: false,
    backgroundIndexingEnabled: false,
    deferBackgroundIndexing: true,
    deferBackgroundGc: true,
    deferNonCriticalPrewarm: true,
    pauseBackgroundTasks: true,
    waitBeforeHeavyJobs: true,
    haltNewExecutionLaunches: true,
    pauseNonEssentialLocalModels: true,
    preserveDbAndWorktreeIntegrity: true,
    showHardwarePressureCard: true,
    officeToBoardFallback: true,
  };
}

export function hardwarePressureCard(
  signals: PressureSignals,
  headline: string,
): HardwarePressureCard {
  const disk =
    signals.projectDiskLetter === signals.appDataDiskLetter
      ? `${signals.projectDiskLetter} ${formatGbFromBytes(signals.projectDiskFreeBytes)} GB free`
      : `${signals.appDataDiskLetter} ${formatGbFromBytes(signals.appDataDiskFreeBytes)} GB free, ${signals.projectDiskLetter} ${formatGbFromBytes(signals.projectDiskFreeBytes)} GB free`;
  const gpu = signals.gpuAvailable
    ? `${formatGbFromMb(signals.vramUsedMb)} GB used of ${formatGbFromMb(signals.vramBudgetMb)} GB VRAM`
    : "No discrete GPU";
  return {
    headline,
    ram: `${formatGbFromMb(signals.availRamMb)} GB free of ${formatGbFromMb(signals.totalRamMb)} GB`,
    disk,
    gpu,
  };
}
