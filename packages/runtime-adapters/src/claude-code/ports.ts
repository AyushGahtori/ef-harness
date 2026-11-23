import { spawn, spawnSync } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { quoteTokenMicroUsd } from "./money.js";
import { ClaudeCodeAdapterError } from "./errors.js";
import type {
  AttemptCheckpoint,
  ClaudeTokenUsage,
  ExecutionMode,
  SpendReceipt,
} from "./types.js";

/**
 * Local ports for sibling tasks that are not on this foundation base.
 * Swap each class for the real export named in `.agent-handoffs/task-147.md`.
 */

export interface CliGateDecision {
  readonly launchCodingTasks: boolean;
  readonly status: "allowed" | "disabled";
  readonly reason: "ok" | "missing" | "below_minimum" | "unknown_runtime";
  readonly minVersion: string | null;
}

/** Task 135 `CliMinVersionGate`. Runtime id on that branch is `claude`. */
export interface CliMinVersionGatePort {
  evaluate(runtime: string, installedVersion: string): CliGateDecision;
}

/** Task 135 `CompliancePolicyLocks.inspectCredential`. */
export interface CompliancePolicyLocksPort {
  inspectCredential(input: {
    readonly secret?: string;
    readonly kind?: string;
    readonly command?: string;
    readonly sourcePath?: string;
    readonly provider?: string;
  }): { readonly allowed: boolean; readonly code: string; readonly message: string };
}

/** Task 120 `WindowsDpapiSecretsVault`. */
export interface WindowsDpapiSecretsVaultPort {
  read(secretId: string): string | null;
}

/** Task 136 `ApiConnectionManager` console-key read. */
export interface ApiConnectionManagerPort {
  readConsoleKey(connectionId: string): string | null;
}

export interface MicroUsdRateCard {
  readonly modelId: string;
  readonly inputMicroUsdPer1M: bigint;
  readonly outputMicroUsdPer1M: bigint;
  readonly cacheReadMicroUsdPer1M: bigint;
  readonly cacheCreationMicroUsdPer1M: bigint;
}

/** Task 136 `VersionedPriceTableEstimator` integer micro-USD quote. */
export interface PriceTablePort {
  estimateMicroUsd(modelId: string, usage: ClaudeTokenUsage): { readonly microUsd: bigint; readonly priced: boolean };
}

export interface BudgetReservation {
  readonly reservationId: string;
  readonly remainingMicroUsd: bigint;
}

/** Task 023 `BudgetLedger` reservation and spend. */
export interface BudgetLedgerPort {
  reserve(input: {
    readonly attemptId: string;
    readonly connectionId: string;
    readonly ceilingMicroUsd: bigint;
  }): BudgetReservation;
  recordSpend(receipt: SpendReceipt): void;
  list(attemptId: string): readonly SpendReceipt[];
}

/** Task 150 `attempt_checkpoints` stand-in. */
export interface AttemptCheckpointPort {
  save(checkpoint: AttemptCheckpoint): void;
  latest(attemptId: string): AttemptCheckpoint | null;
}

export interface SandboxTierChoice {
  readonly tier: string;
  readonly hold: boolean;
  readonly reason: string;
}

/** Task 045 `SandboxTierSelector` (sibling publish may be Task 043). */
export interface SandboxTierSelectorPort {
  selectTier(input: {
    readonly runtime: string;
    readonly worktreeRoot: string;
    readonly requestedMode: ExecutionMode;
  }): SandboxTierChoice;
}

export interface JobAssignment {
  readonly jobId: string;
}

/** Task 041 `WindowsJobSupervisor` (sibling primitive may be Task 040 `WindowsJobManager`). */
export interface WindowsJobSupervisorPort {
  create(sessionId: string): JobAssignment;
  attach(jobId: string, pid: number): void;
  list(jobId: string): readonly number[];
  kill(jobId: string, reason: string): readonly number[];
}

export interface ProxyBinding {
  readonly endpoint: string;
  readonly env: Readonly<Record<string, string>>;
}

/** Task 046 loopback allowlist proxy. Injects Console auth outside the child env. */
export interface LoopbackAllowlistProxyPort {
  bind(input: { readonly sessionId: string; readonly connectionId: string }): ProxyBinding;
}

export interface McpLease {
  readonly leaseId: string;
  readonly endpoint: string;
  readonly tools: readonly string[];
}

/** Task 049 leased harness MCP server. */
export interface LeasedMcpServerPort {
  lease(input: { readonly sessionId: string; readonly tools: readonly string[] }): McpLease;
}

/** Task 011 `PacketSecurityRedactor`. */
export interface PacketSecurityRedactorPort {
  register(secret: string): void;
  redact(text: string): string;
  redactValue(value: unknown): unknown;
}

