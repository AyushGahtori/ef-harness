export const JUNIOR_MAX_STEPS = 40;
export const SENIOR_MAX_STEPS = 80;
export const REPEAT_TOOL_LIMIT = 3;
export const NO_PROGRESS_STEP_LIMIT = 8;
export const STREAM_STALL_MS = 60_000;
export const MODEL_CALL_RESERVE_UNITS = 1_000;

export const TERMINAL_OUTCOMES = [
  "submitted",
  "parked",
  "waiting_input",
  "stuck",
  "budget_exhausted",
  "fenced",
  "blocked",
] as const;

export type TerminalOutcome = (typeof TERMINAL_OUTCOMES)[number];

export type AttemptRunState = "running" | "submitted" | "parked" | "fenced" | "crashed";

export type WorkerLevel = "junior" | "senior";

export type EditFormat = "apply_patch" | "str_replace" | "search_replace";

export type CrashPoint =
  | "during_model_call"
  | "after_response_before_tool"
  | "during_tool"
  | "after_tool_before_log";

export type ModelFailureKind =
  | "auth"
  | "rate_limit"
  | "usage_limit"
  | "billing"
  | "overloaded"
  | "context_overflow"
  | "stream_stall"
  | "unknown_timeout"
  | "malformed_request"
  | "unknown";

export const READ_TOOL_NAMES = ["read_file", "list", "grep"] as const;
export const EDIT_TOOL_NAMES = [
  "apply_patch",
  "str_replace",
  "search_replace",
  "write_new_file",
  "replace_lines",
] as const;
export const KERNEL_TOOL_NAMES = [
  "harness.run",
  "harness.read_log",
  "notes.update",
  "harness.ask_owner",
  "harness.flag_blocked",
  "harness.dispute_test",
  "harness.submit_candidate",
] as const;
export const KB_TOOL_NAMES = [
  "kb.search",
  "kb.get",
  "kb.neighbors",
  "kb.contract",
  "kb.why",
  "kb.code",
] as const;

export const NATIVE_TOOL_CATALOG = [
  ...READ_TOOL_NAMES,
  ...EDIT_TOOL_NAMES,
  ...KERNEL_TOOL_NAMES,
  ...KB_TOOL_NAMES,
] as const;

export const SUBAGENT_TOOL_NAMES = [
  "spawn_agent",
  "subagent",
  "agent",
  "task",
  "harness.spawn_agent",
] as const;

export interface ModelProfileView {
  family: string;
  contextWindow: number;
  maxOutputTokens: number;
  editFormat: EditFormat;
  supportsParallelToolCalls: boolean;
  supportsReasoningReplay: boolean;
  supportsStreamingToolArgs: boolean;
  toolCallReliabilityTier: number;
  supportsPromptCaching: boolean;
  supportsToolCalling: boolean;
  smallContext: boolean;
}

export interface WorkingMemory {
  planSteps: string[];
  doneByMustId: Record<string, string>;
  openProblems: string[];
  learnedFacts: string[];
}

export interface TaskPacketView {
  taskId: string;
  goal: string;
  must: string[];
  should: string[];
  writeScope: string[];
  tools: string[];
  checks: string[];
  contractVersions: Record<string, string>;
  kernelRules: string;
}

export interface CheckObservation {
  id: string;
  status: "pass" | "fail" | "skip";
}

export interface ProviderItem {
  type: "reasoning" | "message" | "function_call" | "user";
  text: string | null;
  encryptedContent: string | null;
  name: string | null;
  arguments: string | null;
  callId: string | null;
}

export interface ToolCall {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments: string;
  malformed: boolean;
  malformedError: string | null;
}

export interface ToolTerminal {
  type: "submitted" | "blocked" | "waiting_input" | "disputed";
  candidateId: string | null;
  reason: string | null;
  question: string | null;
  checkId: string | null;
}

export interface ToolBody {
  ok: boolean;
  summary: string;
  output: string;
  artifactId: string | null;
  changedFiles: string[];
  failingCheckFingerprint: string | null;
  checkResults: CheckObservation[];
  memory: WorkingMemory | null;
  terminal: ToolTerminal | null;
}

export interface SteerNotice {
  id: string;
  kind: "hard" | "additive";
  text: string;
  compatible: boolean;
}

export interface AdditiveSteerState {
  id: string;
  text: string;
  acknowledged: boolean;
}

export interface HardSteerState {
  id: string;
  text: string;
}

export interface HoldRecord {
  reason: string;
  source: string;
}

export interface AttemptRecord {
  id: string;
  task: string;
  n: number;
  epoch: number;
  liveEpoch: number;
  briefVersion: number;
  briefChangedContradiction: boolean;
  contradictionApplied: boolean;
  historyFloorStep: number;
  runtime: "native";
  model: string;
  connection: string;
  worktreeSlot: string;
  baseCommit: string;
  state: AttemptRunState;
  startedAt: number;
  endedAt: number | null;
  outcome: string | null;
  level: WorkerLevel;
  maxSteps: number | null;
  packet: TaskPacketView;
  profile: ModelProfileView;
  workingMemory: WorkingMemory;
  changedFiles: string[];
  lastCheckResults: CheckObservation[];
  failureCalibrationIncrements: number;
  routedTo: "AskOwner" | null;
  holds: HoldRecord[];
  hardSteer: HardSteerState | null;
  additiveSteer: AdditiveSteerState | null;
  stallsByDigest: Record<string, number>;
  overflowRetried: boolean;
  progressStreak: number;
  progressTree: string | null;
  progressFingerprint: string | null;
}

