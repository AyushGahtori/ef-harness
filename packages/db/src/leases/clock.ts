export const SLEEP_SKEW_THRESHOLD_MS = 30_000;

export interface DualClock {
  wallMs(): number;
  monotonicMs(): number;
}

export interface SkewObservation {
  readonly skewed: boolean;
  readonly wallPrev: number;
  readonly wallNow: number;
  readonly monoPrev: number;
  readonly monoNow: number;
  readonly signedSkewMs: number;
}

export class SystemDualClock implements DualClock {
  wallMs(): number {
    return Date.now();
  }

  monotonicMs(): number {
    return Number(process.hrtime.bigint() / 1_000_000n);
  }
}

export class ManualDualClock implements DualClock {
  private wall: number;
  private mono: number;

  constructor(wallMs: number, monotonicMs: number) {
    this.wall = wallMs;
    this.mono = monotonicMs;
  }

  wallMs(): number {
    return this.wall;
  }

  monotonicMs(): number {
    return this.mono;
  }

  set(wallMs: number, monotonicMs: number): void {
    this.wall = wallMs;
    this.mono = monotonicMs;
  }
}

/**
 * Suspends lease expiry when wall time and monotonic time disagree by more
 * than 30 seconds, or when the OS reports power resume. The baseline stays
 * frozen until reconciliation finishes so the signed skew can be applied once.
 */
export class SleepSkewGuard {
  private prevWall: number;
  private prevMono: number;
  private suspended = false;
  private powerResumePending = false;
  private frozen: SkewObservation | null = null;

  constructor(
    private readonly clock: DualClock,
    private readonly thresholdMs = SLEEP_SKEW_THRESHOLD_MS,
  ) {
    if (!Number.isSafeInteger(thresholdMs) || thresholdMs < 0) {
      throw new Error("sleep skew threshold must be a non-negative integer");
    }
    this.prevWall = clock.wallMs();
    this.prevMono = clock.monotonicMs();
  }

  onPowerResume(): void {
    this.powerResumePending = true;
    this.suspended = true;
  }

  isSweeperSuspended(): boolean {
    return this.suspended;
  }

  observe(): SkewObservation {
    if (this.suspended && this.frozen) return this.frozen;
    const wallNow = this.clock.wallMs();
    const monoNow = this.clock.monotonicMs();
    const signedSkewMs = wallNow - this.prevWall - (monoNow - this.prevMono);
    const skewed =
      this.powerResumePending || Math.abs(signedSkewMs) > this.thresholdMs;
    const observation: SkewObservation = {
      skewed,
      wallPrev: this.prevWall,
      wallNow,
      monoPrev: this.prevMono,
      monoNow,
      signedSkewMs,
    };
    if (skewed) {
      this.suspended = true;
      this.powerResumePending = false;
      this.frozen = observation;
      return observation;
    }
    this.prevWall = wallNow;
    this.prevMono = monoNow;
    return observation;
  }

  completeReconciliation(): void {
    this.prevWall = this.clock.wallMs();
    this.prevMono = this.clock.monotonicMs();
    this.suspended = false;
    this.powerResumePending = false;
    this.frozen = null;
  }
}
