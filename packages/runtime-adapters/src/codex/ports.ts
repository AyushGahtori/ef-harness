import type {
  AttemptCheckpointRow,
  CodexConnection,
  NormalizedRuntimeEvent,
  SupervisionDecision,
  SupervisionRequest,
} from "./types.js";
import { LABELED_WIP_HEADER } from "./types.js";

/**
 * Local ports for sibling tasks that are not on this base (6497730).
 * Swap each export for the owner named in `.agent-handoffs/task-144.md`.
 */

/** Task 135 `CliMinVersionGate`. */
export interface CliGateDecision {
  readonly launchCodingTasks: boolean;
  readonly status: "allowed" | "version_too_old" | "missing";
  readonly minVersion: string;
  readonly installedVersion: string | null;
}

export interface CliMinVersionGatePort {
  evaluate(runtime: "codex", installedVersion: string | null): CliGateDecision;
}

/** Task 137 `SiwcTokenRefresher`. Single-flight refresh stays in that task. */
export interface SiwcTokenRefresherPort {
  refresh(input: { readonly connectionId: string }): Promise<{
    readonly accessToken: string;
    readonly expiresAtMs: number;
  }>;
}

export interface BurnRateObservation {
  readonly connectionId: string;
  readonly modelId: string;
  readonly primaryPpm: number;
  readonly secondaryPpm: number;
  readonly primaryResetAt: string;
  readonly secondaryResetAt: string;
  readonly deltaPrimaryPpm: number;
  readonly phase: "session_start" | "turn_completed";
}

export interface BurnRateWindowTrackerPort {
  observe(input: BurnRateObservation): {
    readonly windowUsedPpm: number;
    readonly windDown: boolean;
    readonly pacingState: "normal" | "wind_down" | "window_exhausted";
  };
}

export interface ModelWeightObservation {
  readonly connectionId: string;
  readonly modelId: string;
  readonly deltaPpm: number;
  readonly effectiveTokens: number;
}

/** Task 140 `ModelAllowanceWeightLearner` (`k[model]` ppm per 1k tokens). */
export interface ModelAllowanceWeightLearnerPort {
  observe(input: ModelWeightObservation): { readonly kPer1kTokens: number | null };
}

/** Task 140 `AllowancePacingController` facade over the two trackers above. */
export interface AllowancePacingControllerPort {
  readonly burn: BurnRateWindowTrackerPort;
  readonly weights: ModelAllowanceWeightLearnerPort;
}

/** Task 142 `DeterministicSupervisionPolicyEngine`. */
export interface DeterministicSupervisionPolicyEnginePort {
  decide(input: {
    readonly worktreeRoot: string;
    readonly writeScope: readonly string[];
    readonly request: SupervisionRequest;
  }): SupervisionDecision;
}

/** Task 142 normalized event sink. */
export interface NormalizedRuntimeEventBusPort {
  publish(event: NormalizedRuntimeEvent): void;
  history(sessionId: string): readonly NormalizedRuntimeEvent[];
  close(sessionId: string): void;
}

export interface MxcAlignment {
  readonly sandboxMode: "workspace-write";
  readonly windowsMechanism: "mxc";
  readonly writableRoots: readonly string[];
  readonly network: "disabled-except-loopback-proxy";
  readonly proxy: string;
}

/** Task 042 `TierAMxcSandbox`. */
export interface TierAMxcSandboxPort {
  align(input: { readonly worktreeRoot: string; readonly loopbackProxy: string }): MxcAlignment;
}

export interface JobAssignment {
  readonly jobId: string;
}

/** Task 041 `WindowsJobSupervisor`. */
export interface WindowsJobPort {
  create(sessionId: string): JobAssignment;
  attach(jobId: string, pid: number): void;
  list(jobId: string): readonly number[];
  kill(jobId: string, reason: string): readonly number[];
}

/** Task 053 / Task 150 `attempt_checkpoints` row. */
export interface AttemptCheckpointStorePort {
  upsert(row: AttemptCheckpointRow): void;
  read(attempt: string): AttemptCheckpointRow | null;
}

/** Task 037 dirty snapshot, used when a child exits mid-turn. */
export interface WipSnapshotPort {
  capture(worktreeRoot: string): { readonly wipTreeSha: string; readonly preserved: true };
}

export interface ResumeHandoff {
  readonly action: "thread_resume" | "fresh_session";
  readonly label: string;
}

/** Task 150 resume coordinator. */
export interface ResumeHandoffPort {
  onChildExit(input: {
    readonly attemptId: string;
    readonly threadId: string | null;
    readonly exitCode: number;
    readonly wipTreeSha: string;
  }): ResumeHandoff;
}

