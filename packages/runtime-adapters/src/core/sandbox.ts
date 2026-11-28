import { SupervisionError } from "./errors.js";
import type { ModeSelection } from "./mode.js";
import type {
  LeasedMcpServerPort,
  LoopbackAllowlistProxyPort,
  McpLease,
  ProxyBinding,
  SandboxTierChoice,
  WindowsJobSupervisorPort,
} from "./ports.js";
import { DEFAULT_LEASED_MCP_TOOLS } from "./ports.js";
import type { ForeignRuntimeId, SandboxTierId } from "./types.js";

export interface SandboxEnvelope {
  readonly sessionId: string;
  readonly runtime: ForeignRuntimeId;
  readonly jobId: string;
  readonly tier: SandboxTierId;
  readonly tierReason: string;
  readonly proxy: ProxyBinding;
  readonly mcp: McpLease;
  readonly mode: ModeSelection;
}

export interface SandboxPrepareInput {
  readonly sessionId: string;
  readonly runtime: ForeignRuntimeId;
  readonly choice: SandboxTierChoice;
  readonly mode: ModeSelection;
}

/**
 * Every foreign process starts inside a sandbox tier, a Windows job, and the
 * loopback allowlist proxy. Permission replies are not the only boundary.
 */
export class MandatorySandboxSupervisor {
  constructor(
    private readonly jobs: WindowsJobSupervisorPort,
    private readonly proxy: LoopbackAllowlistProxyPort,
    private readonly mcp: LeasedMcpServerPort,
  ) {}

  async prepare(input: SandboxPrepareInput): Promise<SandboxEnvelope> {
    if (input.choice.hold) {
      throw new SupervisionError("sandbox_unavailable", input.choice.reason);
    }
    const job = await this.jobs.create(input.sessionId);
    const proxy = await this.proxy.bind({ sessionId: input.sessionId, tier: input.choice.tier });
    const lease = await this.mcp.lease({
      sessionId: input.sessionId,
      tools: input.mode.mcpTools.length > 0 ? input.mode.mcpTools : DEFAULT_LEASED_MCP_TOOLS,
    });
    return {
      sessionId: input.sessionId,
      runtime: input.runtime,
      jobId: job.jobId,
      tier: input.choice.tier,
      tierReason: input.choice.reason,
      proxy,
      mcp: lease,
      mode: input.mode,
    };
  }

  attach(jobId: string, pid: number): void | Promise<void> {
    return this.jobs.attach(jobId, pid);
  }

  kill(jobId: string, reason: string): readonly number[] | Promise<readonly number[]> {
    return this.jobs.kill(jobId, reason);
  }
}
