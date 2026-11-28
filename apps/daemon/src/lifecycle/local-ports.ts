import type {
  CheckpointFlushPort,
  ClaimGatePort,
  Clock,
  HardwareGovernorPort,
  PowerTelemetry,
  RetryLedgerPort,
  SleepSkewGuardPort,
  StuckClockPort,
  WindowsJobObjectPort,
} from "./ports.js";

export class LocalClaimGate implements ClaimGatePort {
  paused = false;
  reason = "";

  pause(reason: string): void {
    this.paused = true;
    this.reason = reason;
  }

  resume(reason: string): void {
    this.paused = false;
    this.reason = reason;
  }
}

export class RecordingCheckpoints implements CheckpointFlushPort {
  readonly reasons: string[] = [];

  async flushActiveTurns(reason: string): Promise<{ readonly flushed: number; readonly wipPreserved: true }> {
    this.reasons.push(reason);
    return { flushed: 1, wipPreserved: true };
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
    if (this.compensatedFor === suspendedAt) return { addedStuckMs: 0, falseAlarms: 0 };
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

export class LocalSleepSkewGuard implements SleepSkewGuardPort {
  spuriousLeaseExpiries = 0;

  lastSleepMs = 0;
  lastSuspendedAt = 0;
  lastResumedAt = 0;

  onResume(input: {
    readonly suspendedAt: number;
    readonly resumedAt: number;
    readonly sleepDurationMs: number;
  }): { readonly expirySweeperSuspended: true; readonly spuriousLeaseExpiries: 0 } {
    this.lastSuspendedAt = input.suspendedAt;
    this.lastResumedAt = input.resumedAt;
    this.lastSleepMs = input.sleepDurationMs;
    this.spuriousLeaseExpiries = 0;
    return { expirySweeperSuspended: true, spuriousLeaseExpiries: 0 };
  }
}

export class LocalRetryLedger implements RetryLedgerPort {
  private burnedCount = 0;

  notedSleepMs = 0;

  noteSleepCompensated(sleepDurationMs: number): { readonly burnedRetries: 0 } {
    this.notedSleepMs = sleepDurationMs;
    return { burnedRetries: 0 };
  }

  burned(): number {
    return this.burnedCount;
  }
}

export class LocalHardwareGovernor implements HardwareGovernorPort {
  readonly events: PowerTelemetry[] = [];

  reportPowerSource(input: PowerTelemetry): void {
    this.events.push(input);
  }
}

export class ManualClock implements Clock {
  private current: number;

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  async sleep(ms: number): Promise<void> {
    this.current += ms;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

export function wallClock(): Clock {
  return {
    now: () => Date.now(),
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
}
