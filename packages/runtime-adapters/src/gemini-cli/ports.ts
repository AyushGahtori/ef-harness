import type { ChildProcess } from "node:child_process";
import { OsWindowsJob, sharedAllowlistProxy } from "../acp/os-boundary.js";
import { GEMINI_MIN_VERSION, GEMINI_ROUTE_ID, SETTINGS_KEY } from "./constants.js";
import { terminatePidTree, type ProcessSpawner } from "./process-util.js";

/**
 * Local ports stand in for sibling contracts that are not on this base.
 * Swap map (also recorded in the task handoff):
 * - MemoryGlobalSettingsStore -> Task 014 global.db settings[gemini_cli.opt_in]
 * - LocalCliMinVersionGate -> Task 135 CliMinVersionGate (runtime "gemini")
 * - LocalTierAMxcSandbox -> Task 042 TierAMxcSandbox
 * - LocalJobObject -> Task 041 Windows Job Object supervisor
 * - LocalLoopbackAllowlistProxy -> Task 046 loopback allowlist proxy
 * - LocalSilentPaidFallbackGuard -> Task 141 no-silent-paid-fallback
 * - LocalHarnessRunRecorder -> Task 048 / Task 049 harness.run MCP
 * - LocalGenericAcpAdapter -> Task 143 GenericAcpAdapter
 * - LocalSupervisionPolicyEngine -> Task 142 DeterministicSupervisionPolicyEngine
 * - LocalPacingClassifier -> Task 140 RateLimitVsUsageLimitClassifier
 */

export interface GlobalSettingsStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const GLOBAL_OPT_IN_KEY = SETTINGS_KEY;

export interface OptInRecord {
  readonly optedInAt: string;
  readonly noticeVersion: string;
  readonly enabled: boolean;
  readonly revoked: boolean;
  readonly revocationNotice: string | null;
}

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export function parseSemVer(text: string): SemVer | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function semverGte(left: SemVer, right: SemVer): boolean {
  if (left.major !== right.major) return left.major > right.major;
  if (left.minor !== right.minor) return left.minor > right.minor;
  return left.patch >= right.patch;
}

export interface CliGateResult {
  readonly allowed: boolean;
  readonly supportsAcp: boolean;
  readonly version: string;
  readonly reason: "ok" | "binary_missing" | "below_minimum" | "missing_acp_flag" | "unparseable";
}

/** Local port of Task 135 CliMinVersionGate for the gemini runtime. */
export class LocalCliMinVersionGate {
  constructor(private readonly floor: string = GEMINI_MIN_VERSION) {}

  evaluate(versionText: string, helpText: string): CliGateResult {
    const supportsAcp = helpText.includes("--acp");
    const parsed = parseSemVer(versionText);
    const floor = parseSemVer(this.floor);
    const shown = parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : versionText.trim();
    if (!supportsAcp) {
      return { allowed: false, supportsAcp: false, version: shown, reason: "missing_acp_flag" };
    }
    if (!parsed || !floor) {
      return { allowed: false, supportsAcp: true, version: shown, reason: "unparseable" };
    }
    if (!semverGte(parsed, floor)) {
      return { allowed: false, supportsAcp: true, version: shown, reason: "below_minimum" };
    }
    return { allowed: true, supportsAcp: true, version: shown, reason: "ok" };
  }
}

export interface SandboxAttachment {
  readonly pid: number | null;
  readonly worktree: string;
  readonly mode: "wrapped" | "stripped";
  readonly loopbackProxy: string;
}

/** Local port of Task 042 TierAMxcSandbox. */
export class LocalTierAMxcSandbox {
  readonly attachments: SandboxAttachment[] = [];

  attach(input: SandboxAttachment): void {
    this.attachments.push(input);
  }
}

/** Local port of Task 041 Windows Job Object. */
export class LocalJobObject {
  private readonly children: ChildProcess[] = [];
  private readonly inner = new OsWindowsJob();
  private jobId: string | null = null;

  async attach(child: ChildProcess): Promise<void> {
    this.children.push(child);
    const pid = child.pid;
    if (typeof pid !== "number" || pid <= 0) return;
    this.jobId ??= (await this.inner.create(`gemini-${pid}`)).jobId;
    await this.inner.attach(this.jobId, pid);
  }

  get pids(): readonly (number | undefined)[] {
    return this.children.map((child) => child.pid);
  }

  async terminate(): Promise<void> {
    if (this.jobId) await this.inner.kill(this.jobId, "terminate");
    const pending: Promise<void>[] = [];
    for (const child of this.children) {
      const pid = child.pid;
      if (pid === undefined) {
        child.kill("SIGKILL");
        continue;
      }
      pending.push(terminatePidTree(pid));
    }
    await Promise.all(pending);
  }
}

/** Local port of the loopback allowlist proxy named by Task 148. */
export class LocalLoopbackAllowlistProxy {
  readonly binds: string[] = [];
  private pending: Promise<string> | null = null;

  endpoint(): Promise<string> {
    this.pending ??= sharedAllowlistProxy("gemini-cli").then((server) => {
      this.binds.push(server.proxyUrl);
      return server.proxyUrl;
    });
    return this.pending;
  }
}

export interface SilentFallbackInput {
  readonly fromRouteId: string;
  readonly toBilling: "api_key" | "plan" | "local";
  readonly explicitUserChoice: boolean;
}

export interface SilentFallbackDecision {
  readonly accepted: boolean;
  readonly reason: "no_silent_paid_fallback" | "explicit_user_choice" | "refused";
}

