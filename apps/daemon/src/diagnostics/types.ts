export const SQLITE_WRITE_SLO_MS = 50;
export const HARDWARE_SAMPLE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const DAILY_AGGREGATE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const TELEMETRY_SIZE_BUDGET_BYTES = 50 * 1024 * 1024;
export const CRASH_DUMP_MAX_COUNT = 10;
export const CRASH_DUMP_MAX_BYTES = 50 * 1024 * 1024;
export const DAEMON_LOG_LINE_CAP = 2_000;
export const SELF_CHECK_BUDGET_MS = 2_000;
export const SPARKLINE_POINT_CAP = 48;
export const DISK_WARN_BYTES = 15 * 1024 * 1024 * 1024;
export const DISK_PAUSE_BYTES = 5 * 1024 * 1024 * 1024;
export const DISK_STOP_BYTES = 2 * 1024 * 1024 * 1024;

export const TELEMETRY_UNAVAILABLE_MESSAGE =
  "telemetry.db unavailable — click Rebuild Telemetry DB";

export type PressureLevel = "Green" | "Yellow" | "Orange" | "Red";

export type CrashProcessType = "main" | "renderer" | "daemon" | "converter";

export type SelfCheckStatus = "green" | "amber" | "red";

export type ConformanceStatusValue = "pass" | "fail" | "skipped";

export interface PoolUtilization {
  readonly id: 1 | 2 | 3;
  readonly name: string;
  readonly used: number;
  readonly capacity: number;
}

export interface HardwareSample {
  readonly at: number;
  readonly ramUsedBytes: number;
  readonly ramTotalBytes: number;
  readonly commitUsedBytes: number;
  readonly commitLimitBytes: number;
  readonly diskFreeProjectBytes: number;
  readonly diskFreeAppDataBytes: number;
  readonly avCpuPercent: number;
  readonly uiInputToPaintP95Ms: number;
  readonly pressure: PressureLevel;
  readonly pools: readonly [PoolUtilization, PoolUtilization, PoolUtilization];
}

export interface PressurePoint {
  readonly at: number;
  readonly level: PressureLevel;
  readonly reason: string;
}

export interface LearnedFootprint {
  readonly commandClass: string;
  readonly peakRamMbP90: number;
  readonly peakCpuMs: number;
  readonly wallClockMs: number;
}

export interface ProviderHealth {
  readonly connectionId: string;
  readonly latencyMs: number;
  readonly rateLimit429: number;
  readonly aimdConcurrency: number;
}

export interface WorkerHealth {
  readonly pass: number;
  readonly retry: number;
  readonly stuck: number;
  readonly loop: number;
}

export interface ConformanceRow {
  readonly adapterId: string;
  readonly status: ConformanceStatusValue;
  readonly detail: string;
}

export interface StorageHygiene {
  readonly casBlobBytes: number;
  readonly archivedZstdLogBytes: number;
  readonly activeWorktreeCount: number;
}

export interface SqliteDatabaseHealth {
  readonly name: "state.db" | "global.db" | "telemetry.db";
  readonly path: string;
  readonly bytes: number;
  readonly walBytes: number;
  readonly schemaVersion: number | null;
  readonly quickCheck: string;
}

export interface WriteLatencyHealth {
  readonly sampleCount: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly p99Ms: number | null;
  readonly busyRetryCount: number;
  readonly sloMs: typeof SQLITE_WRITE_SLO_MS;
  readonly withinSlo: boolean;
}

export interface NamedSparkline {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly points: readonly { readonly at: number; readonly value: number }[];
  readonly min: number;
  readonly max: number;
  readonly latest: number;
}

export interface DiagnosticsSnapshot {
  readonly generatedAt: number;
  readonly windowMs: number;
  readonly telemetryAvailable: boolean;
  readonly unavailableMessage: string | null;
  readonly databases: readonly SqliteDatabaseHealth[];
  readonly writeLatency: WriteLatencyHealth;
  readonly lastVerifiedBackupAt: number | null;
  readonly sparklines: readonly NamedSparkline[];
  readonly pressureHistory: readonly PressurePoint[];
  readonly currentPressure: PressurePoint | null;
  readonly pools: readonly PoolUtilization[];
  readonly footprints: readonly LearnedFootprint[];
  readonly providers: readonly ProviderHealth[];
  readonly workers: WorkerHealth;
  readonly conformance: readonly ConformanceRow[];
  readonly storage: StorageHygiene;
  readonly recentErrors: readonly string[];
}

export interface CrashDumpRecord {
  readonly dumpId: string;
  readonly processType: CrashProcessType;
  readonly occurredAt: number;
  readonly appVersion: string;
  readonly signalOrExitCode: string;
  readonly summaryStack: string;
  readonly fileSizeBytes: number;
  readonly fileName: string;
}

export interface BundlePreviewFile {
  readonly name: string;
  readonly text: string;
  readonly bytes: Uint8Array;
}

export interface BundlePreview {
  readonly files: readonly BundlePreviewFile[];
}

export interface SelfCheckItem {
  readonly id: string;
  readonly name: string;
  readonly status: SelfCheckStatus;
  readonly detail: string;
  readonly fixSteps: readonly string[];
  readonly durationMs: number;
}

export interface SelfCheckReport {
  readonly items: readonly SelfCheckItem[];
  readonly durationMs: number;
  readonly withinBudget: boolean;
}

export class TelemetryUnavailableError extends Error {
  readonly code = "TELEMETRY_UNAVAILABLE";

  constructor(message: string = TELEMETRY_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = "TelemetryUnavailableError";
  }
}

export class BundleAllowlistError extends Error {
  readonly code = "BUNDLE_ALLOWLIST";

  constructor(readonly entryName: string) {
    super(`diagnostics bundle allowlist rejected ${entryName}`);
    this.name = "BundleAllowlistError";
  }
}

export class RedactionCanaryLeakError extends Error {
  readonly code = "REDACTION_CANARY_LEAK";

  constructor() {
    super("post-redaction canary assertion failed");
    this.name = "RedactionCanaryLeakError";
  }
}
