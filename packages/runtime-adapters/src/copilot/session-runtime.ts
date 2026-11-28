import path from "node:path";
import { CopilotAdapterError, CopilotAuthExpiredError, CopilotByokComplianceError } from "./errors.js";
import { SessionEventQueue } from "./event-queue.js";
import { checkpointRow } from "./checkpoints.js";
import { cleanupCopilotAttempt, mountCopilotAttempt } from "./isolation.js";
import { assertByokMaterial, CopilotMetricsAndQuotaTracker } from "./metrics-quota-tracker.js";
import { normalizeSdkPermission, onPermissionRequest } from "./permission-handler.js";
import { isBadCredentials } from "./normalize.js";
import {
  HARNESS_MCP_TOOLS,
  STRIPPED_EXCLUDED_TOOLS,
} from "./types.js";
import type {
  AgentRuntimeAdapter,
  CopilotAuthStatus,
  CopilotCheckpointRef,
  CopilotInterruptResult,
  CopilotModelDescriptor,
  CopilotPermissionRequest,
  CopilotProbeResult,
  CopilotResumeResult,
  CopilotSessionRef,
  CopilotSessionSpec,
  CopilotSteerResult,
  CopilotTransport,
  CopilotTurnReceipt,
  LeasedMcpServer,
  NormalizedRuntimeEvent,
  NormalizedUsage,
  PermissionApplyResult,
  PermissionResponse,
  ResolvedByok,
  RuntimePosture,
} from "./types.js";
import type { CopilotRuntimeDeps, CopilotSdkPermissionRequest } from "./ports.js";

export interface VendorTurnResult {
  readonly stopReason: string;
  readonly partial: boolean;
  readonly text: string;
  readonly editedPaths: readonly string[];
  readonly metrics: unknown;
  readonly metricsThrew?: boolean;
}

export interface VendorSessionHandle {
  readonly vendorSessionId: string;
  readonly resumeSupported: boolean;
  readonly pid: number | null;
  send(prompt: string): Promise<VendorTurnResult>;
  steer(note: string): Promise<"mid_turn" | "queued">;
  interrupt(): Promise<void>;
  getMetrics(): Promise<unknown>;
}

export interface VendorOpenInput {
  readonly sessionId: string;
  readonly spec: CopilotSessionSpec;
  readonly posture: RuntimePosture;
  readonly gitHubToken: string;
  readonly byok: ResolvedByok | null;
  readonly excludedTools: readonly string[];
  readonly mcpServers: readonly LeasedMcpServer[];
  readonly leasedTools: readonly string[];
  readonly configDir: string;
  readonly proxyUrl: string;
  readonly sandboxTier: string;
  readonly jobObjectId: string;
  onPermission(request: CopilotSdkPermissionRequest): PermissionApplyResult;
}

export interface CopilotVendorLauncher {
  readonly transport: CopilotTransport;
  probe(): Promise<{ readonly installed: boolean; readonly version: string }>;
  listModels(): Promise<readonly CopilotModelDescriptor[]>;
  authProbe(token: string): Promise<{
    readonly signedIn: boolean;
    readonly authExpired: boolean;
    readonly accountLogin: string | null;
  }>;
  accountGetQuota(): Promise<unknown>;
  open(input: VendorOpenInput): Promise<VendorSessionHandle>;
  resume(vendorSessionId: string, input: VendorOpenInput): Promise<VendorSessionHandle | null>;
}

interface LiveSession {
  readonly id: string;
  readonly spec: CopilotSessionSpec;
  readonly posture: RuntimePosture;
  queue: SessionEventQueue;
  readonly jobObjectId: string;
  readonly worktree: string;
  readonly byok: ResolvedByok | null;
  readonly leasedTools: readonly string[];
  vendor: VendorSessionHandle | null;
  turn: number;
  closed: boolean;
  partialInterrupted: boolean;
  lastUsage: NormalizedUsage | null;
}

interface StoredPermission {
  readonly sessionId: string;
  readonly request: CopilotPermissionRequest;
  result: PermissionApplyResult;
}

