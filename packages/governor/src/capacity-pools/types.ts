export const WAITING_FOR_RUN_SLOT = "Waiting for run slot" as const;

export const GOVERNOR_PRESSURES = ["Green", "Yellow", "Orange", "Red"] as const;
export type GovernorPressure = (typeof GOVERNOR_PRESSURES)[number];

export const LEASE_ROLES = ["verifier", "worker", "background"] as const;
export type LeaseRole = (typeof LEASE_ROLES)[number];

export const FOREIGN_RUNTIMES = [
  "codex-app-server",
  "claude",
  "copilot",
  "cursor",
  "opencode",
  "gemini",
] as const;
export type ForeignRuntime = (typeof FOREIGN_RUNTIMES)[number];

export const COMMAND_CLASSES = [
  "tsc",
  "vitest",
  "playwright",
  "build",
  "migrate",
  "pnpm_test",
  "lint",
  "index",
  "brownfield_scan",
  "preview",
] as const;
export type CommandClass = (typeof COMMAND_CLASSES)[number];

export const HEAVY_COMMAND_CLASSES = ["tsc", "playwright", "build", "migrate"] as const;
export type HeavyCommandClass = (typeof HEAVY_COMMAND_CLASSES)[number];

export const DISK_WRITE_KINDS = [
  "git_worktree_add",
  "git_worktree_reset",
  "pnpm_install",
  "pnpm_hardlink_unpack",
  "sqlite_vacuum",
  "sqlite_backup",
  "cas_gc",
  "brownfield_index",
] as const;
export type DiskWriteKind = (typeof DISK_WRITE_KINDS)[number];

export const SANDBOX_TIERS = ["A", "B", "C", "D", "E", "UNSANDBOXED"] as const;
export type SandboxTier = (typeof SANDBOX_TIERS)[number];

export const THINKING_PHASES = ["thinking", "waiting_for_run_slot", "running"] as const;
export type ThinkingPhase = (typeof THINKING_PHASES)[number];

export const LEASE_RELEASE_REASONS = ["finish", "timeout", "stop"] as const;
export type LeaseReleaseReason = (typeof LEASE_RELEASE_REASONS)[number];

/** Thinking agents wait on a remote model. Account for that as under 10 MB and no local CPU. */
export const THINKING_RAM_MB = 8;
export const THINKING_CPU_WHILE_WAITING = 0;

/** Resident foreign CLI processes stay in this band even while idle. */
export const FOREIGN_SESSION_RAM_MIN_MB = 150;
export const FOREIGN_SESSION_RAM_MAX_MB = 400;
export const FOREIGN_SESSION_RAM_DEFAULT_MB = 300;

/** Worker aging reaches its cap at 60s and then stops growing. */
export const AGING_WINDOW_MS = 60_000;
export const ROLE_BASE_SCORE = {
  verifier: 3_000,
  worker: 2_000,
  background: 1_000,
} as const;
/**
 * At 60s a worker's score is base + this boost, which is one above a fresh verifier.
 * Before that instant, a verifier still wins a tie.
 */
export const MAX_WAIT_BOOST = 1_001;
/** Tie-break inside the worker band. It cannot outrank a verifier on its own. */
export const CRITICAL_PATH_BONUS = 10;

/** Forward progress keeps one slot only while free disk stays at or above this floor. */
export const DISK_FORWARD_PROGRESS_FLOOR_GB = 2;

/** execution-capacity.md: pause the disk lane after sustained high active time. */
export const DISK_ACTIVE_PAUSE_PERCENT = 80;
export const DISK_ACTIVE_PAUSE_MS = 10_000;

export function isGovernorPressure(value: string): value is GovernorPressure {
  return (GOVERNOR_PRESSURES as readonly string[]).includes(value);
}

export function isLeaseRole(value: string): value is LeaseRole {
  return (LEASE_ROLES as readonly string[]).includes(value);
}

export function isForeignRuntime(value: string): value is ForeignRuntime {
  return (FOREIGN_RUNTIMES as readonly string[]).includes(value);
}

export function isCommandClass(value: string): value is CommandClass {
  return (COMMAND_CLASSES as readonly string[]).includes(value);
}

export function isDiskWriteKind(value: string): value is DiskWriteKind {
  return (DISK_WRITE_KINDS as readonly string[]).includes(value);
}

export function isHeavyCommand(commandClass: CommandClass): commandClass is HeavyCommandClass {
  return (HEAVY_COMMAND_CLASSES as readonly string[]).includes(commandClass);
}

export interface ThinkingPermit {
  readonly taskId: string;
  readonly admittedAt: number;
  readonly ramMb: typeof THINKING_RAM_MB;
  readonly cpuWhileWaiting: typeof THINKING_CPU_WHILE_WAITING;
}

export interface ExecutionRequest {
  readonly taskId: string;
  readonly role: LeaseRole;
  readonly commandClass: CommandClass;
  readonly command: string;
  readonly timeoutMs: number;
  readonly criticalPath?: boolean;
  readonly signal?: AbortSignal;
  readonly attemptId?: string;
}

export interface ExecutionLease {
  readonly leaseId: string;
  readonly slotId: string;
  readonly taskId: string;
  readonly role: LeaseRole;
  readonly commandClass: CommandClass;
  readonly command: string;
  readonly criticalPath: boolean;
  readonly jobId: string;
  readonly worktreeSlotId: string;
  readonly worktreePath: string;
  readonly sandboxTier: SandboxTier;
  readonly enqueuedAt: number;
  readonly acquiredAt: number;
  readonly timeoutMs: number;
  /** Deadline is acquiredAt + timeoutMs. Queue wait is not subtracted. */
  readonly deadlineAt: number;
  readonly queuedMs: number;
}

export interface ReleaseReport {
  readonly leaseId: string;
  readonly slotId: string;
  readonly taskId: string;
  readonly reason: LeaseReleaseReason;
  readonly clean: boolean;
  readonly activeChildProcesses: number;
}

export interface WaiterStatus {
  readonly taskId: string;
  readonly status: typeof WAITING_FOR_RUN_SLOT;
}

export interface CapacitySnapshot {
  readonly thinkingCount: number;
  readonly waitingForRunSlotCount: number;
  readonly runningSlotCount: number;
  readonly slotOwnerTaskIds: readonly string[];
  readonly executionTarget: number;
  readonly warmExecutionSlots: number;
  readonly sessionProcessActive: number;
  readonly sessionProcessCap: number;
  readonly pressure: GovernorPressure;
  readonly diskFreeGb: number;
  readonly thinkingCap: number;
  readonly waiterStatuses: readonly WaiterStatus[];
}

export interface ExecutionPoolInspection {
  readonly desiredTarget: number;
  readonly effectiveTarget: number;
  readonly warmSlotCount: number;
  readonly runningSlotCount: number;
  readonly waitingForRunSlotCount: number;
  readonly slotOwnerTaskIds: readonly string[];
  readonly dirtySlotIds: readonly string[];
  readonly waiterStatuses: readonly WaiterStatus[];
}
