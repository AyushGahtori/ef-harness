import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalGenericAcpAdapter } from "./acp-engine.js";
import { GEMINI_ROUTE_ID, mentionsForbiddenVendor } from "./constants.js";
import { AcpRpcError, GeminiOptInRequiredError, GeminiVersionGateError } from "./errors.js";
import { buildIsolatedEnv, GeminiHomeGuard } from "./home-guard.js";
import { GeminiOptInComplianceGate, type SignedRouteRevocation } from "./opt-in-gate.js";
import { nodeProcessSpawner, readProcessText, type ProcessSpawner, type SpawnRequest } from "./process-util.js";
import {
  LocalCliMinVersionGate,
  LocalHarnessRunRecorder,
  LocalJobObject,
  LocalLoopbackAllowlistProxy,
  LocalSilentPaidFallbackGuard,
  LocalTierAMxcSandbox,
  type AgentRuntimeAdapter,
  type CliGateResult,
  type LaunchRecord,
  type LimitDecision,
  type McpServerSpec,
  type NormalizedRuntimeEvent,
  type PermissionDecision,
  type PermissionOutcome,
  type SessionSpec,
  type SessionStart,
  type SilentFallbackDecision,
  type TurnResult,
  type UsageSnapshot,
} from "./ports.js";
import { emptyUsage, extractUsage, LocalPacingClassifier, type GeminiLimitSignal } from "./quota.js";
import { LocalSupervisionPolicyEngine } from "./supervision.js";

interface LiveSession {
  sessionId: string;
  mode: "wrapped" | "stripped";
  home: string;
  worktree: string;
  engine: LocalGenericAcpAdapter;
  job: LocalJobObject;
  parked: boolean;
  usage: UsageSnapshot;
  queue: EventQueue;
  mcpServers: string[];
  loopbackProxy: string;
  sandboxed: boolean;
  writeScope: readonly string[];
}

class EventQueue implements AsyncIterable<NormalizedRuntimeEvent> {
  private readonly items: NormalizedRuntimeEvent[] = [];
  private readonly waiters: ((value: NormalizedRuntimeEvent | null) => void)[] = [];
  private closed = false;

