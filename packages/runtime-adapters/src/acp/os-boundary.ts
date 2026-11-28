import os from "node:os";
import net from "node:net";
import { AttemptMcpServer, type AttemptMcpDependencies } from "@ef-harness/mcp-server";
import { AllowlistProxyServer, PORT_LEASE_MAX, PORT_LEASE_MIN, type PortLease } from "@ef-harness/sandbox";
import { DeterministicSupervisionPolicyEngine } from "../core/policy.js";
import type { SupervisionContext as CoreSupervisionContext } from "../core/policy.js";
import type { PolicyDecision as CorePolicyDecision, SupervisionRequest as CoreSupervisionRequest } from "../core/types.js";
import { MemoryEnvProcessRegistry, OsJobSupervisor } from "../core/os-supervision.js";
import type { SupervisionContext, SupervisionPolicyPort } from "./policy.js";
import type { WindowsJobPort } from "./job.js";

/**
 * Real OS job. Windows uses `WindowsJobObjectManager` (`KILL_ON_JOB_CLOSE`).
 * Other platforms use `PosixProcessGroupSupervisor`.
 */
export class OsWindowsJob implements WindowsJobPort {
  private readonly jobs: OsJobSupervisor;

  constructor() {
    this.jobs = new OsJobSupervisor(new MemoryEnvProcessRegistry());
  }

  create(sessionId: string): Promise<{ readonly jobId: string }> {
    return this.jobs.create(sessionId);
  }

  attach(jobId: string, pid: number): Promise<void> {
    return this.jobs.attach(jobId, pid);
  }

  list(jobId: string): readonly number[] {
    return this.jobs.list(jobId);
  }

  activeChildCount(jobId: string): number {
    return this.list(jobId).length;
  }

  kill(jobId: string, reason: string): Promise<readonly number[]> {
    return this.jobs.kill(jobId, reason);
  }

  async close(jobId: string): Promise<void> {
    await this.jobs.kill(jobId, "close");
  }
}

let sharedProxy: Promise<AllowlistProxyServer> | null = null;

export function sharedAllowlistProxy(projectId: string): Promise<AllowlistProxyServer> {
  sharedProxy ??= openAllowlistProxy(projectId);
  return sharedProxy;
}

let sharedMcp: Promise<{ readonly endpoint: string; readonly leaseId: string }> | null = null;

/**
 * One AttemptMcpServer loopback lease for foreign runtimes.
 * The port is chosen by the kernel listener, never a hardcoded discard port.
 */
export function sharedAttemptMcp(): Promise<{ readonly endpoint: string; readonly leaseId: string }> {
  sharedMcp ??= openAttemptMcp();
  return sharedMcp;
}

async function openAttemptMcp(): Promise<{ readonly endpoint: string; readonly leaseId: string }> {
  const attemptId = "runtime-adapter";
  const bearerToken = ["ef", "attempt", "lease"].join("-");
  const server = new AttemptMcpServer({
    lease: {
      projectId: "runtime",
      taskId: "adapter",
      attemptId,
      epoch: 1,
      bearerToken,
      worktreePath: os.tmpdir(),
      baseCommit: "adapter",
    },
    packet: {
      schema: "task-packet@1",
      task: "adapter",
      attempt: attemptId,
      epoch: 1,
      brief_version: 1,
      base: { branch: "harness/integration", commit: "adapter" },
      goal: "Lease the attempt MCP endpoint",
      write_scope: ["src/**"],
      tools: ["kb.get"],
    },
    dependencies: idleAttemptDependencies(),
  });
  const endpoint = await server.listenLoopback();
  return { endpoint: endpoint.streamableUrl, leaseId: `lease-${attemptId}` };
}

function idleAttemptDependencies(): AttemptMcpDependencies {
  const idle: unknown = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") return undefined;
        return () => Promise.resolve(null);
      },
    },
  );
  return idle as AttemptMcpDependencies;
}

export async function openAllowlistProxy(projectId: string): Promise<AllowlistProxyServer> {
  const port = await reserveLeasePort();
  const now = Date.now();
  const lease: PortLease = {
    port,
    projectId,
    environment: projectId,
    leasedAt: now,
    expiresAt: null,
  };
  const server = new AllowlistProxyServer({ portLease: lease });
  await server.start();
  return server;
}

/** Task 142 permission checks. Shell redirect stays a non-allow so the host bridge runs the command. */
export class CoreSupervisionPolicy implements SupervisionPolicyPort {
  private readonly engine = new DeterministicSupervisionPolicyEngine();

  decide(context: SupervisionContext, request: CoreSupervisionRequest): CorePolicyDecision {
    return this.engine.decide(request, coreContext(context));
  }
}

export class CoreCodexPolicy {
  private readonly engine = new DeterministicSupervisionPolicyEngine();

  decide(input: {
    readonly worktreeRoot: string;
    readonly writeScope: readonly string[];
    readonly request: { readonly kind: "edit"; readonly path: string } | { readonly kind: "shell"; readonly command: string };
  }): { readonly effect: "allow" | "deny"; readonly reason: string; readonly elapsedMs: number } {
    const request: CoreSupervisionRequest =
      input.request.kind === "shell"
        ? { kind: "shell", command: input.request.command }
        : { kind: "edit", path: input.request.path };
    const decision = this.engine.decide(request, {
      sessionId: "codex",
      worktreeRoot: input.worktreeRoot,
      cwd: input.worktreeRoot,
      writeScope: input.writeScope,
      readOnlyPaths: [],
      sealedPaths: [],
      mode: "wrapped",
      homeDir: "",
      appData: "",
      leasedTools: ["kb.*", "harness.run", "harness.read_result"],
    });
    if (decision.effect === "allow") {
      return { effect: "allow", reason: "allow", elapsedMs: decision.elapsedMs };
    }
    return {
      effect: "deny",
      reason: decision.reason,
      elapsedMs: decision.elapsedMs,
    };
  }
}

function coreContext(context: SupervisionContext): CoreSupervisionContext {
  return {
    sessionId: "acp",
    worktreeRoot: context.worktreeRoot,
    cwd: context.cwd ?? context.worktreeRoot,
    writeScope: context.writeScope,
    readOnlyPaths: [],
    sealedPaths: [],
    mode: context.mode,
    homeDir: context.homeDir ?? "",
    appData: context.appData ?? "",
    leasedTools: context.leasedTools ?? ["kb.*", "harness.run", "harness.read_result"],
  };
}

function reserveLeasePort(): Promise<number> {
  const span = PORT_LEASE_MAX - PORT_LEASE_MIN;
  const start = PORT_LEASE_MIN + Math.floor(Math.random() * span);
  return tryPort(start, span, 0);
}

function tryPort(start: number, span: number, offset: number): Promise<number> {
  if (offset >= 80) return Promise.reject(new Error("no allowlist proxy port is free"));
  const port = PORT_LEASE_MIN + ((start - PORT_LEASE_MIN + offset) % span);
  return canListen(port).then((free) => (free ? port : tryPort(start, span, offset + 1)));
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}
