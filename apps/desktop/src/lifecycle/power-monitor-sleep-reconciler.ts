import type { reentry } from "@ef-harness/steering";
import type {
  CheckpointFlushPort,
  ClaimGatePort,
  ColdOpenReconcilerPort,
  DaemonLifecycleClient,
  EnvironmentProbe,
  HardwareGovernorPort,
  RetryLedgerPort,
  SleepSkewGuardPort,
  SqliteCheckpointPort,
  StuckClockPort,
  WakeHealth,
  WindowsJobObjectPort,
} from "./ports.js";
import {
  WELCOME_BACK_SLEEP_MS,
  wakeBand,
  welcomeBackMessage,
  type WakeBand,
  type WalCheckpointResult,
} from "./types.js";

export interface ResumeOutcome {
  readonly sleepDurationMs: number;
  readonly band: WakeBand;
  readonly holdWelcomeBack: boolean;
  readonly message: string;
  readonly falseStuckAlarms: 0;
  readonly burnedRetries: 0;
  readonly spuriousLeaseExpiries: 0;
  readonly addedStuckMs: 0;
  readonly reconcileCalled: true;
}

export interface ShutdownFlushResult {
  readonly walModes: readonly ["PASSIVE", "TRUNCATE"];
  readonly passive: WalCheckpointResult;
  readonly truncate: WalCheckpointResult;
  readonly orphanedProcesses: 0;
  readonly stateDbIntact: true;
  readonly checkpointsFlushed: true;
}

export interface PowerReconcilerDependencies {
  readonly now: () => number;
  readonly daemon: DaemonLifecycleClient;
  readonly clocks: StuckClockPort;
  readonly leases: SleepSkewGuardPort;
  readonly reconciler: ColdOpenReconcilerPort;
  readonly governor: HardwareGovernorPort;
  readonly probe: EnvironmentProbe;
  readonly claims: ClaimGatePort;
  readonly checkpoints: CheckpointFlushPort;
  readonly jobs: WindowsJobObjectPort;
  readonly sqlite: SqliteCheckpointPort;
  readonly retries: RetryLedgerPort;
  readonly projectRoot?: string;
  ecoOnBattery: boolean;
}

export class PowerMonitorSleepReconciler {
  private suspendedAt: number | null = null;
  private locked = false;
  private lastResume: ResumeOutcome | null = null;

  constructor(private readonly deps: PowerReconcilerDependencies) {}

