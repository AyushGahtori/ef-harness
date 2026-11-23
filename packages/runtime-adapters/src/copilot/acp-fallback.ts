import type { AcpLaunchSpec, CopilotRuntimeDeps, GenericAcpAdapterPort, GenericAcpSessionPort } from "./ports.js";
import {
  CopilotSessionRuntime,
  type CopilotVendorLauncher,
  type VendorOpenInput,
  type VendorSessionHandle,
} from "./session-runtime.js";

export const COPILOT_ACP_ARGV = ["copilot", "--acp", "--stdio"] as const;

export class CopilotAcpFallbackAdapter extends CopilotSessionRuntime {
  constructor(deps: CopilotRuntimeDeps) {
    super(deps, new AcpVendorLauncher(deps.acp));
  }
}

class AcpVendorLauncher implements CopilotVendorLauncher {
  readonly transport = "acp" as const;

  constructor(private readonly acp: GenericAcpAdapterPort) {}

  async probe(): Promise<{ readonly installed: boolean; readonly version: string }> {
    const probed = await this.acp.probe();
    return { installed: probed.installed, version: probed.version };
  }

  listModels(): ReturnType<GenericAcpAdapterPort["listModels"]> {
    return this.acp.listModels();
  }

  authProbe(token: string): ReturnType<GenericAcpAdapterPort["authStatus"]> {
    return this.acp.authStatus(token);
  }

  accountGetQuota(): Promise<unknown> {
    return this.acp.accountGetQuota();
  }

  async open(input: VendorOpenInput): Promise<VendorSessionHandle> {
    return adaptAcpSession(await this.acp.startSession(launchSpec(input)));
  }

  async resume(vendorSessionId: string, input: VendorOpenInput): Promise<VendorSessionHandle | null> {
    const session = await this.acp.loadSession(vendorSessionId, launchSpec(input));
    return session ? adaptAcpSession(session) : null;
  }
}

function launchSpec(input: VendorOpenInput): AcpLaunchSpec {
  return {
    argv: COPILOT_ACP_ARGV,
    cwd: input.spec.worktree,
    sessionConfigDir: input.configDir,
    gitHubToken: input.gitHubToken,
    excludedTools: input.excludedTools,
    mcpServers: input.mcpServers,
    onPermissionRequest: async (request) => {
      const result = input.onPermission(request);
      return {
        kind: result.effect === "allow" ? "approved" : "denied",
        reason: result.reason,
      };
    },
    billingMode: input.spec.billing.mode,
    byok: input.byok,
    proxyUrl: input.proxyUrl,
    sandboxTier: input.sandboxTier,
  };
}

function adaptAcpSession(session: GenericAcpSessionPort): VendorSessionHandle {
  return {
    vendorSessionId: session.id,
    resumeSupported: session.resumeSupported,
    pid: session.pid,
    send: (prompt) => session.prompt(prompt),
    steer: (note) => session.steer(note),
    interrupt: () => session.cancel(),
    getMetrics: () => session.usageUpdate(),
  };
}
