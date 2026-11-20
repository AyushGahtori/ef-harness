import type {
  AttemptRecord,
  CheckpointRow,
  CheckObservation,
  CrashPoint,
  CrashSite,
  ModelProfileView,
  PendingEffect,
  ProviderItem,
  TaskPacketView,
  ToolBody,
  ToolCall,
  TurnLogRow,
  WorkingMemory,
} from "./types.js";

export interface AttemptCoordinator {
  getAttempt(id: string): AttemptRecord;
  turns(id: string): readonly TurnLogRow[];
  checkpoint(id: string): CheckpointRow | null;
  items(artifactId: string): readonly ProviderItem[] | null;
  transaction<T>(fn: () => T): T;
  updateAttempt(id: string, patch: Partial<AttemptRecord>): void;
  appendTurn(row: TurnLogRow): void;
  saveCheckpoint(row: CheckpointRow): void;
  putItems(artifactId: string, items: readonly ProviderItem[]): void;
}

export interface HistoryView {
  step: number;
  toolCall: string | null;
  resultSummary: string | null;
  items: readonly ProviderItem[];
}

export interface ContextBuildInput {
  packet: TaskPacketView;
  profile: ModelProfileView;
  workingMemory: WorkingMemory;
  history: readonly HistoryView[];
  step: number;
  briefVersion: number;
  contradiction: boolean;
  wipDiff: string | null;
  wipRef: string | null;
  steerNotice: string | null;
  contextOverflow: boolean;
}

export interface BuiltContext {
  status: "ok";
  requestDigest: string;
  body: string;
  zones: readonly ["kernel", "must", "should", "working_memory", "history", "tail"];
  rebuiltFromContradiction: boolean;
  briefVersion: number;
  replayItems: ProviderItem[];
  store: false;
  tightened: boolean;
}

export type ContextBuildResult =
  | BuiltContext
  | { status: "task_too_large_for_model"; mustTokens: number; windowTokens: number }
  | { status: "park_after_context_overflow"; mustTokens: number; windowTokens: number };

export interface ContextBuilderPort {
  buildRequest(input: ContextBuildInput): ContextBuildResult;
}

export interface ModelTurnRequest {
  attemptId: string;
  step: number;
  store: false;
  model: string;
  requestDigest: string;
  body: string;
  replayItems: readonly ProviderItem[];
  tools: readonly string[];
  clientRequestId: string;
  idempotencyKey: string;
  briefVersion: number;
  rebuiltFromContradiction: boolean;
  zones: BuiltContext["zones"];
}

export interface ModelInvokeOptions {
  signal: AbortSignal;
  stallTimeoutMs: number;
}

export type LoopStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_item"; encryptedContent: string; canonicalJson: string }
  | { type: "tool_call"; callId: string; name: string; arguments: Record<string, unknown>; rawArguments: string }
  | { type: "malformed_tool_args"; callId: string; name: string; rawArguments: string; error: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "stop"; stopReason: "end_turn" | "tool_use" | "output_budget_cutoff" }
  | { type: "error"; error: unknown };

export interface ModelStreamPort {
  stream(request: ModelTurnRequest, options: ModelInvokeOptions): AsyncIterable<LoopStreamEvent>;
}

export interface BudgetLedgerPort {
  reserveAcrossScopes(input: {
    attemptId: string;
    amountUnits: number;
    purpose: "model_call";
  }): Promise<
    { ok: true; reservationId: string } | { ok: false; blockingScopes: string[] }
  >;
  settleReservation(
    reservationId: string,
    actualUnits: number,
  ): Promise<{ spentUnits: number; overrunUnits: number }>;
  releaseReservation(reservationId: string): Promise<void>;
  markReservationUnknown(reservationId: string): Promise<void>;
  reconcileUnknownReservation(
    reservationId: string,
  ): Promise<{ action: "settle" | "release"; actualUnits: number }>;
  listUnknownReservations(attemptId: string): Promise<readonly string[]>;
  getSpentUnits(attemptId: string): Promise<number>;
}