const REQUIRED_TOOLS = ["kb.*", ...HARNESS_MCP_TOOLS] as const;

export class CopilotSessionRuntime implements AgentRuntimeAdapter {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly permissions = new Map<string, StoredPermission>();
  private readonly tracker: CopilotMetricsAndQuotaTracker;

  constructor(
    protected readonly deps: CopilotRuntimeDeps,
    protected readonly launcher: CopilotVendorLauncher,
  ) {
    this.tracker = new CopilotMetricsAndQuotaTracker(deps);
  }

  async probe(): Promise<CopilotProbeResult> {
    const probed = await this.launcher.probe();
    const gate = this.deps.versionGate.evaluate("copilot", probed.installed ? probed.version : "");
    const models = probed.installed ? await this.launcher.listModels() : [];
    const versionStatus = !probed.installed
      ? "missing"
      : gate.launchCodingTasks
        ? "ok"
        : "version_too_old";
    return {
      installed: probed.installed,
      version: probed.version,
      versionStatus,
      requiredVersion: gate.minVersion,
      transport: this.launcher.transport,
      modes: ["wrapped", "stripped"],
      enabledModelIds: models.filter((model) => model.enabledForOrg).map((model) => model.id),
      excludedModelIds: models.filter((model) => !model.enabledForOrg).map((model) => model.id),
    };
  }

  async authStatus(connectionId: string): Promise<CopilotAuthStatus> {
    const emptyModels = { enabledModelIds: [] as string[], excludedModelIds: [] as string[] };
    const token = this.deps.tokens.readGitHubToken(connectionId);
    if (!token) {
      return {
        signedIn: false,
        authExpired: false,
        connectionId,
        accountLogin: null,
        quota: null,
        ...emptyModels,
        cardTitle: "Re-authenticate GitHub Copilot",
      };
    }
    const auth = await this.launcher.authProbe(token);
    const models = await this.launcher.listModels();
    const roster = {
      enabledModelIds: models.filter((model) => model.enabledForOrg).map((model) => model.id),
      excludedModelIds: models.filter((model) => !model.enabledForOrg).map((model) => model.id),
    };
    if (!auth.signedIn || auth.authExpired) {
      this.tracker.parkAuth(connectionId);
      return {
        signedIn: false,
        authExpired: true,
        connectionId,
        accountLogin: auth.accountLogin,
        quota: null,
        ...roster,
        cardTitle: "Re-authenticate GitHub Copilot",
      };
    }
    const quota = await this.tracker.pollQuota(
      {
        connectionId,
        modelId: roster.enabledModelIds[0] ?? "copilot-default",
        billingMode: "copilot_subscription",
        effectiveTokens: 0,
        reason: "session_start",
      },
      () => this.launcher.accountGetQuota(),
    );
    return {
      signedIn: true,
      authExpired: false,
      connectionId,
      accountLogin: auth.accountLogin,
      quota,
      ...roster,
      cardTitle: null,
    };
  }

  async startSession(spec: CopilotSessionSpec): Promise<CopilotSessionRef> {
    if (spec.transport && spec.transport !== this.launcher.transport) {
      throw new CopilotAdapterError("transport_mismatch", "Session transport does not match this adapter");
    }
    const probed = await this.probe();
    if (probed.versionStatus !== "ok") {
      throw new CopilotAdapterError(
        probed.versionStatus,
        `Copilot ${probed.versionStatus}: require ${probed.requiredVersion}`,
      );
    }
    const token = this.readToken(spec.connectionId);
    const auth = await this.launcher.authProbe(token);
    if (!auth.signedIn || auth.authExpired) {
      this.tracker.parkAuth(spec.connectionId);
      throw new CopilotAuthExpiredError();
    }
    const posture = spec.posture ?? this.deps.policy.postureOverride() ?? "wrapped";
    const byok = this.resolveByok(spec);
    const modelId = byok?.model ?? spec.model ?? probed.enabledModelIds[0] ?? "copilot-default";
    await this.tracker.pollQuota(
      {
        connectionId: spec.connectionId,
        modelId,
        billingMode: spec.billing.mode,
        effectiveTokens: 0,
        reason: "session_start",
      },
      () => this.launcher.accountGetQuota(),
    );
    this.tracker.assertCanDispatch(spec.connectionId, spec.billing.mode);
    return this.openSession(spec, posture, token, byok);
  }

