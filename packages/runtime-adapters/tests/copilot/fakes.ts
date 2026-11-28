import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ConnectionWindowStore,
  CopilotAcpFallbackAdapter,
  CopilotRuntimeAdapter,
  CopilotSdkBridge,
  LocalAllowancePacingController,
  LocalByokVault,
  LocalCopilotRuntimePolicy,
  LocalGitHubTokenVault,
  LocalWindowsJobObject,
  RecordingByokLedger,
  RecordingCardSink,
  RecordingPaidFallbackGuard,
  localCopilotDeps,
  type AcpLaunchSpec,
  type CopilotRuntimeDeps,
  type CopilotSdkClientPort,
  type CopilotSdkPermissionRequest,
  type CopilotSdkSessionConfig,
  type CopilotSdkSessionPort,
  type CopilotSdkTurnResult,
  type CopilotSessionSpec,
  type GenericAcpAdapterPort,
  type GenericAcpSessionPort,
} from "../../src/copilot/index.js";

export const TOKEN = "fixture-copilot-user-token-alpha";
export const RESET = "2026-12-01T00:00:00.000Z";

export interface MutableQuota {
  entitlement: number;
  remaining: number;
  percentRemaining: number;
  resetDateUtc: string;
  overageEnabled: boolean;
}

export function quota(partial?: Partial<MutableQuota>): MutableQuota {
  return {
    entitlement: 10,
    remaining: 10,
    percentRemaining: 100,
    resetDateUtc: RESET,
    overageEnabled: false,
    ...partial,
  };
}

export class FakeCopilotSdk implements CopilotSdkClientPort {
  version = "1.4.0";
  installed = true;
  signedIn = true;
  authExpired = false;
  accountLogin: string | null = "octocat";
  resumeSupported = true;
  resumeReturnsNull = false;
  sendCount = 0;
  resumeCount = 0;
  lastConfig: CopilotSdkSessionConfig | null = null;
  quotaState = quota();
  rawQuota: unknown | null = null;
  metrics: unknown = {
    inputTokens: 10,
    outputTokens: 4,
    cachedInputTokens: 1,
    cacheCreationInputTokens: 2,
    reasoningTokens: 0,
    premiumRequests: 1,
  };
  metricsThrows = false;
  partial = false;
  failAuthOnSend = false;
  steerMode: "mid_turn" | "queued" = "mid_turn";
  spawnWatchChild = false;
  hungInterrupt = false;
  child: ChildProcess | null = null;
  models = [
    { id: "gpt-4.1", enabledForOrg: true },
    { id: "claude-sonnet", enabledForOrg: false },
  ];

  probe(): Promise<{ installed: boolean; version: string }> {
    return Promise.resolve({ installed: this.installed, version: this.version });
  }

  listModels(): Promise<{ id: string; enabledForOrg: boolean }[]> {
    return Promise.resolve(this.models);
  }

  authStatus(): Promise<{ signedIn: boolean; authExpired: boolean; accountLogin: string | null }> {
    return Promise.resolve({
      signedIn: this.signedIn,
      authExpired: this.authExpired,
      accountLogin: this.accountLogin,
    });
  }

  accountGetQuota(): Promise<unknown> {
    return Promise.resolve(this.rawQuota ?? this.quotaState);
  }

  async createSession(config: CopilotSdkSessionConfig): Promise<CopilotSdkSessionPort> {
    this.lastConfig = config;
    return new FakeSdkSession(this, `vendor-${config.jobObjectId}`, this.spawnChild());
  }

  async resumeSession(
    _sessionId: string,
    config: CopilotSdkSessionConfig,
  ): Promise<CopilotSdkSessionPort | null> {
    this.resumeCount += 1;
    if (this.resumeReturnsNull) return null;
    this.lastConfig = config;
    return new FakeSdkSession(this, `resumed-${config.jobObjectId}`, null);
  }

