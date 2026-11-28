import type { CopilotSdkClientPort, CopilotSdkSessionConfig, CopilotSdkSessionPort } from "./ports.js";
import type { CopilotRuntimeDeps } from "./ports.js";
import { CopilotSessionRuntime, type CopilotVendorLauncher, type VendorOpenInput, type VendorSessionHandle } from "./session-runtime.js";

export class CopilotSdkBridge extends CopilotSessionRuntime {
  constructor(deps: CopilotRuntimeDeps) {
    super(deps, new SdkVendorLauncher(deps.sdk));
  }
}

class SdkVendorLauncher implements CopilotVendorLauncher {
  readonly transport = "sdk" as const;

  constructor(private readonly sdk: CopilotSdkClientPort) {}

  probe(): ReturnType<CopilotSdkClientPort["probe"]> {
    return this.sdk.probe();
  }

  listModels(): ReturnType<CopilotSdkClientPort["listModels"]> {
    return this.sdk.listModels();
  }

  authProbe(token: string): ReturnType<CopilotSdkClientPort["authStatus"]> {
    return this.sdk.authStatus(token);
  }

  accountGetQuota(): Promise<unknown> {
    return this.sdk.accountGetQuota();
  }

  async open(input: VendorOpenInput): Promise<VendorSessionHandle> {
    return adaptSdkSession(await this.sdk.createSession(sessionConfig(input)));
  }

  async resume(vendorSessionId: string, input: VendorOpenInput): Promise<VendorSessionHandle | null> {
    const session = await this.sdk.resumeSession(vendorSessionId, sessionConfig(input));
    return session ? adaptSdkSession(session) : null;
  }
}

function sessionConfig(input: VendorOpenInput): CopilotSdkSessionConfig {
  return {
    model: input.byok?.model ?? input.spec.model ?? null,
    workingDirectory: input.spec.worktree,
    onPermissionRequest: async (request) => {
      const result = input.onPermission(request);
      return {
        kind: result.effect === "allow" ? "approved" : "denied",
        reason: result.reason,
      };
    },
    excludedTools: input.excludedTools,
    mcpServers: input.mcpServers,
    sessionConfigDir: input.configDir,
    gitHubToken: input.gitHubToken,
    billingMode: input.spec.billing.mode,
    byok: input.byok,
    proxyUrl: input.proxyUrl,
    sandboxTier: input.sandboxTier,
    jobObjectId: input.jobObjectId,
  };
}

function adaptSdkSession(session: CopilotSdkSessionPort): VendorSessionHandle {
  return {
    vendorSessionId: session.id,
    resumeSupported: session.resumeSupported,
    pid: session.pid,
    send: (prompt) => session.send(prompt),
    steer: (note) => session.steer(note),
    interrupt: () => session.interrupt(),
    getMetrics: () => session.usage.getMetrics(),
  };
}