  async sendTurn(sessionId: string, briefOrPrompt: string): Promise<CopilotTurnReceipt> {
    const session = this.require(sessionId);
    const modelId = session.byok?.model ?? session.spec.model ?? "copilot-default";
    try {
      await this.tracker.pollQuota(
        {
          connectionId: session.spec.connectionId,
          modelId,
          billingMode: session.spec.billing.mode,
          effectiveTokens: 0,
          reason: "pre_turn",
        },
        () => this.launcher.accountGetQuota(),
      );
      this.tracker.assertCanDispatch(session.spec.connectionId, session.spec.billing.mode);
    } catch (error) {
      if (error instanceof CopilotAuthExpiredError) {
        this.emit(session, {
          type: "session_error",
          sessionId,
          kind: "auth",
          message: "Re-authenticate GitHub Copilot",
        });
      }
      throw error;
    }
    const vendor = this.requireVendor(session);
    session.turn += 1;
    const turn = session.turn;
    this.emit(session, { type: "turn_started", sessionId, turn });
    try {
      const result = await vendor.send(briefOrPrompt);
      if (result.text) this.emit(session, { type: "assistant_delta", sessionId, text: result.text });
      if (result.editedPaths.length > 0) {
        this.emit(session, { type: "file_edited", sessionId, paths: result.editedPaths });
      }
      const settled = await this.settle(session, result);
      const after = await this.tracker.pollQuota(
        {
          connectionId: session.spec.connectionId,
          modelId,
          billingMode: session.spec.billing.mode,
          effectiveTokens: settled.inputTokens + settled.outputTokens,
          reason: "post_turn",
        },
        () => this.launcher.accountGetQuota(),
      );
      const usage =
        session.spec.billing.mode === "copilot_subscription" ? { ...settled, quota: after } : settled;
      session.lastUsage = usage;
      this.emit(session, { type: "usage_reported", sessionId, usage });
      this.emit(session, { type: "turn_completed", sessionId, turn, stopReason: result.stopReason });
      if (session.spec.billing.mode === "copilot_subscription" && after.remaining === 0) {
        this.emit(session, {
          type: "rate_limited",
          sessionId,
          remaining: after.remaining,
          overageEnabled: after.overageEnabled,
        });
      }
      this.remember(session);
      return { sessionId, turn, dispatched: true, stopReason: result.stopReason, usage };
    } catch (error) {
      if (isBadCredentials(error)) {
        this.tracker.parkAuth(session.spec.connectionId);
        this.emit(session, {
          type: "session_error",
          sessionId,
          kind: "auth",
          message: "Re-authenticate GitHub Copilot",
        });
        throw new CopilotAuthExpiredError();
      }
      throw error;
    }
  }

  async steer(sessionId: string, deltaNote: string): Promise<CopilotSteerResult> {
    const session = this.require(sessionId);
    const vendor = this.requireVendor(session);
    const applied = await vendor.steer(deltaNote);
    return { applied, sessionId };
  }

  async interrupt(sessionId: string): Promise<CopilotInterruptResult> {
    const started = performance.now();
    const session = this.require(sessionId);
    if (!session.closed) {
      const vendor = session.vendor;
      if (vendor) {
        await Promise.race([vendor.interrupt(), delay(50)]);
      }
      await Promise.resolve(this.deps.jobs.terminate(session.jobObjectId));
      cleanupCopilotAttempt(session.worktree);
      session.closed = true;
      session.partialInterrupted = true;
      this.emit(session, { type: "session_exited", sessionId, reason: "interrupted" });
      session.queue.close();
    }
    return {
      sessionId,
      interrupted: true,
      lingeringProcesses: (await Promise.resolve(this.deps.jobs.list(session.jobObjectId))).length,
      elapsedMs: performance.now() - started,
    };
  }

