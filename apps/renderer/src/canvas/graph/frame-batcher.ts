export class CanvasFrameBatcher<T> {
  private pending: T[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly frameMs: number;

  constructor(frameMs = 16) {
    this.frameMs = frameMs;
  }

  push(value: T, onFlush: (batch: readonly T[]) => void): void {
    this.pending.push(value);
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      const batch = this.pending;
      this.pending = [];
      this.timer = null;
      onFlush(batch);
    }, this.frameMs);
  }

  flushNow(onFlush: (batch: readonly T[]) => void): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.pending;
    this.pending = [];
    if (batch.length > 0) onFlush(batch);
  }
}