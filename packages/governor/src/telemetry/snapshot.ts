import {
  COMMIT_EXHAUSTED_USED_RATIO,
  COMMIT_HEADROOM_FLOOR_BYTES,
  DEFENDER_CONTENTION_CPU_PERCENT,
  DEFENDER_EXCLUSION_TIP,
  DEFENDER_PROCESS_NAME,
  DISK_EMERGENCY_FREE_BYTES,
  DISK_PAUSE_FREE_BYTES,
  DISK_WARNING_FREE_BYTES,
  HARDWARE_SNAPSHOT_SCHEMA_ID,
  UI_HEARTBEAT_HZ,
  type CollectorCadence,
  type DefenderSample,
  type DiskSample,
  type GpuSample,
  type HardwareSnapshot,
  type JobAccountingSample,
  type JobRole,
  type MemorySample,
  type ProviderKind,
  type UiLatencySample,
  type VolumeRole,
  type VolumeSample,
} from "./types.js";

export function freeRatio(available: number, total: number): number {
  if (total <= 0) return 0;
  return available / total;
}

export function commitIsExhausted(input: {
  readonly totalPageFileBytes: number;
  readonly availablePageFileBytes: number;
  readonly commitMetricUnavailable: boolean;
}): boolean {
  if (input.commitMetricUnavailable) return false;
  if (input.availablePageFileBytes < COMMIT_HEADROOM_FLOOR_BYTES) return true;
  if (input.totalPageFileBytes <= 0) return false;
  return 1 - input.availablePageFileBytes / input.totalPageFileBytes > COMMIT_EXHAUSTED_USED_RATIO;
}

export function driveOf(filePath: string): string {
  if (filePath.startsWith("\\\\")) return "unc";
  const match = /^[A-Za-z]:/.exec(filePath);
  return match?.[0]?.toUpperCase() ?? "volume";
}

export function memorySample(input: {
  readonly totalPhysicalBytes: number;
  readonly availablePhysicalBytes: number;
  readonly totalPageFileBytes: number;
  readonly availablePageFileBytes: number;
  readonly memoryLoadPercent: number;
  readonly lowMemoryNotification: boolean;
  readonly lowMemoryNotificationUnavailable: boolean;
  readonly commitMetricUnavailable: boolean;
  readonly metricUnavailable: boolean;
}): MemorySample {
  return {
    totalPhysicalBytes: input.totalPhysicalBytes,
    availablePhysicalBytes: input.availablePhysicalBytes,
    totalPageFileBytes: input.totalPageFileBytes,
    availablePageFileBytes: input.availablePageFileBytes,
    memoryLoadPercent: input.memoryLoadPercent,
    physicalFreeRatio: freeRatio(input.availablePhysicalBytes, input.totalPhysicalBytes),
    commitFreeRatio: input.commitMetricUnavailable
      ? 0
      : freeRatio(input.availablePageFileBytes, input.totalPageFileBytes),
    commitExhausted: commitIsExhausted(input),
    commitMetricUnavailable: input.commitMetricUnavailable,
    lowMemoryNotification: input.lowMemoryNotification,
    lowMemoryNotificationUnavailable: input.lowMemoryNotificationUnavailable,
    metricUnavailable: input.metricUnavailable,
  };
}

export function unavailableMemory(): MemorySample {
  return memorySample({
    totalPhysicalBytes: 0,
    availablePhysicalBytes: 0,
    totalPageFileBytes: 0,
    availablePageFileBytes: 0,
    memoryLoadPercent: 0,
    lowMemoryNotification: false,
    lowMemoryNotificationUnavailable: true,
    commitMetricUnavailable: true,
    metricUnavailable: true,
  });
}

export function jobSample(input: {
  readonly jobId: string;
  readonly jobName: string;
  readonly role: JobRole;
  readonly peakJobMemoryUsedBytes: number;
  readonly currentWorkingSetBytes: number;
  readonly totalUserTimeMs: number;
  readonly totalKernelTimeMs: number;
  readonly activeProcessCount: number;
  readonly metricUnavailable: boolean;
}): JobAccountingSample {
  return { ...input };
}

export function unavailableJob(jobId: string, jobName: string, role: JobRole): JobAccountingSample {
  return jobSample({
    jobId,
    jobName,
    role,
    peakJobMemoryUsedBytes: 0,
    currentWorkingSetBytes: 0,
    totalUserTimeMs: 0,
    totalKernelTimeMs: 0,
    activeProcessCount: 0,
    metricUnavailable: true,
  });
}

export function gpuSample(input: {
  readonly gpuAvailable: boolean;
  readonly adapterName: string | null;
  readonly budgetBytes: number | null;
  readonly currentUsageBytes: number | null;
  readonly availableForReservationBytes: number | null;
  readonly sharedVramBudgetBytes: number | null;
  readonly metricUnavailable: boolean;
}): GpuSample {
  return { ...input };
}