/** Task 115 additive versus contradictory steering. */
export interface SteeringDispositionPort {
  classify(input: { readonly note: string }): "additive" | "contradictory";
}

/** Task 150 labeled WIP fresh-session rebuild. */
export interface LabeledWipRebuilderPort {
  rebuild(input: {
    readonly attemptId: string;
    readonly threadId: string | null;
    readonly reason: "contradiction" | "resume_failure" | "child_exit";
    readonly wipTreeSha: string | null;
  }): { readonly sessionKind: "fresh"; readonly label: string };
}

export interface RedactorPort {
  seal(secret: string): void;
  redact(text: string): string;
}

/**
 * Task 143 `GenericAcpAdapter` driving `codex-acp`.
 * The local driver in `acp-fallback.ts` is the stand-in process.
 */
export interface GenericAcpSessionSpec {
  readonly harnessSessionId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly worktreeRoot: string;
  readonly writeScope: readonly string[];
  readonly mcpEndpoint: string;
  readonly brief: string;
}

export interface GenericAcpAdapterPort {
  startSession(
    spec: GenericAcpSessionSpec,
  ): Promise<{ readonly sessionId: string; readonly nativeSessionId: string; readonly pid: number }>;
  sendTurn(sessionId: string, prompt: string): Promise<{ readonly turnId: string; readonly stopReason: "completed" | "interrupted" | "failed" }>;
  steer(sessionId: string, note: string): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  resume(sessionId: string, nativeSessionId: string): Promise<{ readonly ok: boolean; readonly threadId: string }>;
  usage(sessionId: string): Promise<{
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly outputTokens: number;
    readonly reasoningTokens: number;
  }>;
  close(sessionId: string): Promise<void>;
}

export class LocalCliMinVersionGate implements CliMinVersionGatePort {
  constructor(private readonly minVersion: string) {}

  evaluate(_runtime: "codex", installedVersion: string | null): CliGateDecision {
    if (!installedVersion) {
      return {
        launchCodingTasks: false,
        status: "missing",
        minVersion: this.minVersion,
        installedVersion: null,
      };
    }
    if (compareSemver(installedVersion, this.minVersion) < 0) {
      return {
        launchCodingTasks: false,
        status: "version_too_old",
        minVersion: this.minVersion,
        installedVersion,
      };
    }
    return {
      launchCodingTasks: true,
      status: "allowed",
      minVersion: this.minVersion,
      installedVersion,
    };
  }
}

export class LocalBurnRateWindowTracker implements BurnRateWindowTrackerPort {
  readonly observations: BurnRateObservation[] = [];

  observe(input: BurnRateObservation): {
    readonly windowUsedPpm: number;
    readonly windDown: boolean;
    readonly pacingState: "normal" | "wind_down" | "window_exhausted";
  } {
    this.observations.push(input);
    const windowUsedPpm = Math.max(input.primaryPpm, input.secondaryPpm);
    if (windowUsedPpm >= 1_000_000) {
      return { windowUsedPpm, windDown: true, pacingState: "window_exhausted" };
    }
    if (input.primaryPpm >= 900_000 || input.secondaryPpm >= 900_000) {
      return { windowUsedPpm, windDown: true, pacingState: "wind_down" };
    }
    return { windowUsedPpm, windDown: false, pacingState: "normal" };
  }
}

export class LocalModelAllowanceWeightLearner implements ModelAllowanceWeightLearnerPort {
  readonly observations: ModelWeightObservation[] = [];
  private readonly weights = new Map<string, number>();

  observe(input: ModelWeightObservation): { readonly kPer1kTokens: number | null } {
    this.observations.push(input);
    const key = `${input.connectionId}\u0000${input.modelId}`;
    if (input.effectiveTokens <= 0 || input.deltaPpm === 0) {
      return { kPer1kTokens: this.weights.get(key) ?? null };
    }
    const sample = (input.deltaPpm / input.effectiveTokens) * 1000;
    const prior = this.weights.get(key);
    const next = prior === undefined ? sample : prior * 0.5 + sample * 0.5;
    this.weights.set(key, next);
    return { kPer1kTokens: next };
  }
}

export class LocalAllowancePacingController implements AllowancePacingControllerPort {
  readonly burn = new LocalBurnRateWindowTracker();
  readonly weights = new LocalModelAllowanceWeightLearner();
}