/** Local port of Task 141. Silent switches onto a paid API key are refused. */
export class LocalSilentPaidFallbackGuard {
  consider(input: SilentFallbackInput): SilentFallbackDecision {
    if (!input.explicitUserChoice && input.toBilling === "api_key") {
      return { accepted: false, reason: "no_silent_paid_fallback" };
    }
    if (input.explicitUserChoice) {
      return { accepted: true, reason: "explicit_user_choice" };
    }
    return { accepted: false, reason: "refused" };
  }
}

export interface HarnessRunCall {
  readonly command: string;
  readonly cwd: string;
}

/** Local port of leased harness.run. Records the command; it does not execute it. */
export class LocalHarnessRunRecorder {
  readonly calls: HarnessRunCall[] = [];

  record(command: string, cwd: string): void {
    this.calls.push({ command, cwd });
  }
}

export interface UsageSnapshot {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
  readonly costMicroUsd: number | null;
}

export interface CheckpointStopCard {
  readonly kind: "checkpoint_stop";
  readonly reason: "usage_limit_exhausted";
  readonly usageLimitReason: "daily_quota";
  readonly routeId: typeof GEMINI_ROUTE_ID;
  readonly retryAllowed: false;
  readonly silentPaidFallback: false;
}

export interface LimitDecision {
  readonly kind: "none" | "transient_rpm" | "quota_exhaustion";
  readonly cwnd: number;
  readonly retryAllowed: boolean;
  readonly silentPaidFallback: false;
  readonly backoffMs: number | null;
  readonly stopCard: CheckpointStopCard | null;
}

export type PermissionOutcome = "allow_once" | "reject_once";

export interface PermissionDecision {
  readonly requestId: string;
  readonly outcome: PermissionOutcome;
  readonly reason: string;
  readonly harnessRun: HarnessRunCall | null;
}

export type NormalizedRuntimeEvent =
  | { readonly type: "turn_started"; readonly sessionId: string }
  | { readonly type: "assistant_delta"; readonly sessionId: string; readonly text: string }
  | { readonly type: "permission_requested"; readonly sessionId: string; readonly requestId: string; readonly tool: string }
  | {
      readonly type: "permission_decided";
      readonly sessionId: string;
      readonly requestId: string;
      readonly outcome: PermissionOutcome;
      readonly reason: string;
    }
  | { readonly type: "usage_reported"; readonly sessionId: string; readonly usage: UsageSnapshot }
  | { readonly type: "rate_limited"; readonly sessionId: string; readonly decision: LimitDecision }
  | { readonly type: "turn_completed"; readonly sessionId: string }
  | { readonly type: "session_error"; readonly sessionId: string; readonly message: string }
  | { readonly type: "session_exited"; readonly sessionId: string; readonly parked: boolean };

export interface McpServerSpec {
  readonly name: string;
  readonly endpoint: string;
  readonly bearer: string;
}

export interface AgentRuntimeAdapter {
  readonly runtime: "gemini-cli";
  probe(): Promise<CliGateResult>;
  authStatus(): Promise<{
    readonly enabled: boolean;
    readonly optedIn: boolean;
    readonly mode: "api_key" | "cli_login" | "unknown";
    readonly readsCredentialDirectory: false;
  }>;
  startSession(spec: SessionSpec): Promise<SessionStart>;
  sendTurn(sessionId: string, briefOrPrompt: string): Promise<TurnResult>;
  steer(sessionId: string, deltaNote: string): Promise<TurnResult>;
  interrupt(sessionId: string): Promise<void>;
  resume(sessionId: string, checkpointRef: string): Promise<{ readonly supported: boolean; readonly sessionId: string }>;
  events(sessionId: string): AsyncIterable<NormalizedRuntimeEvent>;
  respondPermission(
    sessionId: string,
    requestId: string,
    decision: { readonly outcome: PermissionOutcome },
  ): Promise<PermissionDecision>;
  usage(sessionId: string): Promise<UsageSnapshot>;
  terminate(sessionId: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface SessionSpec {
  readonly worktree: string;
  readonly writeScope: readonly string[];
  readonly mode?: "wrapped" | "stripped";
  readonly auth?: { readonly mode: "api_key"; readonly apiKey: string } | { readonly mode: "cli_login" };
  readonly mcp?: McpServerSpec;
  readonly skills?: readonly { readonly name: string; readonly body: string }[];
  readonly extraEnv?: Readonly<Record<string, string>>;
  readonly attemptId?: string;
}

export interface SessionStart {
  readonly sessionId: string;
  readonly mode: "wrapped" | "stripped";
  readonly geminiCliHome: string;
  readonly sandboxed: boolean;
  readonly jobAttached: boolean;
  readonly loopbackProxy: string;
  readonly pooled: boolean;
  readonly mcpServers: readonly string[];
}

export interface TurnResult {
  readonly stopReason: string;
  readonly permissionOutcome: string | null;
  readonly limit: LimitDecision;
  readonly usage: UsageSnapshot;
  readonly childHome: string | null;
  readonly childSawApiKey: boolean;
  readonly silentFallback: SilentFallbackDecision;
  readonly parked: boolean;
}

export interface LaunchRecord {
  readonly command: string;
  readonly args: readonly string[];
  readonly windowsHide: boolean;
  readonly geminiCliHome: string | null;
  readonly hasApiKey: boolean;
}

export type { ProcessSpawner };

export interface EngineDeps {
  readonly spawner: ProcessSpawner;
  readonly job: LocalJobObject;
}
