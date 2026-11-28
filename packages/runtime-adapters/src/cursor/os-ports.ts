import type { ChildProcess } from "node:child_process";
import { OsWindowsJob, sharedAllowlistProxy, sharedAttemptMcp } from "../acp/os-boundary.js";
import type { LoopbackAllowlistProxyPort, LeasedMcpServerPort, WindowsJobSupervisorPort } from "./ports.js";
import type { SandboxTierId } from "./types.js";

/**
 * Production job. Windows uses WindowsJobObjectManager. Other hosts use the POSIX process group.
 */
export class OsCursorJob implements WindowsJobSupervisorPort {
  private readonly inner = new OsWindowsJob();

  create(sessionId: string): Promise<{ readonly jobId: string }> {
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

export class AllowlistCursorProxy implements LoopbackAllowlistProxyPort {
  private pending: Promise<{ readonly endpoint: string }> | null = null;

  bind(input: { readonly sessionId: string; readonly tier: SandboxTierId }): Promise<{ readonly endpoint: string }> {
    void input;
    this.pending ??= sharedAllowlistProxy("cursor").then((server) => ({ endpoint: server.proxyUrl }));
    return this.pending;
  }
}

export class AttemptMcpCursorLease implements LeasedMcpServerPort {
  async lease(input: { readonly sessionId: string; readonly tools: readonly string[] }) {
    const shared = await sharedAttemptMcp();
    return {
      leaseId: `${shared.leaseId}-${input.sessionId}`,
      endpoint: shared.endpoint,
      tools: input.tools,
    };
  }
}

export async function settle<T>(value: T | Promise<T>): Promise<T> {
  return value;
}

export function trackChild(child: ChildProcess): number | null {
  return typeof child.pid === "number" ? child.pid : null;
}