export interface TurnLogRow {
  attempt: string;
  step: number;
  requestDigest: string | null;
  itemsArtifact: string | null;
  toolCall: string | null;
  resultSummary: string | null;
  resultArtifact: string | null;
  checkpointCommit: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

export type PendingEffect =
  | {
      kind: "model_in_flight";
      reservationId: string;
      requestDigest: string;
      clientRequestId: string;
    }
  | {
      kind: "response_recorded";
      itemsArtifact: string;
      requestDigest: string;
      toolCalls: ToolCall[];
      nextToolIndex: number;
      tokensIn: number;
      tokensOut: number;
      text: string;
    }
  | {
      kind: "tool_in_flight";
      itemsArtifact: string;
      requestDigest: string;
      toolCalls: ToolCall[];
      toolIndex: number;
      step: number;
      tokensIn: number;
      tokensOut: number;
      text: string;
    }
  | {
      kind: "tool_done_unlogged";
      itemsArtifact: string;
      requestDigest: string;
      toolCalls: ToolCall[];
      toolIndex: number;
      step: number;
      tokensIn: number;
      tokensOut: number;
      text: string;
    };

export interface CheckpointRow {
  attempt: string;
  step: number;
  wipRef: string | null;
  sessionRef: string | null;
  contractVersions: Record<string, string>;
  pendingEffects: PendingEffect[];
  handoffArtifact: string | null;
  updatedAt: number;
}

export interface AttemptExecutionResult {
  attemptId: string;
  outcome: TerminalOutcome;
  state: AttemptRunState;
  reason: string;
  step: number;
  wipRef: string | null;
  handoffArtifact: string;
  countsAsFailedAttempt: boolean;
  countsAsWorkerFailure: boolean;
  settledUnits: number;
  changedFiles: string[];
  routedTo: "AskOwner" | null;
  checkpointRef: string | null;
}

export interface HandoffNote {
  briefVersion: number;
  stepsCompleted: string[];
  stepsRemaining: string[];
  changedFiles: string[];
  lastCheckResults: CheckObservation[];
  lastFailingCheck: string | null;
  generatedBy: "code";
  llmTokens: 0;
}

export interface CrashSite {
  completedSteps: number;
  nextStep: number;
  toolIndex: number | null;
}

export class CrashInjectedError extends Error {
  readonly point: CrashPoint;
  readonly step: number;
  readonly toolIndex: number | null;

  constructor(point: CrashPoint, step: number, toolIndex: number | null) {
    super(`crash injected at ${point}`);
    this.name = "CrashInjectedError";
    this.point = point;
    this.step = step;
    this.toolIndex = toolIndex;
  }
}

export class LocalTurnFailure extends Error {
  readonly kind: ModelFailureKind;
  readonly retryAfterMs: number | null;
  readonly isProviderSchedulingError: boolean;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly partialUsage: { inputTokens: number; outputTokens: number } | null;

  constructor(
    kind: ModelFailureKind,
    message: string,
    init: {
      retryAfterMs?: number | null;
      isProviderSchedulingError?: boolean;
      clientRequestId?: string;
      idempotencyKey?: string;
      partialUsage?: { inputTokens: number; outputTokens: number } | null;
    } = {},
  ) {
    super(message);
    this.name = "LocalTurnFailure";
    this.kind = kind;
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.isProviderSchedulingError = init.isProviderSchedulingError ?? false;
    this.clientRequestId = init.clientRequestId ?? "local-request";
    this.idempotencyKey = init.idempotencyKey ?? this.clientRequestId;
    this.partialUsage = init.partialUsage ?? null;
  }
}

export interface TurnFailureView {
  kind: ModelFailureKind;
  retryAfterMs: number | null;
  isProviderSchedulingError: boolean;
  clientRequestId: string;
  partialTokensIn: number;
  partialTokensOut: number;
}

export function emptyWorkingMemory(): WorkingMemory {
  return { planSteps: [], doneByMustId: {}, openProblems: [], learnedFacts: [] };
}

export function toolBody(
  partial: Partial<ToolBody> & Pick<ToolBody, "ok" | "summary" | "output">,
): ToolBody {
  return {
    ok: partial.ok,
    summary: partial.summary,
    output: partial.output,
    artifactId: partial.artifactId ?? null,
    changedFiles: partial.changedFiles ?? [],
    failingCheckFingerprint: partial.failingCheckFingerprint ?? null,
    checkResults: partial.checkResults ?? [],
    memory: partial.memory ?? null,
    terminal: partial.terminal ?? null,
  };
}