export interface SpawnedChild {
  readonly pid: number | undefined;
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
}

export interface SpawnRequest {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface ProcessSpawner {
  spawn(command: string, args: readonly string[], request: SpawnRequest): SpawnedChild;
}

export const DEFAULT_LEASED_MCP_TOOLS = [
  "kb.*",
  "harness.run",
  "harness.read_result",
  "harness.read_file",
  "harness.write_file",
  "harness.edit_file",
] as const;

export const DEFAULT_CLAUDE_MIN_VERSION = "2.1.0";

export class LocalCliMinVersionGate implements CliMinVersionGatePort {
  private readonly floors = new Map<string, string>();

  constructor(floors: Readonly<Record<string, string>> = { claude: DEFAULT_CLAUDE_MIN_VERSION }) {
    for (const [runtime, version] of Object.entries(floors)) this.floors.set(runtime, version);
    if (this.floors.has("claude") && !this.floors.has("claude-code")) {
      this.floors.set("claude-code", this.floors.get("claude") ?? DEFAULT_CLAUDE_MIN_VERSION);
    }
  }

  evaluate(runtime: string, installedVersion: string): CliGateDecision {
    const floor = this.floors.get(runtime) ?? null;
    if (!floor) {
      return { launchCodingTasks: false, status: "disabled", reason: "unknown_runtime", minVersion: null };
    }
    if (!installedVersion.trim()) {
      return { launchCodingTasks: false, status: "disabled", reason: "missing", minVersion: floor };
    }
    if (compareSemver(installedVersion, floor) < 0) {
      return { launchCodingTasks: false, status: "disabled", reason: "below_minimum", minVersion: floor };
    }
    return { launchCodingTasks: true, status: "allowed", reason: "ok", minVersion: floor };
  }
}

export class LocalWindowsDpapiSecretsVault implements WindowsDpapiSecretsVaultPort {
  constructor(private readonly secrets: ReadonlyMap<string, string> = new Map()) {}

  read(secretId: string): string | null {
    return this.secrets.get(secretId) ?? null;
  }
}

export class LocalApiConnectionManager implements ApiConnectionManagerPort {
  constructor(
    private readonly vault: WindowsDpapiSecretsVaultPort,
    private readonly connectionToSecretId: ReadonlyMap<string, string> = new Map(),
  ) {}

  readConsoleKey(connectionId: string): string | null {
    const secretId = this.connectionToSecretId.get(connectionId);
    if (!secretId) return null;
    return this.vault.read(secretId);
  }
}

export class LocalPriceTable implements PriceTablePort {
  private readonly cards = new Map<string, MicroUsdRateCard>();

  constructor(cards: readonly MicroUsdRateCard[] = []) {
    for (const card of cards) this.cards.set(card.modelId, card);
  }

  estimateMicroUsd(
    modelId: string,
    usage: ClaudeTokenUsage,
  ): { readonly microUsd: bigint; readonly priced: boolean } {
    const card = this.cards.get(modelId);
    if (!card) return { microUsd: 0n, priced: false };
    return {
      priced: true,
      microUsd: quoteTokenMicroUsd({
        inputTokens: BigInt(usage.inputTokens),
        outputTokens: BigInt(usage.outputTokens),
        cacheReadInputTokens: BigInt(usage.cacheReadInputTokens),
        cacheCreationInputTokens: BigInt(usage.cacheCreationInputTokens),
        inputMicroUsdPer1M: card.inputMicroUsdPer1M,
        outputMicroUsdPer1M: card.outputMicroUsdPer1M,
        cacheReadMicroUsdPer1M: card.cacheReadMicroUsdPer1M,
        cacheCreationMicroUsdPer1M: card.cacheCreationMicroUsdPer1M,
      }),
    };
  }
}

export class LocalBudgetLedger implements BudgetLedgerPort {
  private readonly receipts: SpendReceipt[] = [];
  private sequence = 0;

  reserve(input: {
    readonly attemptId: string;
    readonly connectionId: string;
    readonly ceilingMicroUsd: bigint;
  }): BudgetReservation {
    if (input.ceilingMicroUsd <= 0n) {
      throw new ClaudeCodeAdapterError("budget_not_positive", "Claude Code requires a positive BudgetLedger reservation");
    }
    this.sequence += 1;
    return {
      reservationId: `reserve-${input.attemptId}-${this.sequence}`,
      remainingMicroUsd: input.ceilingMicroUsd,
    };
  }

  recordSpend(receipt: SpendReceipt): void {
    this.receipts.push(receipt);
  }

