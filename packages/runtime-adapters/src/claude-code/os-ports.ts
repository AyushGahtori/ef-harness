import { OsWindowsJob, sharedAllowlistProxy, sharedAttemptMcp } from "../acp/os-boundary.js";
import type {
  JobAssignment,
  LeasedMcpServerPort,
  LoopbackAllowlistProxyPort,
  McpLease,
  ProxyBinding,
  WindowsJobSupervisorPort,
} from "./ports.js";

export class OsClaudeJob implements WindowsJobSupervisorPort {
  private readonly inner = new OsWindowsJob();

  create(sessionId: string): Promise<JobAssignment> {
    return this.inner.create(sessionId);
  }

  attach(jobId: string, pid: number): Promise<void> {
    return this.inner.attach(jobId, pid);
  }

  list(jobId: string): readonly number[] {
    return this.inner.list(jobId);
  }

  kill(jobId: string, reason: string): Promise<readonly number[]> {
    return this.inner.kill(jobId, reason);
  }
}

export class AllowlistClaudeProxy implements LoopbackAllowlistProxyPort {
  private pending: Promise<string> | null = null;

  bind(input: { readonly sessionId: string; readonly connectionId: string }): Promise<ProxyBinding> {
    this.pending ??= sharedAllowlistProxy("claude-code").then((server) => server.proxyUrl);
    return this.pending.then((endpoint) => ({
      endpoint,
      env: {
        HTTP_PROXY: endpoint,
        HTTPS_PROXY: endpoint,
        NO_PROXY: "127.0.0.1,localhost",
        EF_HARNESS_PROXY_AUTH: input.connectionId,
        EF_HARNESS_PROXY_SESSION: input.sessionId,
      },
    }));
  }
}

export class AttemptMcpClaudeLease implements LeasedMcpServerPort {
  async lease(input: { readonly sessionId: string; readonly tools: readonly string[] }): Promise<McpLease> {
    const shared = await sharedAttemptMcp();
    return {
      leaseId: `${shared.leaseId}-${input.sessionId}`,
      endpoint: shared.endpoint,
      tools: input.tools,
    };
  }
}