export function gpuFallback(sharedVramBudgetBytes: number | null, metricUnavailable: boolean): GpuSample {
  return gpuSample({
    gpuAvailable: false,
    adapterName: null,
    budgetBytes: null,
    currentUsageBytes: null,
    availableForReservationBytes: null,
    sharedVramBudgetBytes,
    metricUnavailable,
  });
}

export function volumeSample(input: {
  readonly role: VolumeRole;
  readonly path: string;
  readonly freeBytes: number;
  readonly totalBytes: number;
  readonly metricUnavailable: boolean;
}): VolumeSample {
  return {
    role: input.role,
    path: input.path,
    drive: driveOf(input.path),
    freeBytes: input.freeBytes,
    totalBytes: input.totalBytes,
    metricUnavailable: input.metricUnavailable,
  };
}

export function diskSample(
  workspace: VolumeSample,
  appData: VolumeSample,
  queue: {
    readonly queueLength: number | null;
    readonly ioBusyPercent: number | null;
    readonly queueMetricUnavailable: boolean;
  },
): DiskSample {
  const available = [workspace, appData].filter((volume) => !volume.metricUnavailable);
  const tightest = available.reduce<VolumeSample | null>((best, volume) => {
    if (!best || volume.freeBytes < best.freeBytes) return volume;
    return best;
  }, null);
  const tightestFreeBytes = tightest?.freeBytes ?? 0;
  const known = tightest !== null;
  return {
    volumes: [workspace, appData],
    tightestFreeBytes,
    tightestDrive: tightest?.drive ?? "",
    tightestRole: tightest?.role ?? "appdata",
    queueLength: queue.queueLength,
    ioBusyPercent: queue.ioBusyPercent,
    queueMetricUnavailable: queue.queueMetricUnavailable,
    belowWarning15Gb: known && tightestFreeBytes < DISK_WARNING_FREE_BYTES,
    belowPause5Gb: known && tightestFreeBytes < DISK_PAUSE_FREE_BYTES,
    belowEmergency2Gb: known && tightestFreeBytes < DISK_EMERGENCY_FREE_BYTES,
  };
}

export function unavailableDisk(workspacePath: string, appDataPath: string): DiskSample {
  return diskSample(
    volumeSample({
      role: "workspace",
      path: workspacePath,
      freeBytes: 0,
      totalBytes: 0,
      metricUnavailable: true,
    }),
    volumeSample({
      role: "appdata",
      path: appDataPath,
      freeBytes: 0,
      totalBytes: 0,
      metricUnavailable: true,
    }),
    { queueLength: null, ioBusyPercent: null, queueMetricUnavailable: true },
  );
}

export function defenderSample(cpuPercent: number, accessDenied: boolean): DefenderSample {
  const metricUnavailable = accessDenied;
  const avContentionActive = !metricUnavailable && cpuPercent > DEFENDER_CONTENTION_CPU_PERCENT;
  return {
    processName: DEFENDER_PROCESS_NAME,
    cpuPercent: metricUnavailable ? 0 : cpuPercent,
    avContentionActive,
    settingsMutated: false,
    metricUnavailable,
    exclusionTip: avContentionActive ? DEFENDER_EXCLUSION_TIP : null,
  };
}

export function neutralUi(): UiLatencySample {
  return {
    uiLatencyMs: null,
    windowVisible: true,
    interacting: false,
    pressure: false,
    suppressedHidden: false,
    consecutiveLagSamples: 0,
    heartbeatHz: UI_HEARTBEAT_HZ,
  };
}

export function hardwareSnapshot(input: {
  readonly sampledAtMs: number;
  readonly provider: ProviderKind;
  readonly cadence: CollectorCadence;
  readonly memory: MemorySample;
  readonly jobs: readonly JobAccountingSample[];
  readonly gpu: GpuSample;
  readonly disk: DiskSample;
  readonly defender: DefenderSample;
  readonly ui: UiLatencySample;
  readonly unavailableMetrics: readonly string[];
  readonly sampleDurationMs: number;
}): HardwareSnapshot {
  return {
    schemaId: HARDWARE_SNAPSHOT_SCHEMA_ID,
    sampledAtMs: input.sampledAtMs,
    provider: input.provider,
    cadence: input.cadence,
    memory: input.memory,
    jobs: input.jobs,
    gpu: input.gpu,
    disk: input.disk,
    defender: input.defender,
    ui: input.ui,
    unavailableMetrics: input.unavailableMetrics,
    sampleDurationMs: input.sampleDurationMs,
  };
}
