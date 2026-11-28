import { CursorAdapterError } from "./errors.js";
import type { CursorRuntimeDeps } from "./ports.js";
import { SupervisedCursorRuntime } from "./runtime.js";
import { CursorLocalSdkBridge } from "./sdk-bridge.js";
import type {
  AgentRuntimeAdapter,
  CursorAuthStatus,
  CursorCheckpointRef,
  CursorInterruptReceipt,
  CursorProbeResult,
  CursorResumeResult,
  CursorSessionRef,
  CursorSessionSpec,
  CursorSteerReceipt,
  CursorTransportKind,
  CursorTurnReceipt,
  NormalizedRuntimeEvent,
  NormalizedUsage,
  PermissionApplyResult,
  PermissionDecision,
} from "./types.js";

export class CursorRuntimeAdapter implements AgentRuntimeAdapter {
  readonly runtime = "cursor" as const;
  private sdkBridge: CursorLocalSdkBridge | null = null;
  private acpBridge: SupervisedCursorRuntime | null = null;
  private readonly owners = new Map<string, CursorTransportKind>();

  constructor(private readonly deps: CursorRuntimeDeps) {}

  async probe(): Promise<CursorProbeResult> {
    return this.bridgeFor(await this.choose()).probe();
  }

  async authStatus(connectionId?: string): Promise<CursorAuthStatus> {
    return this.bridgeFor(await this.choose()).authStatus(connectionId);
  }

  async startSession(spec: CursorSessionSpec): Promise<CursorSessionRef> {
    const kind = spec.transport ?? (await this.choose());
    const ref = await this.bridgeFor(kind).startSession(spec);
    this.owners.set(ref.sessionId, kind);
    return ref;
  }

  sendTurn(sessionId: string, briefOrPrompt: string): Promise<CursorTurnReceipt> {
    return this.owner(sessionId).sendTurn(sessionId, briefOrPrompt);
  }

  steer(sessionId: string, deltaNote: string): Promise<CursorSteerReceipt> {
    return this.owner(sessionId).steer(sessionId, deltaNote);
  }

  interrupt(sessionId: string): Promise<CursorInterruptReceipt> {
    return this.owner(sessionId).interrupt(sessionId);
  }

  resume(sessionId: string, checkpointRef: CursorCheckpointRef | string): Promise<CursorResumeResult> {
    return this.owner(sessionId).resume(sessionId, checkpointRef);
  }

  events(sessionId: string): AsyncIterable<NormalizedRuntimeEvent> {
    return this.owner(sessionId).events(sessionId);
  }

  respondPermission(
    sessionId: string,
    requestId: string,
    decision: PermissionDecision,
  ): Promise<PermissionApplyResult> {
    return this.owner(sessionId).respondPermission(sessionId, requestId, decision);
  }

  usage(sessionId: string): Promise<NormalizedUsage> {
    return this.owner(sessionId).usage(sessionId);
  }

  terminate(sessionId: string): ReturnType<SupervisedCursorRuntime["terminate"]> {
    return this.owner(sessionId).terminate(sessionId);
  }

  dispose(): Promise<void> {
    const pending = [this.sdkBridge?.dispose(), this.acpBridge?.dispose()].filter(
      (item): item is Promise<void> => item !== undefined,
    );
    return Promise.all(pending).then(() => undefined);
  }

  private async choose(): Promise<CursorTransportKind> {
    const override = await this.deps.signedPolicy.transportOverride();
    if (override === "sdk" || override === "acp") return override;
    const sdk = await this.deps.sdk.available();
    return sdk.installed ? "sdk" : "acp";
  }

  private bridgeFor(kind: CursorTransportKind): SupervisedCursorRuntime {
    if (kind === "sdk") {
      this.sdkBridge ??= new CursorLocalSdkBridge(this.deps);
      return this.sdkBridge;
    }
    this.acpBridge ??= new SupervisedCursorRuntime(this.deps, "acp");
    return this.acpBridge;
  }

  private owner(sessionId: string): SupervisedCursorRuntime {
    const kind = this.owners.get(sessionId);
    if (!kind) throw new CursorAdapterError("unknown_session", `Unknown Cursor session ${sessionId}`);
    return this.bridgeFor(kind);
  }
}
