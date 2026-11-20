export type DatabaseMode = "readonly" | "readwrite";

export type SafeModeReason = "foreign_write" | "disk_io_error" | "corrupt";

export type StreamEpochBumpReason = "rehydrated" | "restored";

export type StaleOwnerReason = "pid_dead" | "pid_reused";

export interface SafeModeDiagnostics {
  message: string;
  quickCheck?: string;
  sqliteCode?: number;
  dataVersion?: number;
  previousDataVersion?: number;
  worktreesPreserved: true;
  checkpointsPreserved: true;
}

export interface SafeModeStatusPayload {
  priority: "high";
  projectId: string;
  mode: DatabaseMode;
  safeMode: true;
  reason: SafeModeReason;
  diagnostics: SafeModeDiagnostics;
  dispatchBlocked: true;
  writesBlocked: true;
  worktreesPreserved: true;
  checkpointsPreserved: true;
}

export interface ResyncRequiredPayload {
  type: "resync_required";
  projectId: string;
  streamEpoch: number;
  reason: StreamEpochBumpReason;
}

export interface WriterOwner {
  pid: number;
  processStartTime: string;
  epoch: number;
  hostname: string;
  acquiredAt: number;
}

export interface WriterLockStatus {
  acquired: boolean;
  mode: DatabaseMode;
  owner: WriterOwner | null;
}

export interface DataVersionCheck {
  dataVersion: number;
  foreignWrite: false;
}

export interface ProjectRuntimeRow {
  id: 1;
  state: string;
  paused: number;
  updatedRev: number;
}

export interface SchemaMigrationRow {
  version: number;
  name: string;
  kind: string;
  appVersion: string;
  appliedAt: number;
}

export interface IntegrityCheckResult {
  ran: boolean;
  ok: boolean;
  report: string;
}

/**
 * Structural logger matched to Task 011 `StructuredLogger` (`info` / `warn` / `error`).
 * That package is not on this branch, so callers inject the real logger at the process edge.
 */
export interface StateDbLogger {
  info(message: string, fields?: unknown): void;
  warn(message: string, fields?: unknown): void;
  error(message: string, fields?: unknown): void;
}

export interface OpenProjectStateDbOptions {
  projectId: string;
  rootDir?: string;
  logger?: StateDbLogger;
  now?: () => number;
  appVersion?: string;
  supportedSchemaVersion?: number;
  /** Test seam: throw after the temp database is durable and before it is renamed into place. */
  beforePublish?: () => void;
  onSafeMode?: (payload: SafeModeStatusPayload) => void;
  onResyncRequired?: (payload: ResyncRequiredPayload) => void;
}
