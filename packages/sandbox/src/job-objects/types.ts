export const JOB_KINDS = ["project", "environment", "attempt", "command"] as const;

export type JobKind = (typeof JOB_KINDS)[number];

export type TerminationReason =
  | "exited"
  | "timeout"
  | "memory_limit_exceeded"
  | "terminated";

export interface JobLimits {
  readonly memoryBytes: number;
  readonly activeProcessLimit: number;
  readonly cpuRatePercent?: number;
}

export interface JobHandle {
  readonly id: string;
  readonly name: string;
  readonly kind: JobKind;
  readonly parentId: string | null;
  readonly limits: JobLimits;
  readonly requestedLimits: JobLimits;
  readonly limitsClamped: boolean;
  readonly timeoutMs: number | null;
}

export interface JobAccounting {
  readonly activeProcesses: number;
  readonly totalProcesses: number;
  readonly totalTerminatedProcesses: number;
  readonly peakJobMemoryBytes: number;
  readonly currentJobMemoryBytes: number;
  readonly peakProcessMemoryBytes: number;
  readonly jobMemoryLimitBytes: number;
  readonly processMemoryLimitBytes: number;
  readonly activeProcessLimit: number;
  readonly userCpuMs: number;
  readonly kernelCpuMs: number;
  readonly totalPageFaults: number;
  readonly limitFlags: number;
  readonly uiRestrictions: number;
  readonly cpuRatePercent: number | null;
  readonly killOnJobClose: boolean;
  readonly uiHandlesRestricted: boolean;
  readonly memoryLimitHit: boolean;
  readonly activeProcessLimitHit: boolean;
}

export interface JobSpec {
  readonly name: string;
  readonly kind: JobKind;
  readonly limits: JobLimits;
  readonly parent?: JobHandle;
  readonly timeoutMs?: number;
}

export interface EnvProcessRow {
  readonly pid: number;
  readonly startTime: number;
  readonly environment: string;
  readonly role: string;
  readonly port: number | null;
  readonly jobName: string | null;
}

export interface ProjectStateDb {
  insertEnvProcess(row: EnvProcessRow): void;
  insertEnvProcesses(rows: readonly EnvProcessRow[]): void;
  deleteEnvProcess(pid: number, startTime: number): void;
  listEnvProcesses(): readonly EnvProcessRow[];
  close(): void;
}

export type ProcessInspection =
  | {
      readonly status: "alive";
      readonly pid: number;
      readonly startTime: number;
      readonly imagePath: string | null;
      readonly commandLine: string | null;
    }
  | { readonly status: "not_found"; readonly pid: number }
  | { readonly status: "unverified"; readonly pid: number; readonly detail: string };

export interface OrphanSweepEntry {
  readonly pid: number;
  readonly startTime: number;
  readonly action: "terminated" | "skipped_pid_reuse" | "left_intact" | "already_exited";
  readonly detail: string;
}

export interface OrphanSweepReport {
  readonly terminated: readonly OrphanSweepEntry[];
  readonly skipped: readonly OrphanSweepEntry[];
  readonly alreadyExited: readonly OrphanSweepEntry[];
  readonly leftIntact: readonly OrphanSweepEntry[];
}

export interface SpawnRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly environment: string;
  readonly role: string;
  readonly port?: number;
  readonly resume?: boolean;
}

export interface SpawnedProcess {
  readonly slot: number;
  readonly pid: number;
  readonly startTime: number;
  readonly imagePath: string | null;
  readonly commandLine: string | null;
}

export interface CommandRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly limits: JobLimits;
  readonly environment: string;
  readonly role: string;
  readonly port?: number;
  readonly jobName?: string;
}

export interface ProcessAssignment {
  readonly environment: string;
  readonly role: string;
  readonly port?: number;
}

export interface ProcessSupervisor {
  createJob(spec: JobSpec): Promise<JobHandle>;
  assignProcess(job: JobHandle, pid: number, meta?: ProcessAssignment): Promise<SpawnedProcess>;
  spawnInJob(job: JobHandle, request: SpawnRequest): Promise<SpawnedProcess>;
  queryJobAccounting(job: JobHandle): Promise<JobAccounting>;
  terminateJob(job: JobHandle): Promise<JobAccounting>;
  closeJob(job: JobHandle): Promise<void>;
  runCommand(parent: JobHandle | null, request: CommandRequest): Promise<CommandResult>;
  reconcileOrphanedProcesses(): Promise<OrphanSweepReport>;
  dispose(): Promise<void>;
}

export interface CommandResult {
  readonly reason: TerminationReason;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly accounting: JobAccounting;
  readonly pid: number;
  readonly startTime: number;
  readonly durationMs: number;
  readonly job: JobHandle;
}

export interface JobProcessInfo {
  readonly pid: number;
  readonly imagePath: string | null;
}

export class JobObjectError extends Error {
  readonly code: string;
  readonly win32: number | null;

  constructor(code: string, message: string, win32?: number) {
    super(message);
    this.name = "JobObjectError";
    this.code = code;
    this.win32 = win32 ?? null;
  }
}