  spawnChild(): number | null {
    if (!this.spawnWatchChild) return null;
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000000)"], {
      stdio: "ignore",
    });
    this.child = child;
    return child.pid ?? null;
  }

  killChild(): void {
    const pid = this.child?.pid;
    if (!pid) return;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      return;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      return;
    }
  }
}

class FakeSdkSession implements CopilotSdkSessionPort {
  readonly resumeSupported: boolean;

  constructor(
    private readonly owner: FakeCopilotSdk,
    readonly id: string,
    readonly pid: number | null,
  ) {
    this.resumeSupported = owner.resumeSupported;
  }

  async send(prompt: string): Promise<CopilotSdkTurnResult> {
    if (this.owner.failAuthOnSend) {
      throw Object.assign(new Error("Bad credentials"), { status: 401 });
    }
    this.owner.sendCount += 1;
    if (this.owner.lastConfig?.billingMode !== "byok_api_key" && this.owner.quotaState.remaining > 0) {
      const remaining = this.owner.quotaState.remaining - 1;
      const entitlement = this.owner.quotaState.entitlement;
      this.owner.quotaState = {
        ...this.owner.quotaState,
        remaining,
        percentRemaining: entitlement === 0 ? 0 : (remaining / entitlement) * 100,
      };
    }
    return {
      stopReason: this.owner.partial ? "interrupted" : "completed",
      partial: this.owner.partial,
      text: prompt,
      editedPaths: [],
      metrics: this.owner.metrics,
    };
  }

  steer(): Promise<"mid_turn" | "queued"> {
    return Promise.resolve(this.owner.steerMode);
  }

  async interrupt(): Promise<void> {
    if (this.owner.hungInterrupt) await new Promise(() => undefined);
  }

  readonly usage = {
    getMetrics: (): Promise<unknown> => {
      if (this.owner.metricsThrows) return Promise.reject(new TypeError("partial metrics"));
      return Promise.resolve(this.owner.metrics);
    },
  };
}

export class FakeGenericAcp implements GenericAcpAdapterPort {
  version = "1.4.0";
  installed = true;
  signedIn = true;
  authExpired = false;
  accountLogin: string | null = "octocat";
  resumeSupported = true;
  resumeReturnsNull = false;
  sendCount = 0;
  resumeCount = 0;
  lastSpec: AcpLaunchSpec | null = null;
  quotaState = quota();
  metrics: unknown = { inputTokens: 3, outputTokens: 2, premiumRequests: 1 };
  steerMode: "mid_turn" | "queued" = "queued";
  models = [
    { id: "gpt-4.1", enabledForOrg: true },
    { id: "claude-sonnet", enabledForOrg: false },
  ];

  probe(): Promise<{ installed: boolean; version: string; loadSession: boolean }> {
    return Promise.resolve({
      installed: this.installed,
      version: this.version,
      loadSession: this.resumeSupported,
    });
  }

  listModels(): Promise<{ id: string; enabledForOrg: boolean }[]> {
    return Promise.resolve(this.models);
  }

  authStatus(): Promise<{ signedIn: boolean; authExpired: boolean; accountLogin: string | null }> {
    return Promise.resolve({
      signedIn: this.signedIn,
      authExpired: this.authExpired,
      accountLogin: this.accountLogin,
    });
  }

  accountGetQuota(): Promise<unknown> {
    return Promise.resolve(this.quotaState);
  }

  async startSession(spec: AcpLaunchSpec): Promise<GenericAcpSessionPort> {
    this.lastSpec = spec;
    return new FakeAcpSession(this, `acp-${spec.sandboxTier}`);
  }

  async loadSession(sessionId: string, spec: AcpLaunchSpec): Promise<GenericAcpSessionPort | null> {
    this.resumeCount += 1;
    this.lastSpec = spec;
    if (this.resumeReturnsNull || !this.resumeSupported) return null;
    return new FakeAcpSession(this, `acp-load-${sessionId}`);
  }

  permission(request: CopilotSdkPermissionRequest): Promise<{ kind: "approved" | "denied"; reason: string }> {
    const spec = this.lastSpec;
    if (!spec) return Promise.reject(new Error("ACP session was not started"));
    return spec.onPermissionRequest(request);
  }
}

