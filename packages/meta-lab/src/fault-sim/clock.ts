/** Virtual monotonic clock — no real sleeps; time jumps only via advance(). */
export class FakeDualClock {
  private monoMs = 0;
  private wallMs = 0;

  constructor(startMonoMs = 0, startWallMs = 0) {
    this.monoMs = startMonoMs;
    this.wallMs = startWallMs;
  }

  nowMono(): number {
    return this.monoMs;
  }

  nowWall(): number {
    return this.wallMs;
  }

  advance(monoDeltaMs: number, wallDeltaMs = monoDeltaMs): void {
    if (monoDeltaMs < 0 || wallDeltaMs < 0) {
      throw new Error("clock cannot move backwards");
    }
    this.monoMs += monoDeltaMs;
    this.wallMs += wallDeltaMs;
  }

  jumpTo(monoMs: number, wallMs?: number): void {
    if (monoMs < this.monoMs) {
      throw new Error("clock cannot move backwards");
    }
    this.monoMs = monoMs;
    this.wallMs = wallMs ?? monoMs;
  }

  snapshot(): { monoMs: number; wallMs: number } {
    return { monoMs: this.monoMs, wallMs: this.wallMs };
  }
}