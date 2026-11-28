export const HARDWARE_SNAPSHOT_SCHEMA_ID = "ef.governor.hardware_snapshot.v1" as const;

export const PROVIDER_KINDS = ["win32", "posix", "synthetic"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const COLLECTOR_CADENCES = ["active", "idle", "suspended"] as const;
export type CollectorCadence = (typeof COLLECTOR_CADENCES)[number];

export const JOB_ROLES = ["worker", "verifier", "environment", "service", "command"] as const;
export type JobRole = (typeof JOB_ROLES)[number];

export const VOLUME_ROLES = ["workspace", "appdata"] as const;
export type VolumeRole = (typeof VOLUME_ROLES)[number];

export const TELEMETRY_KINDS = ["progress", "tokens", "heartbeat", "tool", "metric"] as const;
export type TelemetryKind = (typeof TELEMETRY_KINDS)[number];

export const DEFENDER_PROCESS_NAME = "MsMpEng.exe" as const;
export const UI_HEARTBEAT_HZ = 1 as const;
export const UI_LATENCY_PRESSURE_MS = 50;
export const DEFENDER_CONTENTION_CPU_PERCENT = 25;
export const ACTIVE_POLL_MS = 1000;
export const IDLE_POLL_MS = 5000;
export const SUSPENDED_POLL_HZ = 0;
export const MAX_SAMPLE_MS = 5;
export const MAX_COLLECTOR_CPU_RATIO = 0.005;
export const MAX_COLLECTOR_RAM_BYTES = 15 * 1024 * 1024;
export const BYTES_PER_GB = 1024 * 1024 * 1024;
export const DISK_WARNING_FREE_BYTES = 15 * BYTES_PER_GB;
export const DISK_PAUSE_FREE_BYTES = 5 * BYTES_PER_GB;
export const DISK_EMERGENCY_FREE_BYTES = 2 * BYTES_PER_GB;
export const COMMIT_HEADROOM_FLOOR_BYTES = BYTES_PER_GB;
export const COMMIT_EXHAUSTED_USED_RATIO = 0.95;
export const DEFAULT_RING_CAPACITY = 256;
export const DEFAULT_FLUSH_CAP = 64;
export const DEFAULT_TELEMETRY_ROW_CAP = 2000;
export const DEFAULT_UI_SUSTAIN_SAMPLES = 2;

export const FORBIDDEN_POLL_EXECUTABLES = ["powershell.exe", "cmd.exe", "wmic.exe"] as const;

export const DEFENDER_EXCLUSION_TIP =
  "Windows Defender (MsMpEng.exe) is using more than 25% CPU, often while it scans newly written node_modules or build output. You can add the harness worktree folder to Defender exclusions yourself. EF Harness only observes Defender and never changes its settings.";

export class TelemetryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TelemetryError";
    this.code = code;
  }
}

export class HardwareSnapshotError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join("; "));
    this.name = "HardwareSnapshotError";
    this.issues = issues;
  }
}

export interface MemorySample {
  readonly totalPhysicalBytes: number;
  readonly availablePhysicalBytes: number;
  readonly totalPageFileBytes: number;
  readonly availablePageFileBytes: number;
  readonly memoryLoadPercent: number;
  readonly physicalFreeRatio: number;
  readonly commitFreeRatio: number;
  readonly commitExhausted: boolean;
  readonly commitMetricUnavailable: boolean;
  readonly lowMemoryNotification: boolean;
  readonly lowMemoryNotificationUnavailable: boolean;
  readonly metricUnavailable: boolean;
}

export interface JobAccountingSample {
  readonly jobId: string;
  readonly jobName: string;
  readonly role: JobRole;
  readonly peakJobMemoryUsedBytes: number;
  readonly currentWorkingSetBytes: number;
  readonly totalUserTimeMs: number;
  readonly totalKernelTimeMs: number;
  readonly activeProcessCount: number;
  readonly metricUnavailable: boolean;
}

export interface GpuSample {
  readonly gpuAvailable: boolean;
  readonly adapterName: string | null;
  readonly budgetBytes: number | null;
  readonly currentUsageBytes: number | null;
  readonly availableForReservationBytes: number | null;
  readonly sharedVramBudgetBytes: number | null;
  readonly metricUnavailable: boolean;
}

export interface VolumeSample {
  readonly role: VolumeRole;
  readonly path: string;
  readonly drive: string;
  readonly freeBytes: number;
  readonly totalBytes: number;
  readonly metricUnavailable: boolean;
}

export interface DiskSample {
  readonly volumes: readonly [VolumeSample, VolumeSample];
  readonly tightestFreeBytes: number;
  readonly tightestDrive: string;
  readonly tightestRole: VolumeRole;
  readonly queueLength: number | null;
  readonly ioBusyPercent: number | null;
  readonly queueMetricUnavailable: boolean;
  readonly belowWarning15Gb: boolean;
  readonly belowPause5Gb: boolean;
  readonly belowEmergency2Gb: boolean;
}

export interface DefenderSample {
  readonly processName: typeof DEFENDER_PROCESS_NAME;
  readonly cpuPercent: number;
  readonly avContentionActive: boolean;
  readonly settingsMutated: false;
  readonly metricUnavailable: boolean;
  readonly exclusionTip: string | null;
}

export interface UiLatencySample {
  readonly uiLatencyMs: number | null;
  readonly windowVisible: boolean;
  readonly interacting: boolean;
  readonly pressure: boolean;
  readonly suppressedHidden: boolean;
  readonly consecutiveLagSamples: number;
  readonly heartbeatHz: typeof UI_HEARTBEAT_HZ;
}

export interface HardwareSnapshot {
  readonly schemaId: typeof HARDWARE_SNAPSHOT_SCHEMA_ID;
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
}

export interface UiHeartbeat {
  readonly atMs: number;
  readonly uiLatencyMs: number;
  readonly documentHidden: boolean;
  readonly interacting: boolean;
}

export interface ActiveJobSlot {
  readonly id: string;
  readonly name: string;
  readonly role: JobRole;
}

export interface SupervisorJobAccounting {
  readonly peakJobMemoryUsedBytes: number;
  readonly currentWorkingSetBytes: number;
  readonly totalUserTimeMs: number;
  readonly totalKernelTimeMs: number;
  readonly activeProcessCount: number;
}

export interface TelemetryEventInput {
  readonly attempt: string | null;
  readonly ts: number;
  readonly kind: TelemetryKind;
  readonly data: unknown;
}

export interface TelemetryEnqueueResult {
  readonly accepted: boolean;
  readonly dropped: number;
}
