/**
 * Local port of Task 117 `HardwareSnapshot` / `ResourceTelemetryProvider`.
 * Task 117 owns `packages/governor/src/telemetry/**` and is not on this base.
 */
export interface DiskVolumeSnapshot {
  readonly letter: string;
  readonly freeBytes: number;
  readonly totalBytes: number;
}

export interface HardwareSnapshot {
  readonly sampledAtMs: number;
  readonly totalPhysMb: number;
  readonly availPhysMb: number;
  readonly totalCommitMb: number;
  readonly availCommitMb: number;
  readonly lowMemoryNotification: boolean;
  readonly cpuCoreCount: number;
  readonly cpuLoadRatio: number;
  readonly defenderCpuRatio: number;
  readonly avContentionActive: boolean;
  readonly uiLatencyMs: number;
  readonly uiSampleValid: boolean;
  readonly gpuAvailable: boolean;
  readonly gpuClass: "discrete" | "integrated" | "none";
  readonly vramBudgetMb: number;
  readonly vramUsedMb: number;
  readonly projectDisk: DiskVolumeSnapshot;
  readonly appDataDisk: DiskVolumeSnapshot;
  readonly diskQueueDepth: number;
  readonly ioLatencyMs: number;
  readonly storageClass: "ssd" | "hdd";
  readonly devDrive: boolean;
}

export interface ResourceTelemetryProvider {
  current(nowMs?: number): HardwareSnapshot;
}

export interface JobObjectFootprintReading {
  readonly peakJobMemoryUsedBytes: number;
  readonly currentWorkingSetBytes: number;
  readonly totalUserTimeMs: number;
  readonly totalKernelTimeMs: number;
  readonly diskWriteBytes: number;
  readonly wallClockMs: number;
  readonly activeChildProcessCount: number;
}
