export type PressureLevel = "Green" | "Yellow" | "Orange" | "Red";

export type SelfCheckStatus = "green" | "amber" | "red";

export interface SparkPoint {
  readonly at: number;
  readonly value: number;
}

export interface NamedSparkline {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly points: readonly SparkPoint[];
  readonly min: number;
  readonly max: number;
  readonly latest: number;
}

export interface PoolUtilization {
  readonly id: 1 | 2 | 3;
  readonly name: string;
  readonly used: number;
  readonly capacity: number;
}

export interface SqliteDatabaseHealth {
  readonly name: string;
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
  readonly sloMs: number;
  readonly withinSlo: boolean;
}

export interface PressurePoint {
  readonly at: number;
  readonly level: PressureLevel;
  readonly reason: string;
}

export interface LearnedFootprint {
  readonly commandClass: string;
  readonly peakRamMbP90: number;
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
  readonly status: string;
  readonly detail: string;
}

export interface StorageHygiene {
  readonly casBlobBytes: number;
  readonly archivedZstdLogBytes: number;
  readonly activeWorktreeCount: number;
}

export interface CrashDumpRow {
  readonly dumpId: string;
  readonly processType: string;
  readonly occurredAt: number;
  readonly appVersion: string;
  readonly signalOrExitCode: string;
  readonly fileSizeBytes: number;
  readonly summaryStack: string;
}

export interface SelfCheckItem {
  readonly id: string;
  readonly name: string;
  readonly status: SelfCheckStatus;
  readonly detail: string;
  readonly fixSteps: readonly string[];
}

export interface BundlePreviewFile {
  readonly name: string;
  readonly byteLength: number;
  readonly text: string;
}

export interface DiagnosticsHealthModel {
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
  readonly crashes: readonly CrashDumpRow[];
  readonly selfCheck: readonly SelfCheckItem[];
  readonly previewFiles: readonly BundlePreviewFile[];
  readonly includeSanitizedGraph: boolean;
  readonly redactedSummary: string;
  readonly cleanupMessage: string | null;
}

export interface DiagnosticsHealthActions {
  runSelfCheck(): Promise<readonly SelfCheckItem[]>;
  exportBundle(): Promise<readonly BundlePreviewFile[]>;
  saveZip(): Promise<void>;
  runSafeCacheCleanup(): Promise<string>;
  copySummary(markdown: string): Promise<void> | void;
  rebuildTelemetry(): Promise<void>;
  setIncludeSanitizedGraph(include: boolean): void;
}