export class LocalTierAMxcSandbox implements TierAMxcSandboxPort {
  align(input: { readonly worktreeRoot: string; readonly loopbackProxy: string }): MxcAlignment {
    return {
      sandboxMode: "workspace-write",
      windowsMechanism: "mxc",
      writableRoots: [input.worktreeRoot],
      network: "disabled-except-loopback-proxy",
      proxy: input.loopbackProxy,
    };
  }
}

export class MemoryCheckpointStore implements AttemptCheckpointStorePort {
  private readonly rows = new Map<string, AttemptCheckpointRow>();

  upsert(row: AttemptCheckpointRow): void {
    this.rows.set(row.attempt, row);
  }

  read(attempt: string): AttemptCheckpointRow | null {
    return this.rows.get(attempt) ?? null;
  }
}

export class LocalWipSnapshot implements WipSnapshotPort {
  readonly captures: string[] = [];

  capture(worktreeRoot: string): { readonly wipTreeSha: string; readonly preserved: true } {
    this.captures.push(worktreeRoot);
    return { wipTreeSha: `wip:${worktreeRoot}`, preserved: true };
  }
}

export class LocalResumeHandoff implements ResumeHandoffPort {
  readonly exits: Array<{
    readonly attemptId: string;
    readonly threadId: string | null;
    readonly exitCode: number;
    readonly wipTreeSha: string;
  }> = [];

  onChildExit(input: {
    readonly attemptId: string;
    readonly threadId: string | null;
    readonly exitCode: number;
    readonly wipTreeSha: string;
  }): ResumeHandoff {
    this.exits.push(input);
    return {
      action: "fresh_session",
      label: LABELED_WIP_HEADER,
    };
  }
}

export class LocalSteeringDisposition implements SteeringDispositionPort {
  constructor(private readonly forced: "additive" | "contradictory" = "additive") {}

  classify(): "additive" | "contradictory" {
    return this.forced;
  }
}

export class LocalLabeledWipRebuilder implements LabeledWipRebuilderPort {
  readonly rebuilds: Array<{
    readonly attemptId: string;
    readonly threadId: string | null;
    readonly reason: "contradiction" | "resume_failure" | "child_exit";
    readonly label: string;
  }> = [];

  rebuild(input: {
    readonly attemptId: string;
    readonly threadId: string | null;
    readonly reason: "contradiction" | "resume_failure" | "child_exit";
    readonly wipTreeSha: string | null;
  }): { readonly sessionKind: "fresh"; readonly label: string } {
    const label = LABELED_WIP_HEADER;
    this.rebuilds.push({
      attemptId: input.attemptId,
      threadId: input.threadId,
      reason: input.reason,
      label,
    });
    return { sessionKind: "fresh", label };
  }
}

export class LocalRedactor implements RedactorPort {
  private readonly secrets: string[] = [];

  seal(secret: string): void {
    if (secret.length > 0 && !this.secrets.includes(secret)) this.secrets.push(secret);
  }

  redact(text: string): string {
    let next = text;
    for (const secret of this.secrets) {
      if (secret.length === 0) continue;
      next = next.split(secret).join("[redacted]");
    }
    return next;
  }
}

export class LocalEventBus implements NormalizedRuntimeEventBusPort {
  private readonly events: NormalizedRuntimeEvent[] = [];
  private readonly closed = new Set<string>();
  private readonly waiters = new Map<string, Array<() => void>>();

  publish(event: NormalizedRuntimeEvent): void {
    this.events.push(event);
    this.wake(event.sessionId);
  }

  history(sessionId: string): readonly NormalizedRuntimeEvent[] {
    return this.events.filter((event) => event.sessionId === sessionId);
  }

  close(sessionId: string): void {
    this.closed.add(sessionId);
    this.wake(sessionId);
  }

  isClosed(sessionId: string): boolean {
    return this.closed.has(sessionId);
  }

  wait(sessionId: string): Promise<void> {
    if (this.closed.has(sessionId)) return Promise.resolve();
    return new Promise((resolve) => {
      const pending = this.waiters.get(sessionId) ?? [];
      pending.push(resolve);
      this.waiters.set(sessionId, pending);
    });
  }

  private wake(sessionId: string): void {
    const pending = this.waiters.get(sessionId) ?? [];
    this.waiters.set(sessionId, []);
    for (const resolve of pending) resolve();
  }
}

export function compareSemver(installed: string, minimum: string): number {
  const left = parseSemver(installed);
  const right = parseSemver(minimum);
  if (!left || !right) return -1;
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

function parseSemver(value: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value.trim().replace(/^v/i, ""));
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) return null;
  return [major, minor, patch];
}

export function connectionIdOf(connection: CodexConnection): string {
  return connection.connectionId;
}
