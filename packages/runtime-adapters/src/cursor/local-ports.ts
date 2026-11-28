import os from "node:os";
import path from "node:path";
import { CursorGenericAcp } from "./generic-acp.js";
import { AllowlistCursorProxy, AttemptMcpCursorLease, OsCursorJob } from "./os-ports.js";
import { DEFAULT_LEASED_MCP_TOOLS } from "./constants.js";
import { CursorAdapterError } from "./errors.js";
import { MemoryAuditLog, SecretRedactor } from "./redact.js";
import type {
  AllowancePacingPort,
  AttemptCheckpointStorePort,
  CliGateDecision,
  CliMinVersionGatePort,
  CursorAcpSessionHandle,
  CursorAcpSpawnRequest,
  CursorAgentUsageClient,
  CursorConformanceGatePort,
  CursorDispatchParkerPort,
  CursorKeyExpiryPort,
  CursorKeyMaterialPort,
  CursorKeySnapshot,
  CursorNoticeSink,
  CursorRuntimeDeps,
  CursorSdkAgentHandle,
  CursorSdkCreateRequest,
  CursorSdkPort,
  GenericAcpAdapterPort,
  LeasedMcpServerPort,
  NoSilentPaidFallbackPort,
  SandboxTierSelectorPort,
  SignedCursorTransportPolicyPort,
} from "./ports.js";
import type {
  CursorAuthState,
  CursorCheckpointRecord,
  CursorNotice,
  CursorRunResult,
  CursorTransportKind,
  NormalizedUsage,
} from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export class LocalCliMinVersionGate implements CliMinVersionGatePort {
  constructor(private readonly floors: Readonly<Record<string, string>> = {
    "cursor-agent": "1.0.0",
    "@cursor/sdk": "1.0.0",
    cursor: "1.0.0",
  }) {}

  evaluate(runtime: string, installedVersion: string): CliGateDecision {
    const floor = this.floors[runtime] ?? this.floors.cursor ?? null;
    if (!installedVersion.trim()) {
      return { launchCodingTasks: false, status: "disabled", reason: "missing", minVersion: floor };
    }
    if (floor && compareSemver(installedVersion, floor) < 0) {
      return { launchCodingTasks: false, status: "disabled", reason: "below_minimum", minVersion: floor };
    }
    return { launchCodingTasks: true, status: "allowed", reason: "ok", minVersion: floor };
  }
}

export class LocalSignedCursorPolicy implements SignedCursorTransportPolicyPort {
  constructor(private readonly override: CursorTransportKind | "auto" = "auto") {}

  transportOverride(): Promise<CursorTransportKind | "auto"> {
    return Promise.resolve(this.override);
  }
}

export class LocalSandboxTierSelector implements SandboxTierSelectorPort {
  hold = false;

  selectTier(): Promise<{ readonly tier: "A"; readonly hold: boolean; readonly reason: string }> {
    return Promise.resolve({
      tier: "A",
      hold: this.hold,
      reason: this.hold ? "sandbox hold" : "tier A",
    });
  }
}

export class LocalLeasedMcp implements LeasedMcpServerPort {
  lease(input: { readonly sessionId: string; readonly tools: readonly string[] }) {
    return Promise.resolve({
      leaseId: `lease-${input.sessionId}`,
      endpoint: `http://127.0.0.1/mcp/${input.sessionId}`,
      tools: input.tools,
    });
  }
}

export class LocalConformanceGate implements CursorConformanceGatePort {
  private readonly blocked = new Set<string>();

  block(version: string): void {
    this.blocked.add(version);
  }

  verified(version: string): boolean {
    return !this.blocked.has(version);
  }
}

export class InMemoryCursorKeys implements CursorKeyMaterialPort, CursorKeyExpiryPort {
  status: CursorAuthState = "active";
  expiresAt = Date.now() + 90 * DAY_MS;
  apiKey = "cursor-user-key-90day-dpapi";

  constructor(readonly connectionId = "cursor-connection") {}

  inspect(connectionId: string, now: number): Promise<CursorKeySnapshot> {
    this.assertConnection(connectionId);
    const expired = this.status === "expired" || this.status === "unauthorized" || this.expiresAt <= now;
    return Promise.resolve({
      connectionId,
      expiresAt: this.expiresAt,
      status: expired && this.status === "active" ? "expired" : this.status,
      expired,
    });
  }

  readUserApiKey(connectionId: string): Promise<string | null> {
    this.assertConnection(connectionId);
    if (this.status === "signed_out") return Promise.resolve(null);
    return Promise.resolve(this.apiKey);
  }

  markAuthExpired(connectionId: string, status: "expired" | "unauthorized"): Promise<void> {
    this.assertConnection(connectionId);
    this.status = status;
    return Promise.resolve();
  }

  mark(connectionId: string, status: "expired" | "unauthorized"): Promise<void> {
    return this.markAuthExpired(connectionId, status);
  }