class FakeAcpSession implements GenericAcpSessionPort {
  readonly resumeSupported: boolean;
  readonly pid = null;

  constructor(
    private readonly owner: FakeGenericAcp,
    readonly id: string,
  ) {
    this.resumeSupported = owner.resumeSupported;
  }

  async prompt(text: string): Promise<CopilotSdkTurnResult> {
    this.owner.sendCount += 1;
    return {
      stopReason: "completed",
      partial: false,
      text,
      editedPaths: [],
      metrics: this.owner.metrics,
    };
  }

  steer(): Promise<"mid_turn" | "queued"> {
    return Promise.resolve(this.owner.steerMode);
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }

  usageUpdate(): Promise<unknown> {
    return Promise.resolve(this.owner.metrics);
  }
}

export interface Harness {
  readonly adapter: CopilotSdkBridge;
  readonly facade: CopilotRuntimeAdapter;
  readonly acpAdapter: CopilotAcpFallbackAdapter;
  readonly sdk: FakeCopilotSdk;
  readonly acp: FakeGenericAcp;
  readonly deps: CopilotRuntimeDeps;
  readonly worktree: string;
  readonly cards: RecordingCardSink;
  readonly pacing: LocalAllowancePacingController;
  readonly windows: ConnectionWindowStore;
  readonly jobs: LocalWindowsJobObject;
  readonly tokens: LocalGitHubTokenVault;
  readonly ledger: RecordingByokLedger;
  readonly byokVault: LocalByokVault;
  readonly fallback: RecordingPaidFallbackGuard;
}

export function createHarness(transport: "sdk" | "acp" = "sdk"): Harness {
  const sdk = new FakeCopilotSdk();
  const acp = new FakeGenericAcp();
  const tokens = new LocalGitHubTokenVault();
  tokens.put("copilot-1", TOKEN);
  tokens.put("other-paid", "fixture-copilot-user-token-bravo");
  const cards = new RecordingCardSink();
  const pacing = new LocalAllowancePacingController();
  const windows = new ConnectionWindowStore();
  const jobs = new LocalWindowsJobObject();
  const ledger = new RecordingByokLedger();
  const byokVault = new LocalByokVault();
  const fallback = new RecordingPaidFallbackGuard();
  const deps = localCopilotDeps({
    sdk,
    acp,
    tokens,
    cards,
    pacing,
    windows,
    jobs,
    byokLedger: ledger,
    byokVault,
    fallbackGuard: fallback,
    policy: new LocalCopilotRuntimePolicy(transport),
  });
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "ef-copilot-"));
  fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
  return {
    adapter: new CopilotSdkBridge(deps),
    acpAdapter: new CopilotAcpFallbackAdapter(deps),
    facade: new CopilotRuntimeAdapter(deps),
    sdk,
    acp,
    deps,
    worktree,
    cards,
    pacing,
    windows,
    jobs,
    tokens,
    ledger,
    byokVault,
    fallback,
  };
}

export function sessionSpec(worktree: string, extra?: Partial<CopilotSessionSpec>): CopilotSessionSpec {
  return {
    attemptId: extra?.attemptId ?? "attempt-1",
    connectionId: "copilot-1",
    worktree,
    brief: "Implement the scoped change",
    writeScope: ["src/**"],
    mcpServers: [],
    skills: [{ name: "review", markdown: "# Review\nStay inside the write scope.\n" }],
    billing: { mode: "copilot_subscription" },
    ...extra,
  };
}

export function disposeHarness(harness: Harness): void {
  harness.sdk.killChild();
  fs.rmSync(harness.worktree, { recursive: true, force: true });
}

export function consoleKey(suffix: string): string {
  return `${["sk", "-ant", "-api"].join("")}${suffix}`;
}

export function subscriptionKey(suffix: string): string {
  return `${["sk", "-ant", "-oat"].join("")}${suffix}`;
}
