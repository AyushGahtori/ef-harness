import type {
  CheckpointFlushPort,
  ClaimGatePort,
  ColdOpenReconcilerPort,
  DaemonLifecycleClient,
  DaemonPresence,
  EnvironmentProbe,
  EventStreamReconnectPort,
  HardwareGovernorPort,
  ImmediateKernelStopPort,
  LifecyclePowerEvent,
  LifecycleShutdownRequest,
  LifecycleShutdownResponse,
  NamedPipeRequestPort,
  PopOutCloseReason,
  PopOutWindowPort,
  PowerTelemetry,
  PreferenceStore,
  RetryLedgerPort,
  SleepSkewGuardPort,
  SqliteCheckpointPort,
  StuckClockPort,
  WakeHealth,
  WakeReconcileResult,
  WindowHost,
  WindowsJobObjectPort,
} from "./ports.js";
import type { WalCheckpointMode, WalCheckpointResult } from "./types.js";

export class MemoryPreferenceStore implements PreferenceStore {
  private readonly values = new Map<string, string>();

  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.values.set(key, value);
  }
}

export class RecordingKernelStop implements ImmediateKernelStopPort {
  readonly pauses: { reason: string; graceMs: number }[] = [];
  readonly stops: { reason: string }[] = [];

  async pauseSafely(input: { readonly reason: string; readonly graceMs: number }): Promise<{
    readonly checkpointed: true;
    readonly wipPreserved: true;
    readonly llmCalls: 0;
    readonly elapsedMs: number;
    readonly orphanedPids: 0;
  }> {
    this.pauses.push({ reason: input.reason, graceMs: input.graceMs });
    return {
      checkpointed: true,
      wipPreserved: true,
      llmCalls: 0,
      elapsedMs: 0,
      orphanedPids: 0,
    };
  }

  async stopNow(input: { readonly reason: string }): Promise<{
    readonly stopped: true;
    readonly orphanedPids: 0;
    readonly llmCalls: 0;
    readonly elapsedMs: number;
  }> {
    this.stops.push({ reason: input.reason });
    return { stopped: true, orphanedPids: 0, llmCalls: 0, elapsedMs: 0 };
  }
}

export class RecordingPopOuts implements PopOutWindowPort {
  readonly closedReasons: PopOutCloseReason[] = [];
  openIds: string[] = [];

  get openCount(): number {
    return this.openIds.length;
  }

  async closeAll(
    reason: PopOutCloseReason,
  ): Promise<{ readonly closed: number; readonly reason: PopOutCloseReason }> {
    const closed = this.openIds.length;
    this.openIds = [];
    this.closedReasons.push(reason);
    return { closed, reason };
  }
}

export class LocalColdOpenReconciler implements ColdOpenReconcilerPort {
  readonly calls: Parameters<ColdOpenReconcilerPort["reconcile"]>[0][] = [];

  reconcile(input: Parameters<ColdOpenReconcilerPort["reconcile"]>[0]): WakeReconcileResult {
    this.calls.push(input);
    return { showWelcome: false, wakeNote: null, tokensSpent: 0 };
  }
}

export class LocalSleepSkewGuard implements SleepSkewGuardPort {
  lastSleepMs = 0;
  expirySweeperSuspended = false;
  spuriousLeaseExpiries = 0;

  onResume(input: {
    readonly suspendedAt: number;
    readonly resumedAt: number;
    readonly sleepDurationMs: number;
  }): { readonly expirySweeperSuspended: true; readonly spuriousLeaseExpiries: 0 } {
    this.lastSleepMs = input.sleepDurationMs;
    this.expirySweeperSuspended = true;
    this.spuriousLeaseExpiries = 0;
    return { expirySweeperSuspended: true, spuriousLeaseExpiries: 0 };
  }
}

export class LocalStuckClockGuard implements StuckClockPort {
  private readonly elapsed = new Map<string, number>();
  private pausedFlag = false;
  private compensatedFor: number | null = null;
  pausedAt: number | null = null;
  lastIgnoredSleepMs = 0;

  get paused(): boolean {
    return this.pausedFlag;
  }

  register(workerId: string, activeMs: number): void {
    this.elapsed.set(workerId, activeMs);
  }

  pauseForSleep(at: number): void {
    this.pausedAt = at;
    this.pausedFlag = true;
  }

  compensateOnResume(
    sleepDurationMs: number,
    suspendedAt: number,
  ): { readonly addedStuckMs: 0; readonly falseAlarms: 0 } {
    if (this.compensatedFor === suspendedAt) {
      return { addedStuckMs: 0, falseAlarms: 0 };
    }
    this.compensatedFor = suspendedAt;
    this.pausedFlag = false;
    this.lastIgnoredSleepMs = sleepDurationMs;
    return { addedStuckMs: 0, falseAlarms: 0 };
  }

  activeMs(workerId: string): number {
    return this.elapsed.get(workerId) ?? 0;
  }

  stuckLabel(workerId: string, thresholdMs: number): string | null {
    if (this.pausedFlag) return null;
    const active = this.activeMs(workerId);
    if (active >= thresholdMs) return `Stuck for ${Math.round(active / 60_000)}m`;
    return null;
  }
}

export class LocalHardwareGovernor implements HardwareGovernorPort {
  readonly events: PowerTelemetry[] = [];

  reportPowerSource(input: PowerTelemetry): void {
    this.events.push(input);
  }
}

export class ScriptedEnvironmentProbe implements EnvironmentProbe {
  constructor(private health: WakeHealth) {}