  private assertConnection(connectionId: string): void {
    if (connectionId !== this.connectionId) {
      throw new CursorAdapterError("unknown_connection", "Cursor connection was not found");
    }
  }
}

export class InMemoryCursorSdk implements CursorSdkPort {
  installed = true;
  version = "1.2.0";
  httpStatus = 200;
  usageStatus = 200;
  hangAbort = false;
  hangSend = false;
  sendCalls = 0;
  abortCalls = 0;
  createCalls = 0;
  loginCalls = 0;
  quota: Record<string, unknown> = {
    plan: "pro",
    includedUsedPercent: 10,
    fastUsedPercent: 4,
    remainingPercent: 90,
    onDemandEnabled: false,
    chargedCents: 0,
  };
  runUsage: Record<string, unknown> = {
    inputTokens: 120,
    outputTokens: 30,
    cacheReadTokens: 15,
    cacheWriteTokens: 0,
    reasoningTokens: 5,
    costMicroUsd: 0,
    requestCount: 1,
  };
  scriptedEvents: CursorRunResult["events"] = [];
  lastRequest: CursorSdkCreateRequest | null = null;
  private releaseAbort: (() => void) | null = null;

  available(): Promise<{ readonly installed: boolean; readonly version: string }> {
    return Promise.resolve({ installed: this.installed, version: this.installed ? this.version : "" });
  }

  createLocalAgent(request: CursorSdkCreateRequest): Promise<CursorSdkAgentHandle> {
    this.createCalls += 1;
    this.lastRequest = request;
    const pid = 4100 + this.createCalls;
    const handle: CursorSdkAgentHandle = {
      agentId: `agent-${this.createCalls}`,
      pid,
      childPids: [pid, pid + 100],
      send: (prompt, signal) => this.send(prompt, signal),
      steer: () => Promise.resolve(),
      abort: () => this.abort(),
      resume: () => Promise.resolve({ supported: true }),
      dispose: () => Promise.resolve(),
    };
    return Promise.resolve(handle);
  }

  getUsage(apiKey: string): Promise<unknown> {
    if (!apiKey) return Promise.reject(new CursorAdapterError("unauthorized", "Missing Cursor key"));
    if (this.usageStatus === 401) {
      return Promise.reject(new CursorAdapterError("unauthorized", "Cursor returned 401"));
    }
    return Promise.resolve(this.quota);
  }

  authLogin(): Promise<void> {
    this.loginCalls += 1;
    return Promise.resolve();
  }

