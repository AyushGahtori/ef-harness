import { CopilotAdapterError } from "./errors.js";
import { CopilotAcpFallbackAdapter } from "./acp-fallback.js";
import type { CopilotRuntimeDeps } from "./ports.js";
import { CopilotSdkBridge } from "./sdk-bridge.js";
import type { CopilotSessionRuntime } from "./session-runtime.js";
import type {
  AgentRuntimeAdapter,
  CopilotAuthStatus,
  CopilotCheckpointRef,
  CopilotInterruptResult,
  CopilotProbeResult,
  CopilotResumeResult,
  CopilotSessionRef,
  CopilotSessionSpec,
  CopilotSteerResult,
  CopilotTurnReceipt,
  NormalizedRuntimeEvent,
  NormalizedUsage,
  PermissionApplyResult,
  PermissionResponse,
} from "./types.js";

export class CopilotRuntimeAdapter implements AgentRuntimeAdapter {
  readonly runtime = "copilot" as const;
  readonly sdk: CopilotSdkBridge;
  readonly acp: CopilotAcpFallbackAdapter;
  private readonly route = new Map<string, CopilotSessionRuntime>();

  constructor(private readonly deps: CopilotRuntimeDeps) {
    this.sdk = new CopilotSdkBridge(deps);
    this.acp = new CopilotAcpFallbackAdapter(deps);
  }

  probe(): Promise<CopilotProbeResult> {
    return this.selected().probe();
  }

  authStatus(connectionId: string): Promise<CopilotAuthStatus> {
    return this.selected().authStatus(connectionId);
  }

  async startSession(spec: CopilotSessionSpec): Promise<CopilotSessionRef> {
    const transport = spec.transport ?? this.deps.policy.preferredTransport();
    const bridge = this.bridge(transport);
    const ref = await bridge.startSession({ ...spec, transport });
    this.route.set(ref.sessionId, bridge);
    return ref;
  }

  sendTurn(sessionId: string, briefOrPrompt: string): Promise<CopilotTurnReceipt> {
    return this.owner(sessionId).sendTurn(sessionId, briefOrPrompt);
  }

  steer(sessionId: string, deltaNote: string): Promise<CopilotSteerResult> {
    return this.owner(sessionId).steer(sessionId, deltaNote);
  }

  interrupt(sessionId: string): Promise<CopilotInterruptResult> {
    return this.owner(sessionId).interrupt(sessionId);
  }

  async resume(sessionId: string, checkpointRef: CopilotCheckpointRef | string): Promise<CopilotResumeResult> {
    const ref = typeof checkpointRef === "string" ? { attemptId: checkpointRef } : checkpointRef;
    const row = this.deps.checkpoints.get(ref.attemptId);
    const bridge = row?.transport === "acp" ? this.acp : this.route.get(sessionId) ?? this.sdk;
    const result = await bridge.resume(sessionId, checkpointRef);
    if (result.sessionId) this.route.set(result.sessionId, bridge);
    return result;
  }

  events(sessionId: string): AsyncIterable<NormalizedRuntimeEvent> {
    return this.owner(sessionId).events(sessionId);
  }

  respondPermission(
    sessionId: string,
    requestId: string,
    decision: PermissionResponse,
  ): Promise<PermissionApplyResult> {
    return this.owner(sessionId).respondPermission(sessionId, requestId, decision);
  }

  usage(sessionId: string): Promise<NormalizedUsage> {
    return this.owner(sessionId).usage(sessionId);
  }

  terminate(sessionId: string): Promise<CopilotInterruptResult> {
    return this.interrupt(sessionId);
  }

  async dispose(): Promise<void> {
    const ids = [...this.route.keys()];
    for (const id of ids) {
      try {
        await this.interrupt(id);
      } catch {
        continue;
      }
    }
  }

  recordedEvents(sessionId: string): readonly NormalizedRuntimeEvent[] {
    return this.owner(sessionId).recordedEvents(sessionId);
  }

  permissionResult(requestId: string): PermissionApplyResult | null {
    return this.sdk.permissionResult(requestId) ?? this.acp.permissionResult(requestId);
  }

  approvePaidOverage(connectionId: string, resetDateUtc: string): void {
    this.sdk.approvePaidOverage(connectionId, resetDateUtc);
  }

  private selected(): CopilotSessionRuntime {
    return this.deps.policy.preferredTransport() === "acp" ? this.acp : this.sdk;
  }

  private bridge(transport: "sdk" | "acp"): CopilotSessionRuntime {
    return transport === "acp" ? this.acp : this.sdk;
  }

  private owner(sessionId: string): CopilotSessionRuntime {
    const bridge = this.route.get(sessionId);
    if (!bridge) throw new CopilotAdapterError("unknown_session", "Copilot session was not found");
    return bridge;
  }
}