  async resume(sessionId: string, checkpointRef: CopilotCheckpointRef | string): Promise<CopilotResumeResult> {
    const ref = typeof checkpointRef === "string" ? { attemptId: checkpointRef } : checkpointRef;
    const row = this.deps.checkpoints.get(ref.attemptId);
    if (!row || !row.sessionRef) {
      return { supported: false, fallback: "fresh_session", sessionId: null, reason: "missing_checkpoint" };
    }
    if (ref.contradiction || row.contradiction || !row.resumeSupported) {
      return {
        supported: false,
        fallback: "fresh_session",
        sessionId: null,
        reason: ref.contradiction || row.contradiction ? "contradiction" : "unsupported_resume",
      };
    }
    if (row.transport !== this.launcher.transport) {
      return { supported: false, fallback: "fresh_session", sessionId: null, reason: "unsupported_resume" };
    }
    const existing = this.sessions.get(sessionId);
    const spec = existing?.spec;
    if (!spec) {
      return { supported: false, fallback: "fresh_session", sessionId: null, reason: "missing_checkpoint" };
    }
    const token = this.readToken(spec.connectionId);
    const byok = existing?.byok ?? this.resolveByok(spec);
    const reopened = await this.launcher.resume(row.sessionRef, await this.openInput(existing, token, byok));
    if (!reopened) {
      return { supported: false, fallback: "fresh_session", sessionId: null, reason: "unsupported_resume" };
    }
    existing.vendor = reopened;
    existing.closed = false;
    if (existing.queue.isClosed) existing.queue = new SessionEventQueue();
    if (reopened.pid) await Promise.resolve(this.deps.jobs.attach(existing.jobObjectId, reopened.pid));
    this.remember(existing);
    return { supported: true, fallback: "native", sessionId: existing.id, reason: "native" };
  }

  events(sessionId: string): AsyncIterable<NormalizedRuntimeEvent> {
    return this.require(sessionId).queue;
  }

  async respondPermission(
    sessionId: string,
    requestId: string,
    decision: PermissionResponse,
  ): Promise<PermissionApplyResult> {
    const stored = this.permissions.get(requestId);
    if (!stored || stored.sessionId !== sessionId) {
      throw new CopilotAdapterError("unknown_permission", "Permission request is not pending");
    }
    const session = this.require(sessionId);
    const started = performance.now();
    const engineDecision = this.deps.engine.decide({
      posture: session.posture,
      worktree: session.worktree,
      writeScope: session.spec.writeScope,
      leasedTools: session.leasedTools,
      request: stored.request,
    });
    const effect = decision.effect === "deny" || engineDecision.effect === "deny" ? "deny" : "allow";
    const reason =
      effect === "deny"
        ? engineDecision.effect === "deny"
          ? engineDecision.reason
          : decision.reason ?? "denied"
        : engineDecision.reason;
    const result: PermissionApplyResult = {
      requestId,
      effect,
      reason,
      elapsedMs: performance.now() - started,
    };
    stored.result = result;
    this.emit(session, {
      type: "permission_decided",
      sessionId,
      requestId,
      effect,
      reason,
      elapsedMs: result.elapsedMs,
    });
    return result;
  }

  async usage(sessionId: string): Promise<NormalizedUsage> {
    const session = this.require(sessionId);
    const vendor = this.requireVendor(session);
    return this.tracker.readTurnMetrics(
      { usage: { getMetrics: () => vendor.getMetrics() } },
      session.partialInterrupted,
      {
        mode: session.spec.billing.mode,
        connectionId: session.spec.connectionId,
        byok: session.byok,
      },
    );
  }

  recordedEvents(sessionId: string): readonly NormalizedRuntimeEvent[] {
    return this.require(sessionId).queue.snapshot();
  }