  push(event: NormalizedRuntimeEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(event);
    else this.items.push(event);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter(null);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<NormalizedRuntimeEvent> {
    for (;;) {
      const next = await this.pull();
      if (next === null) return;
      yield next;
    }
  }

  private pull(): Promise<NormalizedRuntimeEvent | null> {
    const existing = this.items.shift();
    if (existing) return Promise.resolve(existing);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

export interface GeminiCliRuntimeOptions {
  readonly command?: string;
  readonly argsPrefix?: readonly string[];
  readonly probeEnv?: Readonly<Record<string, string>>;
  readonly spawner?: ProcessSpawner;
  readonly gate?: GeminiOptInComplianceGate;
  readonly guard?: GeminiHomeGuard;
  readonly sandbox?: LocalTierAMxcSandbox;
  readonly proxy?: LocalLoopbackAllowlistProxy;
  readonly pacing?: LocalPacingClassifier;
  readonly fallback?: LocalSilentPaidFallbackGuard;
  readonly harnessRun?: LocalHarnessRunRecorder;
  readonly versionGate?: LocalCliMinVersionGate;
  readonly mcp?: McpServerSpec;
}

/**
 * Unmodified `gemini --acp` adapter. Off until the compliance gate is accepted.
 * Wrapped mode runs in-place inside the Tier A sandbox. Stripped mode denies
 * built-in shell and web tools and routes commands through harness.run.
 */
export class GeminiCliRuntimeAdapter implements AgentRuntimeAdapter {
  readonly launches: LaunchRecord[] = [];
  readonly eventLog: NormalizedRuntimeEvent[] = [];
  private readonly command: string;
  private readonly argsPrefix: readonly string[];
  private readonly probeEnv: Readonly<Record<string, string>>;
  private readonly spawner: ProcessSpawner;
  private readonly gate: GeminiOptInComplianceGate;
  private readonly guard: GeminiHomeGuard;
  private readonly sandbox: LocalTierAMxcSandbox;
  private readonly proxy: LocalLoopbackAllowlistProxy;
  private readonly pacing: LocalPacingClassifier;
  private readonly fallback: LocalSilentPaidFallbackGuard;
  private readonly harnessRun: LocalHarnessRunRecorder;
  private readonly versionGate: LocalCliMinVersionGate;
  private readonly defaultMcp: McpServerSpec;
  private readonly sessions = new Map<string, LiveSession>();
  private readonly pool = new Set<string>();
  private readonly mountedSkills: string[] = [];
  private authMode: "api_key" | "cli_login" | "unknown" = "unknown";
  private stopCard: TurnResult["limit"]["stopCard"] = null;
  private lastFallback: SilentFallbackDecision = {
    accepted: false,
    reason: "no_silent_paid_fallback",
  };
  private revocationNotice: string | null = null;

  constructor(options: GeminiCliRuntimeOptions = {}) {
    this.command = options.command ?? "gemini";
    this.argsPrefix = options.argsPrefix ?? [];
    this.probeEnv = options.probeEnv ?? {};
    this.spawner = options.spawner ?? nodeProcessSpawner;
    this.gate = options.gate ?? new GeminiOptInComplianceGate();
    this.guard = options.guard ?? new GeminiHomeGuard();
    this.sandbox = options.sandbox ?? new LocalTierAMxcSandbox();
    this.proxy = options.proxy ?? new LocalLoopbackAllowlistProxy();
    this.pacing = options.pacing ?? new LocalPacingClassifier();
    this.fallback = options.fallback ?? new LocalSilentPaidFallbackGuard();
    this.harnessRun = options.harnessRun ?? new LocalHarnessRunRecorder();
    this.versionGate = options.versionGate ?? new LocalCliMinVersionGate();
    this.defaultMcp = options.mcp ?? {
      name: "harness",
      endpoint: "http://127.0.0.1:46322/mcp",
      bearer: "attempt-lease",
    };
  }

  get enabled(): boolean {
    return this.gate.enabled;
  }

  get cwnd(): number {
    return this.pacing.concurrency;
  }

  get checkpointStopCard(): TurnResult["limit"]["stopCard"] {
    return this.stopCard;
  }

  get silentFallback(): SilentFallbackDecision {
    return this.lastFallback;
  }

  get signedPolicyNotice(): string | null {
    return this.revocationNotice;
  }

  activePool(): readonly string[] {
    return [...this.pool];
  }

  harnessCalls(): readonly { readonly command: string; readonly cwd: string }[] {
    return this.harnessRun.calls;
  }

  sandboxAttachments(): readonly { readonly mode: "wrapped" | "stripped"; readonly pid: number | null }[] {
    return this.sandbox.attachments.map((item) => ({ mode: item.mode, pid: item.pid }));
  }

  /** Fresh-install discovery. Does not spawn Gemini and does not touch its home. */
  autoDiscover(): { readonly enabled: boolean; readonly spawned: false } {
    return { enabled: this.gate.enabled, spawned: false };
  }

  async probe(): Promise<CliGateResult> {
    return this.probeIn(path.join(os.tmpdir(), "ef-harness-gemini-probe"), this.probeEnv);
  }

  async authStatus(): Promise<{
    readonly enabled: boolean;
    readonly optedIn: boolean;
    readonly mode: "api_key" | "cli_login" | "unknown";
    readonly readsCredentialDirectory: false;
  }> {
    return {
      enabled: this.gate.enabled,
      optedIn: this.gate.optedIn,
      mode: this.authMode,
      readsCredentialDirectory: false,
    };
  }

  async startSession(spec: SessionSpec): Promise<SessionStart> {
    this.gate.assertCanStart();
    this.rejectForbidden(spec);
    const probed = await this.probeIn(spec.worktree, { ...this.probeEnv, ...(spec.extraEnv ?? {}) });
    if (!probed.allowed) {
      throw new GeminiVersionGateError(probed.reason === "ok" ? "unparseable" : probed.reason);
    }
    const mode = spec.mode === "stripped" ? "stripped" : "wrapped";
    const attempt = spec.attemptId ?? "attempt";
    const home = path.join(spec.worktree, ".ef-gemini-home", attempt);
    this.guard.inspect(home, "session-home");
    fs.mkdirSync(home, { recursive: true });
    if (mode === "stripped") this.writeStrippedConfig(home);
    this.mountSkills(spec.worktree, spec.skills ?? []);
    const apiKey = spec.auth?.mode === "api_key" ? spec.auth.apiKey : null;
    this.authMode = spec.auth?.mode ?? "cli_login";
    const loopback = this.proxy.endpoint();
    const env = buildIsolatedEnv({
      parent: process.env,
      geminiCliHome: home,
      apiKey,
      extra: spec.extraEnv ?? {},
      loopbackProxy: loopback,
      guard: this.guard,
    });
    const job = new LocalJobObject();
    const policy = new LocalSupervisionPolicyEngine(this.harnessRun);
    const engine = new LocalGenericAcpAdapter(
      (request) => this.spawnTracked(request, home, apiKey !== null),
      policy,
      job,
    );
    engine.setContext({ mode, worktree: spec.worktree, writeScope: spec.writeScope });
    const mcp = spec.mcp ?? this.defaultMcp;
    const session: LiveSession = {
      sessionId: "",
      mode,
      home,
      worktree: spec.worktree,
      engine,
      job,
      parked: false,
      usage: emptyUsage(),
      queue: new EventQueue(),
      mcpServers: [mcp.name],
      loopbackProxy: loopback,
      sandboxed: false,
      writeScope: spec.writeScope,
    };
    engine.onUpdate((update) => {
      const usage = extractUsage(update);
      if (!usage || !session.sessionId) return;
      session.usage = usage;
      this.emit(session, { type: "usage_reported", sessionId: session.sessionId, usage });
    });
    engine.onPermission((decision) => {
      if (!session.sessionId) return;
      this.emit(session, {
        type: "permission_requested",
        sessionId: session.sessionId,
        requestId: decision.requestId,
        tool: decision.reason,
      });
      this.emit(session, {
        type: "permission_decided",
        sessionId: session.sessionId,
        requestId: decision.requestId,
        outcome: decision.outcome,
        reason: decision.reason,
      });
    });
    try {
      await engine.start({
        command: this.command,
        args: [...this.argsPrefix, "--acp"],
        cwd: spec.worktree,
        env,
        windowsHide: true,
      });
      this.sandbox.attach({
        pid: engine.pid,
        worktree: spec.worktree,
        mode,
        loopbackProxy: loopback,
      });
      session.sandboxed = true;
      await engine.initialize();
      const created = await engine.newSession({ cwd: spec.worktree, mcpServers: [mcp] });
      session.sessionId = created.sessionId;
      this.sessions.set(created.sessionId, session);
      this.pool.add(created.sessionId);
      return {
        sessionId: created.sessionId,
        mode,
        geminiCliHome: home,
        sandboxed: true,
        jobAttached: engine.pid !== null,
        loopbackProxy: loopback,
        pooled: this.pool.has(created.sessionId),
        mcpServers: session.mcpServers,
      };
    } catch (error) {
      await engine.close();
      throw error;
    }
  }

  async sendTurn(sessionId: string, briefOrPrompt: string): Promise<TurnResult> {
    const session = this.requireSession(sessionId);
    if (session.parked || !this.gate.enabled) {
      throw new GeminiOptInRequiredError(this.gate.snapshot()?.revoked ? "disabled" : "disabled");
    }
    this.emit(session, { type: "turn_started", sessionId });
    try {
      const raw = await session.engine.prompt(sessionId, briefOrPrompt);
      const limit = this.pacing.classify({ httpStatus: null, code: null, message: "" });
      this.emit(session, { type: "turn_completed", sessionId });
      return this.turnFrom(session, raw, limit, false);
    } catch (error) {
      if (!(error instanceof AcpRpcError)) throw error;
      const limit = this.pacing.classify(signalFromRpc(error));
      const silentFallback = this.fallback.consider({
        fromRouteId: GEMINI_ROUTE_ID,
        toBilling: "api_key",
        explicitUserChoice: false,
      });
      this.lastFallback = silentFallback;
      this.emit(session, { type: "rate_limited", sessionId, decision: limit });
      const parked = limit.kind === "quota_exhaustion";
      if (parked) {
        this.stopCard = limit.stopCard;
        session.parked = true;
        this.pool.delete(sessionId);
        this.emit(session, { type: "session_exited", sessionId, parked: true });
      }
      return this.turnFrom(session, {}, limit, parked, silentFallback);
    }
  }

  async steer(sessionId: string, deltaNote: string): Promise<TurnResult> {
    return this.sendTurn(sessionId, `Steering note: ${deltaNote}`);
  }

  async interrupt(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    await session.engine.cancel(sessionId);
    session.parked = true;
    this.pool.delete(sessionId);
    await session.engine.close();
    this.emit(session, { type: "session_exited", sessionId, parked: true });
    session.queue.close();
  }

  async resume(
    sessionId: string,
    checkpointRef: string,
  ): Promise<{ readonly supported: boolean; readonly sessionId: string }> {
    const session = this.requireSession(sessionId);
    try {
      const loaded = await session.engine.load(checkpointRef || sessionId);
      const resumed = typeof loaded.sessionId === "string" ? loaded.sessionId : sessionId;
      return { supported: true, sessionId: resumed };
    } catch {
      return { supported: false, sessionId };
    }
  }

  events(sessionId: string): AsyncIterable<NormalizedRuntimeEvent> {
    return this.requireSession(sessionId).queue;
  }

  eventsFor(sessionId: string): readonly NormalizedRuntimeEvent[] {
    return this.eventLog.filter((event) => event.sessionId === sessionId);
  }

  async respondPermission(
    sessionId: string,
    requestId: string,
    decision: { readonly outcome: PermissionOutcome },
  ): Promise<PermissionDecision> {
    const session = this.requireSession(sessionId);
    return session.engine.respondPermission(requestId, decision.outcome);
  }

  usage(sessionId: string): UsageSnapshot {
    return this.requireSession(sessionId).usage;
  }

  async disable(): Promise<void> {
    this.gate.disable();
    await this.parkAll();
  }

  async applySignedPolicy(revocation: SignedRouteRevocation): Promise<void> {
    this.gate.applyRouteRevoked(revocation);
    this.revocationNotice = revocation.notice;
    await this.parkAll();
  }

  cleanupEphemeralMounts(): void {
    for (const file of this.mountedSkills.splice(0)) {
      this.guard.inspect(file, "cleanup");
      fs.rmSync(file, { force: true });
    }
  }

  async close(): Promise<void> {
    this.cleanupEphemeralMounts();
    await this.parkAll();
  }

  private async probeIn(
    worktree: string,
    extra: Readonly<Record<string, string>>,
  ): Promise<CliGateResult> {
    const home = path.join(worktree, ".ef-gemini-probe-home");
    this.guard.inspect(home, "probe-home");
    fs.mkdirSync(home, { recursive: true });
    try {
      const version = await this.capture(home, ["--version"], extra);
      const help = await this.capture(home, ["--help"], extra);
      return this.versionGate.evaluate(version, help);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { allowed: false, supportsAcp: false, version: "", reason: "binary_missing" };
      }
      throw error;
    }
  }

  private async capture(
    home: string,
    args: readonly string[],
    extra: Readonly<Record<string, string>>,
  ): Promise<string> {
    const env = buildIsolatedEnv({
      parent: process.env,
      geminiCliHome: home,
      apiKey: null,
      extra,
      loopbackProxy: this.proxy.endpoint(),
      guard: this.guard,
    });
    const child = this.spawnTracked(
      {
        command: this.command,
        args: [...this.argsPrefix, ...args],
        cwd: home,
        env,
        windowsHide: true,
      },
      home,
      false,
    );
    const result = await readProcessText(child, 10_000);
    return result.stdout;
  }

  private spawnTracked(request: SpawnRequest, home: string, hasApiKey: boolean) {
    this.launches.push({
      command: request.command,
      args: request.args,
      windowsHide: request.windowsHide,
      geminiCliHome: home,
      hasApiKey,
    });
    return this.spawner(request);
  }

  private writeStrippedConfig(home: string): void {
    const file = path.join(home, "settings.json");
    this.guard.inspect(file, "stripped-config");
    const body = {
      tools: {
        exclude: ["shell", "web_fetch", "web_search", "google_web_search"],
      },
    };
    fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  }

  private mountSkills(
    worktree: string,
    skills: readonly { readonly name: string; readonly body: string }[],
  ): void {
    const exclude = path.join(worktree, ".git", "info", "exclude");
    this.guard.inspect(exclude, "exclude");
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    const existing = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
    const lines = [".ef-gemini-skills/", ".ef-gemini-home/"];
    let next = existing;
    for (const line of lines) {
      if (!next.includes(line)) next = `${next}${next.endsWith("\n") || next.length === 0 ? "" : "\n"}${line}\n`;
    }
    if (next !== existing) fs.writeFileSync(exclude, next, "utf8");
    if (skills.length === 0) return;
    const dir = path.join(worktree, ".ef-gemini-skills");
    this.guard.inspect(dir, "skills");
    fs.mkdirSync(dir, { recursive: true });
    for (const skill of skills.slice(0, 2)) {
      const safe = path.basename(skill.name).replaceAll(/[^A-Za-z0-9._-]/g, "");
      if (!safe) continue;
      const file = path.join(dir, safe);
      this.guard.inspect(file, "skill");
      fs.writeFileSync(file, skill.body, "utf8");
      this.mountedSkills.push(file);
    }
  }

  private requireSession(sessionId: string): LiveSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown Gemini CLI session ${sessionId}`);
    return session;
  }

  private emit(session: LiveSession, event: NormalizedRuntimeEvent): void {
    this.eventLog.push(event);
    session.queue.push(event);
  }

  private turnFrom(
    session: LiveSession,
    raw: Record<string, unknown>,
    limit: LimitDecision,
    parked: boolean,
    silentFallback: SilentFallbackDecision = {
      accepted: false,
      reason: "no_silent_paid_fallback",
    },
  ): TurnResult {
    return {
      stopReason: typeof raw.stopReason === "string" ? raw.stopReason : limit.kind,
      permissionOutcome: typeof raw.permissionOutcome === "string" ? raw.permissionOutcome : null,
      limit,
      usage: session.usage,
      childHome: typeof raw.geminiCliHome === "string" ? raw.geminiCliHome : session.home,
      childSawApiKey: raw.hasApiKey === true,
      silentFallback,
      parked,
    };
  }

  private rejectForbidden(spec: SessionSpec): void {
    const fields = [spec.attemptId ?? "", spec.mode ?? "", ...spec.writeScope];
    if (fields.some((field) => mentionsForbiddenVendor(field))) {
      throw new GeminiOptInRequiredError("forbidden_vendor");
    }
  }

  private async parkAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.pool.clear();
    for (const session of sessions) {
      const alreadyParked = session.parked;
      session.parked = true;
      if (!alreadyParked && session.sessionId) {
        this.emit(session, { type: "session_exited", sessionId: session.sessionId, parked: true });
      }
      await session.engine.close();
      session.queue.close();
    }
  }
}

function signalFromRpc(error: AcpRpcError): GeminiLimitSignal {
  const data = error.data && typeof error.data === "object" ? (error.data as Record<string, unknown>) : {};
  return {
    httpStatus: typeof data.httpStatus === "number" ? data.httpStatus : null,
    code: typeof data.status === "string" ? data.status : null,
    message: `${error.message} ${typeof data.reason === "string" ? data.reason : ""}`,
  };
}
