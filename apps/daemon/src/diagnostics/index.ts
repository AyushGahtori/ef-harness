export {
  BUNDLE_FILE_ORDER,
  RedactedDiagnosticsBundleExporter,
  assertBundleEntryName,
  stageBundleEntries,
} from "./bundle-exporter.js";
export type { BundleFileName, DiagnosticsBundleRequest } from "./bundle-exporter.js";
export { runSafeCacheCleanup } from "./cache-cleanup.js";
export { CrashDumpIndexer, LOCAL_CRASH_REPORTER } from "./crash-dump-indexer.js";
export type { CrashDumpIndexerOptions } from "./crash-dump-indexer.js";
export { LocalPacketSecurityRedactor, REDACTED_SECRET } from "./local-redactor.js";
export { ArrayLogReader } from "./log-reader.js";
export { DiagnosticsMetricsAggregator } from "./metrics-aggregator.js";
export type { DiagnosticsMetricsDependencies } from "./metrics-aggregator.js";
export { scrubDiagnosticsText } from "./pii-scrub.js";
export type { RedactionContext } from "./pii-scrub.js";
export type {
  BackupStatusPort,
  ClipboardPort,
  ConformancePort,
  DiskHeadroomProbePort,
  DpapiProbePort,
  HardwareRingBufferPort,
  LearnedFootprintPort,
  MinGitProbePort,
  NamedPipeProbePort,
  PacketSecurityRedactorPort,
  PinSafeCacheGcPort,
  PortLeaseProbePort,
  PressureHistoryPort,
  ProviderHealthPort,
  SeekableZstdLogReaderPort,
  StorageHygienePort,
  TelemetryDbRepoPort,
} from "./ports.js";
export { DiagnosticsSelfCheck, classifyDiskHeadroom } from "./self-check.js";
export type { SelfCheckOptions, SelfCheckProbes } from "./self-check.js";
export { buildRedactedSummaryMarkdown, copyRedactedSummary } from "./summary-markdown.js";
export type { RedactedSummaryInput } from "./summary-markdown.js";
export { TelemetryRetentionSweeper } from "./retention-sweeper.js";
export type { RetentionSweepResult } from "./retention-sweeper.js";
export {
  TELEMETRY_SCHEMA_SQL,
  fileByteSize,
  inspectSqliteFile,
  rebuildTelemetryDatabase,
} from "./telemetry-db.js";
export {
  CRASH_DUMP_MAX_BYTES,
  CRASH_DUMP_MAX_COUNT,
  DAEMON_LOG_LINE_CAP,
  DISK_PAUSE_BYTES,
  DISK_STOP_BYTES,
  DISK_WARN_BYTES,
  SELF_CHECK_BUDGET_MS,
  SQLITE_WRITE_SLO_MS,
  TELEMETRY_SIZE_BUDGET_BYTES,
  TELEMETRY_UNAVAILABLE_MESSAGE,
  BundleAllowlistError,
  RedactionCanaryLeakError,
  TelemetryUnavailableError,
} from "./types.js";
export type {
  BundlePreview,
  BundlePreviewFile,
  ConformanceRow,
  CrashDumpRecord,
  CrashProcessType,
  DiagnosticsSnapshot,
  HardwareSample,
  LearnedFootprint,
  NamedSparkline,
  PoolUtilization,
  PressureLevel,
  PressurePoint,
  ProviderHealth,
  SelfCheckItem,
  SelfCheckReport,
  SelfCheckStatus,
  SqliteDatabaseHealth,
  StorageHygiene,
  WorkerHealth,
  WriteLatencyHealth,
} from "./types.js";
export { readStoredZip, writeStoredZip } from "./zip-store.js";