  permissionResult(requestId: string): PermissionApplyResult | null {
    return this.permissions.get(requestId)?.result ?? null;
  }

  approvePaidOverage(connectionId: string, resetDateUtc: string): void {
    this.tracker.approvePaidOverage(connectionId, resetDateUtc);
  }

  private async openSession(
    spec: CopilotSessionSpec,
    posture: RuntimePosture,
    token: string,
    byok: ResolvedByok | null,
  ): Promise<CopilotSessionRef> {
    const sessionId = `copilot-${this.launcher.transport}-${spec.attemptId}`;
    const job = await Promise.resolve(this.deps.jobs.create(sessionId));
    const proxy = await Promise.resolve(this.deps.proxy.bind(sessionId));
    const sandbox = this.deps.sandbox.select({
      runtime: "copilot",
      posture,
      worktree: spec.worktree,
    });
    const leasedTools = leaseTools(spec);
    const mcpServers =
      spec.mcpServers.length > 0
        ? spec.mcpServers
        : [this.deps.mcp.lease({ attemptId: spec.attemptId, tools: leasedTools })];
    const excludedTools = posture === "stripped" ? [...STRIPPED_EXCLUDED_TOOLS] : [];
    const session: LiveSession = {
      id: sessionId,
      spec,
      posture,
      queue: new SessionEventQueue(),
      jobObjectId: job.jobObjectId,
      worktree: spec.worktree,
      byok,
      leasedTools,
      vendor: null,
      turn: 0,
      closed: false,
      partialInterrupted: false,
      lastUsage: null,
    };
    this.sessions.set(sessionId, session);
    let mounted = false;
    try {
      const mount = mountCopilotAttempt({
        worktree: spec.worktree,
        posture,
        excludedTools,
        mcpServerNames: mcpServers.map((server) => server.name),
        skills: spec.skills,
        sandboxTier: sandbox.tier,
        proxyUrl: proxy.proxyUrl,
        jobObjectId: job.jobObjectId,
        billingMode: spec.billing.mode,
        byokProvider: byok?.provider ?? null,
        model: byok?.model ?? spec.model ?? null,
      });
      mounted = true;
      const opened = await this.launcher.open(
        await this.openInput(
          session,
          token,
          byok,
          mount.mounted.configDir,
          proxy.proxyUrl,
          sandbox.tier,
          excludedTools,
          mcpServers,
        ),
      );
      session.vendor = opened;
      if (opened.pid) await Promise.resolve(this.deps.jobs.attach(job.jobObjectId, opened.pid));
      this.emit(session, {
        type: "session_started",
        sessionId,
        transport: this.launcher.transport,
        posture,
      });
      this.remember(session);
      return {
        sessionId,
        attemptId: spec.attemptId,
        transport: this.launcher.transport,
        posture,
        vendorSessionId: opened.vendorSessionId,
      };
    } catch (error) {
      this.sessions.delete(sessionId);
      if (mounted) cleanupCopilotAttempt(spec.worktree);
      await Promise.resolve(this.deps.jobs.terminate(job.jobObjectId));
      throw error;
    }
  }

  private async openInput(
    session: LiveSession,
    token: string,
    byok: ResolvedByok | null,
    configDir?: string,
    proxyUrl?: string,
    sandboxTier?: string,
    excludedTools?: readonly string[],
    mcpServers?: readonly LeasedMcpServer[],
  ): Promise<VendorOpenInput> {
    const excluded = excludedTools ?? (session.posture === "stripped" ? [...STRIPPED_EXCLUDED_TOOLS] : []);
    const servers = mcpServers ?? session.spec.mcpServers;
    return {
      sessionId: session.id,
      spec: session.spec,
      posture: session.posture,
      gitHubToken: token,
      byok,
      excludedTools: excluded,
      mcpServers: servers,
      leasedTools: session.leasedTools,
      configDir: configDir ?? path.join(session.worktree, ".ef-copilot"),
      proxyUrl: proxyUrl ?? (await Promise.resolve(this.deps.proxy.bind(session.id))).proxyUrl,
      sandboxTier: sandboxTier ?? "A",
      jobObjectId: session.jobObjectId,
      onPermission: (request) => this.handlePermission(session, request),
    };
  }

