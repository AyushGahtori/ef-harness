export const SANDBOX_TIERS = ["A", "B", "C", "D", "UNSANDBOXED"] as const;
export type SandboxTier = (typeof SANDBOX_TIERS)[number];

export const EXECUTION_MODES = ["own_loop", "wrapped", "stripped"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const RUN_PRIORITIES = ["verifier", "worker", "background"] as const;
export type RunPriority = (typeof RUN_PRIORITIES)[number];

export type RetentionClass = "ephemeral" | "evidence" | "diagnostic" | "asset" | "research";

export type TerminationReason =
  | "completed"
  | "timeout"
  | "output_limit_exceeded"
  | "memory_limit_exceeded";

export interface RegisteredSecret {
  readonly label: string;
  readonly value: string;
}

export interface SandboxedCommandRequest {
  readonly attemptId: string;
  readonly projectId?: string;
  readonly taskId?: string;
  readonly worktreePath: string;
  readonly cwd?: string;
  readonly command: string | readonly string[];
  readonly timeoutMs?: number;
  readonly memoryBytes?: number;
  readonly processLimit?: number;
  readonly maxArtifactBytes?: number;
  readonly priority?: RunPriority;
  readonly secrets?: readonly RegisteredSecret[];
  readonly attemptTempDir?: string;
  readonly traceParentId?: string;
}

export interface SandboxedCommandResult {
  readonly tier: SandboxTier;
  readonly mode: ExecutionMode;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly oomKilled: boolean;
  readonly artifactId: string;
  readonly omittedLines: number;
  readonly failureFingerprint: string | null;
  readonly durationMs: number;
  readonly peakMemoryBytes: number;
  readonly truncated: boolean;
  readonly outputLimitExceeded: boolean;
  readonly terminationReason: TerminationReason;
  readonly summary: string;
  readonly stdoutSummary: string;
  readonly stderrSummary: string;
  readonly toolSummary: string;
  readonly hint: string | null;
  readonly nodeModulesReadOnly: true;
  readonly commandId: string;
}

export interface ExecutionSlot {
  readonly slotId: string;
  readonly tier: SandboxTier;
  readonly mode: ExecutionMode;
  readonly nodeModulesReadOnly: true;
  release(): void;
}

export interface SandboxTierSelector {
  acquire(request: {
    readonly priority: RunPriority;
    readonly attemptId: string;
  }): Promise<ExecutionSlot>;
}

export interface JobLimits {
  readonly memoryBytes: number;
  readonly activeProcessLimit: number;
  readonly killOnJobClose: true;
  readonly timeoutMs: number;
}

export interface JobRedirect {
  readonly kind: "stdout" | "stdout_append" | "stderr" | "stderr_append" | "stdin" | "merge_stderr";
  readonly target: string;
}

export interface JobStep {
  readonly operator: "none" | "and" | "or" | "semi" | "pipe";
  readonly argv: readonly string[];
  readonly redirects: readonly JobRedirect[];
}

export interface JobRunPlan {
  readonly cwd: string;
  readonly env: readonly string[];
  readonly steps: readonly JobStep[];
}

export interface JobRunHandlers {
  onStdout(chunk: Buffer): void;
  onStderr(chunk: Buffer): void;
  shouldAbort(): { readonly abort: boolean; readonly reason: string };
}

export interface JobRunResult {
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly oomKilled: boolean;
  readonly peakMemoryBytes: number;
  readonly outputLimitExceeded: boolean;
  readonly terminationReason: TerminationReason;
}

export interface CommandJob {
  run(plan: JobRunPlan, handlers: JobRunHandlers): Promise<JobRunResult>;
  close(): void;
}

export interface WindowsJobManager {
  createJob(limits: JobLimits): CommandJob;
}

export interface StoreArtifactRequest {
  readonly body: Buffer;
  readonly retention: RetentionClass;
  readonly attemptId: string;
  readonly kind: string;
}

export interface ArtifactRecord {
  readonly artifactId: string;
  readonly byteLength: number;
  readonly retention: RetentionClass;
  readonly seekable: boolean;
  readonly lineCount: number;
  readonly format: "plain" | "zstd-seekable";
}

export interface LogRange {
  readonly lines: readonly string[];
  readonly totalLines: number;
  readonly truncated: boolean;
}

export interface ArtifactManager {
  storeArtifact(request: StoreArtifactRequest): Promise<ArtifactRecord>;
  readLogRange(artifactId: string, startLine: number, endLine: number): Promise<LogRange>;
  readRaw(artifactId: string): Promise<Buffer>;
  promoteRetention(artifactId: string, retention: "evidence"): Promise<void>;
}

export interface TraceAttributes {
  readonly [key: string]: string | number | boolean | null;
}

export interface LocalTracer {
  startSpan(
    name: string,
    parentSpanId?: string,
  ): {
    readonly traceId: string;
    readonly spanId: string;
    end(status: "ok" | "error", attributes: TraceAttributes): void;
  };
}

export interface DenialRecord {
  readonly rule: string;
  readonly reason: string;
  readonly command: string;
  readonly attemptId: string;
  readonly at: string;
}

export interface DenialLogger {
  logDenial(record: DenialRecord): void;
}

export interface ProgressEvent {
  readonly commandId: string;
  readonly stream: "stdout" | "stderr";
  readonly bytes: number;
  readonly lines: number;
  readonly truncated: boolean;
}

export interface TelemetrySink {
  writeProgress(attemptId: string, event: ProgressEvent): void;
  close(): void;
}
