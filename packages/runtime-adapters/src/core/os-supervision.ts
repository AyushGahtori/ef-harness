import { TelemetryDb } from "@ef-harness/db";
import { WindowsDpapiSecretsVault, capacityPools } from "@ef-harness/governor";
import { AttemptMcpServer } from "@ef-harness/mcp-server";
import { CompliancePolicyLocks } from "@ef-harness/providers";
import {
  AllowlistProxyServer,
  DEFAULT_ACTIVE_PROCESS_LIMIT,
  DEFAULT_JOB_MEMORY_BYTES,
  HarnessRunEngine,
  PosixProcessGroupSupervisor,
  SandboxTierSelector,
  WindowsJobObjectManager,
  type EnvProcessRow,
  type JobHandle,
  type ProcessSupervisor,
  type ProjectStateDb,
} from "@ef-harness/sandbox";
import { redactSecrets } from "@ef-harness/shared-observability";
import { bundledCorpusRoot } from "@ef-harness/corpus";
import type { JobAssignment, WindowsJobSupervisorPort } from "./ports.js";

const FOREIGN_LIMITS = {
  memoryBytes: DEFAULT_JOB_MEMORY_BYTES,
  activeProcessLimit: DEFAULT_ACTIVE_PROCESS_LIMIT,
} as const;

export class MemoryEnvProcessRegistry implements ProjectStateDb {
  private rows: EnvProcessRow[] = [];

  insertEnvProcess(row: EnvProcessRow): void {
    this.rows.push(row);
  }

  insertEnvProcesses(rows: readonly EnvProcessRow[]): void {
    this.rows.push(...rows);
  }

  deleteEnvProcess(pid: number, startTime: number): void {
    this.rows = this.rows.filter((row) => row.pid !== pid || row.startTime !== startTime);
  }

  listEnvProcesses(): readonly EnvProcessRow[] {
    return this.rows;
  }

  close(): void {
    this.rows = [];
  }
}

/**
 * Real OS job supervisor. Windows uses `WindowsJobObjectManager` (`KILL_ON_JOB_CLOSE`).
 * Other platforms use `PosixProcessGroupSupervisor`.
 */
export class OsJobSupervisor implements WindowsJobSupervisorPort {
  private readonly native: ProcessSupervisor;
  private readonly handles = new Map<string, { handle: JobHandle; pids: number[] }>();

  constructor(registry: ProjectStateDb) {
    this.native =
      process.platform === "win32"
        ? new WindowsJobObjectManager({ registry })
        : new PosixProcessGroupSupervisor(registry);
  }

  async create(sessionId: string): Promise<JobAssignment> {
    const handle = await this.native.createJob({
      name: sessionId,
      kind: "environment",
      limits: FOREIGN_LIMITS,
    });
    this.handles.set(handle.id, { handle, pids: [] });
    return { jobId: handle.id };
  }

  async attach(jobId: string, pid: number): Promise<void> {
    const live = this.require(jobId);
    await this.native.assignProcess(live.handle, pid, {
      environment: jobId,
      role: "foreign-runtime",
    });
    live.pids.push(pid);
  }

  list(jobId: string): readonly number[] {
    return [...this.require(jobId).pids];
  }

  async kill(jobId: string, reason: string): Promise<readonly number[]> {
    const live = this.require(jobId);
    void reason;
    await this.native.terminateJob(live.handle);
    const pids = [...live.pids];
    live.pids.length = 0;
    return pids;
  }

  private require(jobId: string): { handle: JobHandle; pids: number[] } {
    const live = this.handles.get(jobId);
    if (!live) throw new Error(`Unknown job ${jobId}`);
    return live;
  }
}

export function supervisionCatalog(): {
  readonly jobs: "WindowsJobObjectManager" | "PosixProcessGroupSupervisor";
  readonly proxy: string;
  readonly tier: string;
  readonly engine: string;
  readonly mcp: string;
  readonly vault: string;
  readonly cap: string;
  readonly redactor: string;
  readonly corpusRoot: string;
  readonly policy: string;
  readonly telemetry: string;
} {
  return {
    jobs: process.platform === "win32" ? "WindowsJobObjectManager" : "PosixProcessGroupSupervisor",
    proxy: AllowlistProxyServer.name,
    tier: SandboxTierSelector.name,
    engine: HarnessRunEngine.name,
    mcp: AttemptMcpServer.name,
    vault: WindowsDpapiSecretsVault.name,
    cap: capacityPools.SessionProcessCapGuard.name,
    redactor: redactSecrets.name,
    corpusRoot: bundledCorpusRoot(),
    policy: CompliancePolicyLocks.name,
    telemetry: TelemetryDb.name,
  };
}