export interface CheckpointCommit {
  ref: string | null;
  wipRef: string | null;
  commitSha: string | null;
  treeSha: string;
  noChanges: boolean;
  reused: boolean;
  changedFiles: string[];
}

export interface CheckpointSnapshotPort {
  createCheckpointWipCommit(input: {
    attemptId: string;
    step: number;
    taskId: string;
    previousWipRef: string | null;
  }): Promise<CheckpointCommit>;
  resetWorktreeToRef(ref: string | null): Promise<{ treeSha: string }>;
  treeSha(): Promise<string>;
  diffFromRef(ref: string | null): Promise<string>;
  changedPathsSinceBase(): Promise<string[]>;
}

export interface EditFilesWritten {
  filesWritten: string[];
}

export interface EditToolDispatcherPort {
  availableTools(relativePath?: string): readonly string[];
  applyPatch(patchText: string): Promise<EditFilesWritten>;
  strReplace(path: string, oldText: string, newText: string): Promise<EditFilesWritten>;
  searchReplace(input: string): Promise<EditFilesWritten>;
  writeNewFile(path: string, content: string): Promise<EditFilesWritten>;
  replaceLines(
    path: string,
    start: number,
    end: number,
    text: string,
    rangeHash: string,
  ): Promise<EditFilesWritten>;
}

export interface WindowedFileReaderPort {
  readFile(path: string, range: { start: number; end: number } | null): Promise<ToolBody>;
  listFiles(glob: string): Promise<ToolBody>;
  grepFiles(pattern: string, glob: string | null): Promise<ToolBody>;
}

export interface HarnessRunPort {
  run(command: string): Promise<ToolBody>;
}

export interface ReadLogPort {
  readLog(artifactId: string, query: string | null): Promise<ToolBody>;
}

export interface KnowledgeToolPort {
  call(name: string, args: Record<string, unknown>): Promise<ToolBody>;
}

export interface NotesUpdatePort {
  apply(current: WorkingMemory, patch: Record<string, unknown>): WorkingMemory;
}

export interface AskOwnerPort {
  ask(question: string, criterionId: string | null): Promise<ToolBody>;
}

export interface FlagBlockedPort {
  flag(reason: string): Promise<ToolBody>;
}

export interface DisputeTestPort {
  dispute(checkId: string, counterexample: string): Promise<ToolBody>;
}

export interface SubmitCandidatePort {
  submit(input: { commitSha: string | null; changedPaths: readonly string[] }): Promise<ToolBody>;
}

export interface FormatterPort {
  format(paths: readonly string[]): Promise<readonly string[]>;
}

export interface PacingPort {
  waitForRateLimit(retryAfterMs: number): Promise<void>;
}

export interface ClockPort {
  now(): number;
}

export interface CrashInjectorPort {
  shouldCrash(point: CrashPoint, site: CrashSite): boolean;
  onCrash?(point: CrashPoint, site: CrashSite): void;
}

export interface NativeWorkerLoopDependencies {
  coordinator: AttemptCoordinator;
  model: ModelStreamPort;
  context: ContextBuilderPort;
  budget: BudgetLedgerPort;
  snapshots: CheckpointSnapshotPort;
  reader: WindowedFileReaderPort;
  edits: EditToolDispatcherPort;
  runner: HarnessRunPort;
  readLog: ReadLogPort;
  kb: KnowledgeToolPort;
  notes: NotesUpdatePort;
  askOwner: AskOwnerPort;
  flagBlocked: FlagBlockedPort;
  disputeTest: DisputeTestPort;
  submit: SubmitCandidatePort;
  formatter: FormatterPort;
  pacing: PacingPort;
  clock: ClockPort;
  crash?: CrashInjectorPort;
}

export interface CollectedTurn {
  items: ProviderItem[];
  toolCalls: ToolCall[];
  text: string;
  tokensIn: number;
  tokensOut: number;
  stopReason: "end_turn" | "tool_use" | "output_budget_cutoff";
}

export type { CheckObservation, PendingEffect };