  private send(_prompt: string, signal: AbortSignal): Promise<CursorRunResult> {
    this.sendCalls += 1;
    if (this.hangSend) {
      return new Promise((resolve, reject) => {
        const onAbort = (): void => reject(new CursorAdapterError("interrupted", "Cursor run aborted"));
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
    return Promise.resolve({
      httpStatus: this.httpStatus,
      events: this.scriptedEvents,
      usage: this.runUsage,
      agentUsage: this.quota,
    });
  }

  private abort(): Promise<void> {
    this.abortCalls += 1;
    if (!this.hangAbort) return Promise.resolve();
    return new Promise((resolve) => {
      this.releaseAbort = resolve;
    });
  }
}

export class InMemoryCursorAcp implements GenericAcpAdapterPort {
  installed = true;
  version = "1.2.0";
  loadSession = true;
  httpStatus = 200;
  sendCalls = 0;
  cancelCalls = 0;
  scriptedEvents: CursorRunResult["events"] = [];
  runUsage: Record<string, unknown> = {
    inputTokens: 120,
    outputTokens: 30,
    cacheReadTokens: 15,
    reasoningTokens: 5,
    costMicroUsd: 0,
    requestCount: 1,
  };
  lastRequest: CursorAcpSpawnRequest | null = null;
  resumeSupported = true;

  probe(): Promise<{ readonly installed: boolean; readonly version: string; readonly loadSession: boolean }> {
    return Promise.resolve({
      installed: this.installed,
      version: this.installed ? this.version : "",
      loadSession: this.loadSession,
    });
  }

  start(request: CursorAcpSpawnRequest): Promise<CursorAcpSessionHandle> {
    this.lastRequest = request;
    const pid = 5100;
    const handle: CursorAcpSessionHandle = {
      sessionId: "acp-session-1",
      pid,
      childPids: [pid],
      argv: [request.command, ...request.args],
      prompt: (_prompt, signal) => {
        this.sendCalls += 1;
        if (signal.aborted) return Promise.reject(new CursorAdapterError("interrupted", "ACP prompt aborted"));
        return Promise.resolve({
          httpStatus: this.httpStatus,
          events: this.scriptedEvents,
          usage: this.runUsage,
          agentUsage: null,
        });
      },
      steer: () => Promise.resolve(),
      cancel: () => {
        this.cancelCalls += 1;
        return Promise.resolve();
      },
      load: () => Promise.resolve({ supported: this.resumeSupported }),
      dispose: () => Promise.resolve(),
    };
    return Promise.resolve(handle);
  }
}

export class LocalAllowancePacing implements AllowancePacingPort {
  readonly usageSamples: unknown[] = [];
  readonly runSamples: unknown[] = [];

  observeAuthoritativeUsage(input: {
    readonly connectionId: string;
    readonly windowKind: "cursor_included";
    readonly usedPpm: number;
    readonly source: "Agent.getUsage";
    readonly onDemandEnabled: boolean;
    readonly chargedCents: number;
  }): Promise<{ readonly action: "continue" | "pause_before_on_demand"; readonly cwnd: number }> {
    this.usageSamples.push(input);
    const pause = input.onDemandEnabled && input.usedPpm >= 900_000;
    return Promise.resolve({
      action: pause || input.chargedCents > 0 ? "pause_before_on_demand" : "continue",
      cwnd: pause || input.chargedCents > 0 ? 0 : 2,
    });
  }

  reportRunUsage(input: {
    readonly connectionId: string;
    readonly source: "run.usage";
    readonly usage: NormalizedUsage;
  }): Promise<void> {
    this.runSamples.push(input);
    return Promise.resolve();
  }
}

export class LocalNoSilentPaidFallback implements NoSilentPaidFallbackPort {
  readonly refusals: unknown[] = [];

  refuseSilentPaidFallback(input: {
    readonly connectionId: string;
    readonly from: "cursor_subscription";
    readonly to: "paid_api_key";
  }): Promise<void> {
    this.refusals.push(input);
    return Promise.resolve();
  }
}

export class MemoryNoticeSink implements CursorNoticeSink {
  readonly notices: CursorNotice[] = [];

  emit(notice: CursorNotice): void {
    this.notices.push(notice);
  }
}

export class MemoryParker implements CursorDispatchParkerPort {
  readonly parks: unknown[] = [];

  park(input: {
    readonly connectionId: string;
    readonly reason: "expired" | "unauthorized" | "on_demand";
    readonly preserveWip: true;
  }): Promise<void> {
    this.parks.push(input);
    return Promise.resolve();
  }
}

export class MemoryCheckpointStore implements AttemptCheckpointStorePort {
  private readonly records = new Map<string, CursorCheckpointRecord>();

  save(record: CursorCheckpointRecord): Promise<void> {
    this.records.set(record.sessionId, record);
    return Promise.resolve();
  }

  load(sessionId: string): Promise<CursorCheckpointRecord | null> {
    return Promise.resolve(this.records.get(sessionId) ?? null);
  }
}

export function createCursorRuntimeDeps(
  overrides: Partial<CursorRuntimeDeps> = {},
): CursorRuntimeDeps {
  const redactor = overrides.redactor ?? new SecretRedactor();
  const log = overrides.log ?? new MemoryAuditLog(redactor);
  const homeDir = overrides.homeDir ?? os.homedir();
  const sdk = overrides.sdk ?? new InMemoryCursorSdk();
  const fallbackKeys = new InMemoryCursorKeys();
  const keys = overrides.keys ?? fallbackKeys;
  const expiry = overrides.expiry ?? (keys instanceof InMemoryCursorKeys ? keys : fallbackKeys);
  return {
    sdk,
    acp: overrides.acp ?? new CursorGenericAcp(),
    usage: overrides.usage ?? sdk,
    jobs: overrides.jobs ?? new OsCursorJob(),
    sandbox: overrides.sandbox ?? new LocalSandboxTierSelector(),
    proxy: overrides.proxy ?? new AllowlistCursorProxy(),
    mcp: overrides.mcp ?? new AttemptMcpCursorLease(),
    cliGate: overrides.cliGate ?? new LocalCliMinVersionGate(),
    signedPolicy: overrides.signedPolicy ?? new LocalSignedCursorPolicy(),
    conformance: overrides.conformance ?? new LocalConformanceGate(),
    keys,
    expiry,
    pacing: overrides.pacing ?? new LocalAllowancePacing(),
    fallbackGuard: overrides.fallbackGuard ?? new LocalNoSilentPaidFallback(),
    notices: overrides.notices ?? new MemoryNoticeSink(),
    parker: overrides.parker ?? new MemoryParker(),
    checkpoints: overrides.checkpoints ?? new MemoryCheckpointStore(),
    log,
    redactor,
    personalCursorHome: overrides.personalCursorHome ?? path.join(homeDir, ".cursor"),
    homeDir,
    clock: overrides.clock ?? (() => Date.now()),
    ...(overrides.io ? { io: overrides.io } : {}),
    ...(overrides.launches ? { launches: overrides.launches } : {}),
  };
}

export function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function parseSemver(version: string): readonly [number, number, number] {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export const DEFAULT_CURSOR_MCP_TOOLS = DEFAULT_LEASED_MCP_TOOLS;

export type { CursorAgentUsageClient };