  list(attemptId: string): readonly SpendReceipt[] {
    return this.receipts.filter((receipt) => receipt.attemptId === attemptId);
  }
}

export class LocalAttemptCheckpoints implements AttemptCheckpointPort {
  private readonly rows: AttemptCheckpoint[] = [];

  save(checkpoint: AttemptCheckpoint): void {
    this.rows.push(checkpoint);
  }

  latest(attemptId: string): AttemptCheckpoint | null {
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      const row = this.rows[i];
      if (row?.attemptId === attemptId) return row;
    }
    return null;
  }
}

export class LocalSandboxTierSelector implements SandboxTierSelectorPort {
  constructor(
    private readonly tier = "B",
    private readonly hold = false,
  ) {}

  selectTier(): SandboxTierChoice {
    if (this.hold) {
      return { tier: this.tier, hold: true, reason: "sandbox tier is not available for Claude Code" };
    }
    return { tier: this.tier, hold: false, reason: `os sandbox tier ${this.tier}` };
  }
}

export class PidTrackingJobSupervisor implements WindowsJobSupervisorPort {
  private readonly jobs = new Map<string, Set<number>>();

  create(sessionId: string): JobAssignment {
    const jobId = `job-${sessionId}`;
    if (this.jobs.has(jobId)) {
      throw new ClaudeCodeAdapterError("job_exists", `Job ${jobId} already exists`);
    }
    this.jobs.set(jobId, new Set());
    return { jobId };
  }

  attach(jobId: string, pid: number): void {
    const pids = this.require(jobId);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new ClaudeCodeAdapterError("invalid_pid", "Job attach requires a positive pid");
    }
    pids.add(pid);
  }

  list(jobId: string): readonly number[] {
    return [...this.require(jobId)];
  }

  kill(jobId: string, reason: string): readonly number[] {
    void reason;
    const pids = [...this.require(jobId)];
    for (const pid of pids) killProcessTree(pid);
    this.jobs.set(jobId, new Set());
    return pids;
  }

  private require(jobId: string): Set<number> {
    const pids = this.jobs.get(jobId);
    if (!pids) throw new ClaudeCodeAdapterError("unknown_job", `Unknown job ${jobId}`);
    return pids;
  }
}

export function killProcessTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (!isMissingProcess(error)) throw error;
  }
}

export class LocalLoopbackAllowlistProxy implements LoopbackAllowlistProxyPort {
  constructor(private readonly endpoint = "http://127.0.0.1:9") {}

  bind(input: { readonly sessionId: string; readonly connectionId: string }): ProxyBinding {
    return {
      endpoint: this.endpoint,
      env: {
        HTTP_PROXY: this.endpoint,
        HTTPS_PROXY: this.endpoint,
        NO_PROXY: "127.0.0.1,localhost",
        EF_HARNESS_PROXY_AUTH: input.connectionId,
        EF_HARNESS_PROXY_SESSION: input.sessionId,
      },
    };
  }
}

export class LocalLeasedMcpServer implements LeasedMcpServerPort {
  lease(input: { readonly sessionId: string; readonly tools: readonly string[] }): McpLease {
    return {
      leaseId: `lease-${input.sessionId}`,
      endpoint: `http://127.0.0.1:9/mcp/${input.sessionId}`,
      tools: input.tools,
    };
  }
}

export class LocalPacketSecurityRedactor implements PacketSecurityRedactorPort {
  private readonly secrets = new Set<string>();

  register(secret: string): void {
    const trimmed = secret.trim();
    if (trimmed.length >= 8) this.secrets.add(trimmed);
  }

  redact(text: string): string {
    let out = text;
    for (const secret of this.secrets) out = out.split(secret).join("[REDACTED]");
    return out;
  }

  redactValue(value: unknown): unknown {
    if (typeof value === "string") return this.redact(value);
    if (Array.isArray(value)) return value.map((item) => this.redactValue(item));
    if (typeof value === "object" && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value)) out[key] = this.redactValue(inner);
      return out;
    }
    return value;
  }
}

export function nodeProcessSpawner(): ProcessSpawner {
  return {
    spawn(command, args, request): SpawnedChild {
      const child = spawn(command, [...args], {
        cwd: request.cwd,
        env: request.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
      return {
        pid: child.pid,
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        kill(signal) {
          return child.kill(signal);
        },
        once(event, listener) {
          child.once(event, listener);
        },
        on(event, listener) {
          if (event === "exit") child.on("exit", listener);
          else child.on("error", listener);
        },
      };
    },
  };
}

function compareSemver(installed: string, minimum: string): number {
  const left = parseSemver(installed);
  const right = parseSemver(minimum);
  if (!left || !right) return -1;
  for (let i = 0; i < 3; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

function parseSemver(value: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value.trim().replace(/^v/i, ""));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isMissingProcess(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}
