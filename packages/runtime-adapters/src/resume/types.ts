/** Idle wrapped foreign CLIs checkpoint and terminate after this wait. */
export const IDLE_PARK_AFTER_MS = 90_000;

/** Fresh-session WIP handoff stays inside this token budget. */
export const WIP_HANDOFF_TOKEN_LIMIT = 1_500;

/**
 * Context utilization above this fraction starts a fresh session.
 * Exactly 80% may still native-resume.
 */
export const CONTEXT_FRESH_SESSION_ABOVE = 0.8;

/** Generated files at or above this size are summarized by path and line count. */
export const LARGE_WIP_FILE_BYTES = 2 * 1024 * 1024;

export const PRIOR_UNVERIFIED_WIP = "[PRIOR UNVERIFIED WIP]";

export const PRIOR_UNVERIFIED_WIP_HEADER =
  "[PRIOR UNVERIFIED WIP DIFF — REVIEW & FINISH]";

export const PARK_REASONS = [
  "turn_completed",
  "stop",
  "pause",
  "hold",
  "budget_100",
  "token_refresh",
  "idle_park",
  "session_process_cap",
  "crash",
] as const;

export type ParkReason = (typeof PARK_REASONS)[number];

export const IDLE_WAIT_KINDS = [
  "inbox",
  "task_holds",
  "allowance_reset",
  "waiting_on_user",
] as const;

export type IdleWaitKind = (typeof IDLE_WAIT_KINDS)[number];

export type DeltaKind = "none" | "additive" | "contradictory";

export const RESUME_FAILURE_CODES = [
  "unsupported_resume",
  "SESSION_NOT_FOUND",
  "CORRUPT_SESSION",
  "timeout",
  "incompatible",
  "failed",
] as const;

export type ResumeFailureCode = (typeof RESUME_FAILURE_CODES)[number];

export interface TimelineEntry {
  readonly at: number;
  readonly message: string;
}

/**
 * Logical row persisted through `state.db.attempt_checkpoints`.
 * Columns that the frozen schema does not have travel in `contract_versions`.
 */
export interface ForeignRuntimeCheckpoint {
  readonly attemptId: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly nativeSessionId: string | null;
  readonly pinnedBaseCommitSha: string;
  readonly pinnedSliceSha256: string;
  readonly wipTreeSha: string;
  readonly modifiedFiles: readonly string[];
  readonly lastStepSummary: string;
  readonly lastVerificationError: string | null;
  readonly parkedAt: number | null;
  readonly parkReason: ParkReason | null;
  readonly resumeFailCount: number;
  readonly disableNativeResumeForAttempt: boolean;
  readonly contextUtilization: number;
  readonly step: number;
  readonly residentRamMb: number;
  readonly idleKind: IdleWaitKind | null;
  readonly idleSince: number | null;
  readonly childPid: number | null;
  readonly processAlive: boolean;
  readonly briefText: string;
  readonly requirements: readonly string[];
  readonly timeline: readonly TimelineEntry[];
  readonly worktreePath: string;
  readonly slotId: string;
  readonly lastHandoff: string | null;
}

export interface CompiledBrief {
  readonly sliceSha256: string;
  readonly text: string;
  readonly requirements: readonly string[];
  readonly changeKind: DeltaKind;
  readonly deltaNote: string;
  readonly contradictedTokens: readonly string[];
}

export type ResumeStrategy = "native_resume" | "fresh_session" | "already_live";

export interface ResumeOutcome {
  readonly strategy: ResumeStrategy;
  readonly attemptId: string;
  readonly adapterId: string;
  readonly sessionId: string;
  readonly pid: number | null;
  readonly wipTreeSha: string;
  readonly restoredTreeSha: string | null;
  readonly handoff: string | null;
  readonly tokenCount: number;
  readonly timelineMessage: string;
  readonly disableNativeResumeForAttempt: boolean;
  readonly resumeFailCount: number;
  readonly briefText: string;
  readonly baseNote: string | null;
  readonly wipedPaths: readonly string[];
  readonly keptPaths: readonly string[];
}

export function runtimeDisplayName(adapterId: string): string {
  switch (adapterId) {
    case "codex":
      return "Codex";
    case "claude-code":
      return "Claude Code";
    case "opencode":
      return "OpenCode";
    case "copilot":
      return "Copilot";
    case "cursor":
      return "Cursor";
    case "native-worker-loop":
      return "Native Worker Loop";
    case "acp":
      return "ACP";
    case "gemini-cli":
      return "Gemini CLI";
    default:
      return adapterId;
  }
}

export function autoParkTimeline(adapterId: string, ramMb: number): string {
  return `Auto-parked idle ${runtimeDisplayName(adapterId)} process (freed ${ramMb} MB RAM)`;
}

export function nativeResumeTimeline(adapterId: string): string {
  if (adapterId === "codex") return "Resumed cleanly via native thread/resume";
  if (adapterId === "claude-code") return "Resumed cleanly via native --resume";
  if (adapterId === "opencode" || adapterId === "acp") {
    return "Resumed cleanly via native session/load";
  }
  return "Resumed cleanly via native resume";
}

export function freshSessionTimeline(adapterId: string, switched: boolean): string {
  const name = runtimeDisplayName(adapterId);
  if (switched) return `Switched to fresh ${name} session with labeled WIP diff`;
  return `Rebuilt a fresh ${name} session with labeled WIP diff`;
}

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lines += 1;
  }
  if (text.charCodeAt(text.length - 1) === 10) lines -= 1;
  return Math.max(1, lines);
}