  get lastSuspendedAt(): number | null {
    return this.suspendedAt;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  get resumeOutcome(): ResumeOutcome | null {
    return this.lastResume;
  }

  setEcoOnBattery(enabled: boolean): void {
    this.deps.ecoOnBattery = enabled;
  }

  async onSuspend(): Promise<{ readonly suspendedAt: number }> {
    const at = this.deps.now();
    this.suspendedAt = at;
    this.deps.claims.pause("suspend");
    await this.deps.checkpoints.flushActiveTurns("suspend");
    this.deps.clocks.pauseForSleep(at);
    await this.deps.daemon.notifyPower({ type: "suspend", at });
    return { suspendedAt: at };
  }

  async onResume(): Promise<ResumeOutcome> {
    const resumedAt = this.deps.now();
    const suspendedAt = this.suspendedAt ?? resumedAt;
    const sleepDurationMs = Math.max(0, resumedAt - suspendedAt);
    const band = wakeBand(sleepDurationMs);
    const clocks = this.deps.clocks.compensateOnResume(sleepDurationMs, suspendedAt);
    const leases = this.deps.leases.onResume({ suspendedAt, resumedAt, sleepDurationMs });
    const retries = this.deps.retries.noteSleepCompensated(sleepDurationMs);
    if (clocks.addedStuckMs !== 0 || clocks.falseAlarms !== 0) {
      throw new Error("Sleep duration counted against worker stuck clocks");
    }
    if (leases.spuriousLeaseExpiries !== 0) {
      throw new Error("Sleep duration counted against task leases");
    }
    if (retries.burnedRetries !== 0 || this.deps.retries.burned() !== 0) {
      throw new Error("Sleep burned retries");
    }
    const health = await this.deps.probe.probe();
    const wake = this.deps.reconciler.reconcile(
      wakeColdOpenInput({
        sleepDurationMs,
        resumedAt,
        health,
        projectRoot: this.deps.projectRoot ?? ".",
      }),
    );
    if (wake.tokensSpent !== 0) {
      throw new Error("ColdOpenReconciler.reconcile burned retries");
    }
    const hold = this.shouldHold(sleepDurationMs, health, wake.showWelcome);
    if (hold) {
      this.deps.claims.pause("welcome-back");
    } else if (this.deps.claims.paused) {
      this.deps.claims.resume("resume");
    }
    await this.deps.daemon.notifyPower({
      type: "resume",
      at: resumedAt,
      sleepDurationMs,
      resumeClaiming: !hold,
    });
    const message = hold ? welcomeBackMessage(sleepDurationMs, health) : (wake.wakeNote ?? "");
    const outcome: ResumeOutcome = {
      sleepDurationMs,
      band,
      holdWelcomeBack: hold,
      message,
      falseStuckAlarms: 0,
      burnedRetries: 0,
      spuriousLeaseExpiries: 0,
      addedStuckMs: 0,
      reconcileCalled: true,
    };
    this.lastResume = outcome;
    this.suspendedAt = null;
    return outcome;
  }

  async onBattery(batteryPercent: number | null): Promise<void> {
    this.deps.governor.reportPowerSource(this.telemetry("battery", batteryPercent));
    await this.deps.daemon.notifyPower({
      type: "on-battery",
      batteryPercent,
      ecoOnBattery: this.deps.ecoOnBattery,
    });
  }

  async onAc(): Promise<void> {
    this.deps.governor.reportPowerSource(this.telemetry("ac", null));
    await this.deps.daemon.notifyPower({ type: "on-ac", ecoOnBattery: this.deps.ecoOnBattery });
  }

  async onLock(): Promise<void> {
    this.locked = true;
    await this.deps.daemon.notifyPower({ type: "lock-screen", at: this.deps.now() });
  }

  async onUnlock(): Promise<void> {
    this.locked = false;
    await this.deps.daemon.notifyPower({ type: "unlock-screen", at: this.deps.now() });
  }

  async onShutdown(): Promise<ShutdownFlushResult> {
    const flushed = await this.deps.checkpoints.flushActiveTurns("os-shutdown");
    const passive = await this.deps.sqlite.walCheckpoint("PASSIVE");
    const truncate = await this.deps.sqlite.walCheckpoint("TRUNCATE");
    if (truncate.busy !== 0) {
      throw new Error("state.db WAL checkpoint did not complete");
    }
    const jobs = this.deps.jobs.terminateJobObject("os-shutdown");
    if (jobs.orphanedPids.length !== 0) {
      throw new Error("shutdown left orphaned processes");
    }
    await this.deps.daemon.notifyPower({ type: "shutdown", at: this.deps.now() });
    if (!flushed.wipPreserved) {
      throw new Error("shutdown failed to preserve WIP checkpoints");
    }
    return {
      walModes: ["PASSIVE", "TRUNCATE"],
      passive,
      truncate,
      orphanedProcesses: 0,
      stateDbIntact: true,
      checkpointsFlushed: true,
    };
  }

  private shouldHold(sleepDurationMs: number, health: WakeHealth, portRequested: boolean): boolean {
    if (sleepDurationMs > WELCOME_BACK_SLEEP_MS) return true;
    if (!health.networkOnline || health.repoChanged) return true;
    if (!health.providerReachable || !health.localDbHealthy || !health.testEnvHealthy) return true;
    return portRequested;
  }

  private telemetry(source: "battery" | "ac", batteryPercent: number | null) {
    const eco = source === "battery" && this.deps.ecoOnBattery;
    if (eco) {
      return {
        source,
        batteryPercent,
        ecoOnBattery: true,
        ecoCap: "eco" as const,
      };
    }
    return { source, batteryPercent, ecoOnBattery: false };
  }
}

function wakeColdOpenInput(input: {
  readonly sleepDurationMs: number;
  readonly resumedAt: number;
  readonly health: WakeHealth;
  readonly projectRoot: string;
}): reentry.ColdOpenInput {
  const snapshot: reentry.StateDbSnapshot = {
    projectId: "m1",
    snapshotId: "wake",
    projectName: "ef-harness",
    projectRoot: input.projectRoot,
    lastActiveAt: new Date(input.resumedAt).toISOString(),
    phaseLabel: "wake",
    whyStopped: "sleep",
    expectedIntegrationHead: "unknown",
    recordedBranch: "harness/integration",
    recordedHead: "unknown",
    recordedOriginMain: null,
    walOk: input.health.localDbHealthy,
    walDetail: input.health.localDbHealthy ? "ok" : "unhealthy",
    attempts: [],
    remainingTasks: [],
    parkedTasks: [],
    finishedFeatures: [],
    costEstimate: "$0.00",
    windowLabel: "wake",
    lockHashes: { packageJson: null, pnpmLock: null },
    viewHashes: [],
    worktrees: [],
    connections: [],
    cliVersions: [],
    humanSteps: [],
    questions: [],
    failedTasks: [],
  };
  return {
    snapshot,
    nowIso: new Date(input.resumedAt).toISOString(),
    reopen: "wake",
    buildWasInProgress: false,
    sleepMinutes: Math.round(input.sleepDurationMs / 60_000),
    offline: !input.health.networkOnline,
    repoChanged: input.health.repoChanged,
    networkChanged: !input.health.networkOnline,
    forceHold: false,
    lastActiveLabel: null,
    ledger: { tokens: 0, cents: 0, calls: [] },
    gate: null,
  };
}
