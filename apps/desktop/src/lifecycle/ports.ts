import type {
  BuildActivity,
  ShutdownMode,
  WakeBand,
  WalCheckpointMode,
  WalCheckpointResult,
} from "./types.js";

/**
 * Local stand-ins for sibling tasks that are not on this foundation branch.
 * Integrators replace these ports with the named exports from those tasks.
 */

export interface LifecycleShutdownRequest {
  readonly mode: ShutdownMode;
  readonly reason: string;
  readonly deadlineMs: number;
  readonly idle?: boolean;
}

export interface LifecycleShutdownResponse {
  readonly ok: true;
  readonly mode: ShutdownMode;
  readonly exited: boolean;
  readonly daemonKeptRunning: boolean;
  readonly orphanedProcesses: 0;
  readonly elapsedMs: number;
  readonly timedOut: boolean;
  readonly stateDbIntact: true;
  readonly walModes: readonly WalCheckpointMode[];
  readonly buildsInterrupted: boolean;
  readonly uiDetached: boolean;
}

export type LifecyclePowerEvent =
  | { readonly type: "suspend"; readonly at: number }
  | {
      readonly type: "resume";
      readonly at: number;
      readonly sleepDurationMs: number;
      readonly resumeClaiming: boolean;
    }
  | { readonly type: "shutdown"; readonly at: number }
  | {
      readonly type: "on-battery";
      readonly batteryPercent: number | null;
      readonly ecoOnBattery: boolean;
    }
  | { readonly type: "on-ac"; readonly ecoOnBattery: boolean }
  | { readonly type: "lock-screen"; readonly at: number }
  | { readonly type: "unlock-screen"; readonly at: number };

/** Task 031 NamedPipeClient. Transport only — never a localhost listener. */
export interface NamedPipeRequestPort {
  request(message: {
    readonly method: "POST";
    readonly path: string;
    readonly body: unknown;
  }): Promise<unknown>;
}

/** Task 067 detached harnessd, reached through the pipe. */
export interface DaemonLifecycleClient {
  shutdown(request: LifecycleShutdownRequest): Promise<LifecycleShutdownResponse>;
  notifyPower(event: LifecyclePowerEvent): Promise<void>;
}

/** Task 114 ImmediateKernelStopController. */
export interface ImmediateKernelStopPort {
  pauseSafely(input: { readonly reason: string; readonly graceMs: number }): Promise<{
    readonly checkpointed: true;
    readonly wipPreserved: true;
    readonly llmCalls: 0;
    readonly elapsedMs: number;
    readonly orphanedPids: 0;
  }>;
  stopNow(input: { readonly reason: string }): Promise<{
    readonly stopped: true;
    readonly orphanedPids: 0;
    readonly llmCalls: 0;
    readonly elapsedMs: number;
  }>;
}

/** Task 123 PopOutWindowCoordinator. */
export type PopOutCloseReason = "primary-quit" | "keep-building";

export interface PopOutWindowPort {
  closeAll(reason: PopOutCloseReason): Promise<{ readonly closed: number; readonly reason: PopOutCloseReason }>;
  readonly openCount: number;
}

/** Task 130 ColdOpenReconciler.reconcileAfterWake. */
export interface WakeHealth {
  readonly networkOnline: boolean;
  readonly repoChanged: boolean;
  readonly providerReachable: boolean;
  readonly localDbHealthy: boolean;
  readonly testEnvHealthy: boolean;
}

export interface WakeReconciliationInput extends WakeHealth {
  readonly sleepDurationMs: number;
  readonly band: WakeBand;
  readonly suspendedAt: number;
  readonly resumedAt: number;
}

export interface ColdOpenReconcilerPort {
  reconcileAfterWake(input: WakeReconciliationInput): Promise<{
    readonly welcomeBackRequired: boolean;
    readonly message: string;
    readonly burnedRetries: 0;
  }>;
}

/** Task 020 SleepSkewGuard. */
export interface SleepSkewGuardPort {
  onResume(input: {
    readonly suspendedAt: number;
    readonly resumedAt: number;
    readonly sleepDurationMs: number;
  }): {
    readonly expirySweeperSuspended: true;
    readonly spuriousLeaseExpiries: 0;
  };
}

/** Task 125 stuck-clock timers. */
export interface StuckClockPort {
  register(workerId: string, activeMs: number): void;
  pauseForSleep(at: number): void;
  compensateOnResume(
    sleepDurationMs: number,
    suspendedAt: number,
  ): { readonly addedStuckMs: 0; readonly falseAlarms: 0 };
  activeMs(workerId: string): number;
  stuckLabel(workerId: string, thresholdMs: number): string | null;
  readonly paused: boolean;
}

/** Task 118 Hardware Governor power telemetry. */
export interface PowerTelemetry {
  readonly source: "battery" | "ac";
  readonly batteryPercent: number | null;
  readonly ecoOnBattery: boolean;
  readonly ecoCap?: "eco";
}

export interface HardwareGovernorPort {
  reportPowerSource(input: PowerTelemetry): void;
  readonly events: readonly PowerTelemetry[];
}

export interface EnvironmentProbe {
  probe(): Promise<WakeHealth>;
}

export interface ClaimGatePort {
  pause(reason: string): void;
  resume(reason: string): void;
  readonly paused: boolean;
  readonly reason: string;
}

export interface CheckpointFlushPort {
  flushActiveTurns(reason: string): Promise<{ readonly flushed: number; readonly wipPreserved: true }>;
  readonly reasons: readonly string[];
}

export interface WindowsJobObjectPort {
  activeChildPids(): readonly number[];
  terminateJobObject(reason: string): { readonly terminatedPids: readonly number[]; readonly orphanedPids: readonly number[] };
  readonly terminations: readonly string[];
}

export interface SqliteCheckpointPort {
  walCheckpoint(mode: WalCheckpointMode): Promise<WalCheckpointResult>;
  readonly modes: readonly WalCheckpointMode[];
}

/** Task 032 event stream resync. */
export type ResyncReason = "reload-ui" | "tray-restore" | "render-process-gone" | "unresponsive";

export interface EventStreamReconnectPort {
  resync(input: { readonly reason: ResyncReason }): Promise<{
    readonly streamEpoch: number;
    readonly lostEvents: 0;
    readonly elapsedMs: number;
  }>;
}

export interface RetryLedgerPort {
  noteSleepCompensated(sleepDurationMs: number): { readonly burnedRetries: 0 };
  burned(): number;
}

export interface PreferenceStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface WindowHost {
  hideMain(): void;
  showMain(): void;
  focusMain(): void;
  destroyRenderers(): void;
  isMainVisible(): boolean;
  isRendererDestroyed(): boolean;
  deliverLaunch(launch: {
    readonly projectPath: string | null;
    readonly deepLink: string | null;
    readonly hiddenTray: boolean;
    readonly workingDirectory: string;
  }): void;
  readonly lastLaunch: {
    readonly projectPath: string | null;
    readonly deepLink: string | null;
    readonly hiddenTray: boolean;
    readonly workingDirectory: string;
  } | null;
}

export interface DaemonPresence {
  alive(): boolean;
  readonly shutdownCalls: number;
}

export function assertDaemonSurvived(presence: DaemonPresence): void {
  if (!presence.alive()) {
    throw new Error("harnessd must stay alive when the renderer closes or crashes");
  }
  if (presence.shutdownCalls !== 0) {
    throw new Error("renderer recovery must not shut harnessd down");
  }
}

export type { BuildActivity };
