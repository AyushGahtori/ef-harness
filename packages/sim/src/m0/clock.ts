/**
 * Dual clock for the simulator. Monotonic time never jumps backward.
 * Wall time jumps only through sleepJump, which models a laptop sleep.
 * Callers must not read Date.now.
 */
export class FakeDualClock {
  private wall: number;
  private mono: number;

  constructor(startWall = 1_700_000_000_000) {
    if (!Number.isFinite(startWall)) {
      throw new Error("FakeDualClock start must be finite");
    }
    this.wall = startWall;
    this.mono = 0;
  }

  wallMs(): number {
    return this.wall;
  }

  monoMs(): number {
    return this.mono;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("advance requires a non-negative finite duration");
    }
    this.mono += ms;
    this.wall += ms;
  }

  /** Wall clock leaps forward. Monotonic time stays put (the process was suspended). */
  sleepJump(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("sleepJump requires a non-negative finite duration");
    }
    this.wall += ms;
  }
}