  private handlePermission(session: LiveSession, request: CopilotSdkPermissionRequest): PermissionApplyResult {
    const storedRequest = normalizeSdkPermission(request);
    const result = onPermissionRequest(
      this.deps.engine,
      {
        posture: session.posture,
        worktree: session.worktree,
        writeScope: session.spec.writeScope,
        leasedTools: session.leasedTools,
      },
      { ...request, requestId: storedRequest.requestId },
    );
    this.permissions.set(result.requestId, { sessionId: session.id, request: storedRequest, result });
    this.emit(session, {
      type: "permission_requested",
      sessionId: session.id,
      requestId: result.requestId,
      kind: storedRequest.kind,
    });
    this.emit(session, {
      type: "permission_decided",
      sessionId: session.id,
      requestId: result.requestId,
      effect: result.effect,
      reason: result.reason,
      elapsedMs: result.elapsedMs,
    });
    return result;
  }

  private async settle(session: LiveSession, result: VendorTurnResult): Promise<NormalizedUsage> {
    const billing = {
      mode: session.spec.billing.mode,
      connectionId: session.spec.connectionId,
      byok: session.byok,
    };
    const usage = await this.tracker.readTurnMetrics(
      {
        usage: {
          getMetrics: async () => {
            if (result.metricsThrew) throw new TypeError("partial metrics");
            return result.metrics;
          },
        },
      },
      result.partial || session.partialInterrupted,
      billing,
    );
    session.lastUsage = usage;
    session.partialInterrupted = usage.partial_interrupted;
    return usage;
  }

  private remember(session: LiveSession): void {
    const vendor = session.vendor;
    this.deps.checkpoints.save(
      checkpointRow({
        attemptId: session.spec.attemptId,
        step: session.turn,
        sessionRef: vendor?.vendorSessionId ?? null,
        updatedAt: this.deps.clock.now(),
        resumeSupported: vendor?.resumeSupported ?? false,
        contradiction: session.spec.contradiction === true,
        transport: this.launcher.transport,
        posture: session.posture,
      }),
    );
  }

  private readToken(connectionId: string): string {
    const token = this.deps.tokens.readGitHubToken(connectionId);
    if (!token) {
      this.tracker.parkAuth(connectionId);
      throw new CopilotAuthExpiredError();
    }
    return token;
  }

  private resolveByok(spec: CopilotSessionSpec): ResolvedByok | null {
    if (spec.billing.mode !== "byok_api_key") return null;
    const vaultRef = spec.billing.byokVaultRef;
    if (!vaultRef) throw new CopilotByokComplianceError("BYOK vault reference is required");
    const material = this.deps.byokVault.read(vaultRef);
    if (!material) throw new CopilotByokComplianceError("BYOK key is missing from the vault");
    assertByokMaterial(this.deps, material.provider, material.key);
    return {
      provider: material.provider,
      connectionId: material.connectionId,
      model: material.model,
      baseUrl: material.baseUrl,
      apiKey: material.key,
    };
  }

  private require(sessionId: string): LiveSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new CopilotAdapterError("unknown_session", "Copilot session was not found");
    return session;
  }

  private requireVendor(session: LiveSession): VendorSessionHandle {
    if (!session.vendor || session.closed) {
      throw new CopilotAdapterError("session_closed", "Copilot session is not running");
    }
    return session.vendor;
  }

  private emit(session: LiveSession, event: NormalizedRuntimeEvent): void {
    session.queue.push(event);
  }
}

function leaseTools(spec: CopilotSessionSpec): string[] {
  const names = new Set<string>(REQUIRED_TOOLS);
  for (const server of spec.mcpServers) {
    for (const tool of server.tools) names.add(tool);
  }
  return [...names];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