  setHealth(health: WakeHealth): void {
    this.health = health;
  }

  async probe(): Promise<WakeHealth> {
    return this.health;
  }
}

export const HEALTHY_ENVIRONMENT: WakeHealth = {
  networkOnline: true,
  repoChanged: false,
  providerReachable: true,
  localDbHealthy: true,
  testEnvHealthy: true,
};

export class LocalClaimGate implements ClaimGatePort {
  paused = false;
  reason = "";
  readonly history: string[] = [];

  pause(reason: string): void {
    this.paused = true;
    this.reason = reason;
    this.history.push(`pause:${reason}`);
  }

  resume(reason: string): void {
    this.paused = false;
    this.reason = reason;
    this.history.push(`resume:${reason}`);
  }
}

export class RecordingCheckpoints implements CheckpointFlushPort {
  readonly reasons: string[] = [];
  flushedTurns = 1;

  async flushActiveTurns(reason: string): Promise<{ readonly flushed: number; readonly wipPreserved: true }> {
    this.reasons.push(reason);
    return { flushed: this.flushedTurns, wipPreserved: true };
  }
}

export class RecordingJobObjects implements WindowsJobObjectPort {
  private pids: number[] = [];
  readonly terminations: string[] = [];

  setChildren(pids: readonly number[]): void {
    this.pids = [...pids];
  }

  activeChildPids(): readonly number[] {
    return this.pids;
  }

  terminateJobObject(reason: string): {
    readonly terminatedPids: readonly number[];
    readonly orphanedPids: readonly number[];
  } {
    this.terminations.push(reason);
    const terminatedPids = this.pids;
    this.pids = [];
    return { terminatedPids, orphanedPids: [] };
  }
}

export class RecordingSqlite implements SqliteCheckpointPort {
  readonly modes: WalCheckpointMode[] = [];

  async walCheckpoint(mode: WalCheckpointMode): Promise<WalCheckpointResult> {
    this.modes.push(mode);
    return { busy: 0, log: 0, checkpointed: 0 };
  }
}

export class RecordingEventStream implements EventStreamReconnectPort {
  readonly reasons: string[] = [];
  streamEpoch = 7;

  async resync(input: { readonly reason: string }): Promise<{
    readonly streamEpoch: number;
    readonly lostEvents: 0;
    readonly elapsedMs: number;
  }> {
    this.reasons.push(input.reason);
    return { streamEpoch: this.streamEpoch, lostEvents: 0, elapsedMs: 5 };
  }
}

export class LocalRetryLedger implements RetryLedgerPort {
  private burnedCount = 0;
  readonly noted: number[] = [];

  noteSleepCompensated(sleepDurationMs: number): { readonly burnedRetries: 0 } {
    this.noted.push(sleepDurationMs);
    return { burnedRetries: 0 };
  }

  burned(): number {
    return this.burnedCount;
  }
}

export class RecordingWindowHost implements WindowHost {
  visible = true;
  destroyed = false;
  focused = false;
  lastLaunch: WindowHost["lastLaunch"] = null;

  hideMain(): void {
    this.visible = false;
  }

  showMain(): void {
    this.destroyed = false;
    this.visible = true;
  }

  focusMain(): void {
    this.focused = true;
    this.visible = true;
    this.destroyed = false;
  }

  destroyRenderers(): void {
    this.destroyed = true;
    this.visible = false;
  }

  isMainVisible(): boolean {
    return this.visible;
  }

  isRendererDestroyed(): boolean {
    return this.destroyed;
  }

  deliverLaunch(launch: NonNullable<WindowHost["lastLaunch"]>): void {
    this.lastLaunch = launch;
  }
}

export class RecordingDaemonPresence implements DaemonPresence {
  private living = true;
  shutdownCalls = 0;

  alive(): boolean {
    return this.living;
  }

  kill(): void {
    this.living = false;
  }

  noteShutdown(): void {
    this.shutdownCalls += 1;
    this.living = false;
  }
}

export class RecordingDaemonClient implements DaemonLifecycleClient {
  readonly shutdowns: LifecycleShutdownRequest[] = [];
  readonly power: LifecyclePowerEvent[] = [];

  async shutdown(request: LifecycleShutdownRequest): Promise<LifecycleShutdownResponse> {
    this.shutdowns.push(request);
    const exiting = request.mode === "drain_and_exit";
    return {
      ok: true,
      mode: request.mode,
      exited: exiting,
      daemonKeptRunning: !exiting,
      orphanedProcesses: 0,
      elapsedMs: 0,
      timedOut: false,
      stateDbIntact: true,
      walModes: exiting ? ["PASSIVE", "TRUNCATE"] : [],
      buildsInterrupted: exiting && request.idle !== true,
      uiDetached: request.mode === "detach_ui_keep_running",
    };
  }

  async notifyPower(event: LifecyclePowerEvent): Promise<void> {
    this.power.push(event);
  }
}

export class InMemoryNamedPipe implements NamedPipeRequestPort {
  readonly messages: { method: "POST"; path: string; body: unknown }[] = [];

  async request(message: {
    readonly method: "POST";
    readonly path: string;
    readonly body: unknown;
  }): Promise<unknown> {
    this.messages.push({ method: message.method, path: message.path, body: message.body });
    return { ok: true };
  }
}

export function healthyProbe(): ScriptedEnvironmentProbe {
  return new ScriptedEnvironmentProbe(HEALTHY_ENVIRONMENT);
}
