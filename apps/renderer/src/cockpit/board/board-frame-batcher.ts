import { FRAME_BATCH_WINDOW_MS } from "./types.js";

export class BoardFrameBatcher<T> {
  private readonly pending = new Map<string, T>();
  private frameStartMs: number | null = null;

  constructor(private readonly windowMs = FRAME_BATCH_WINDOW_MS) {}

  get open(): boolean {
    return this.frameStartMs !== null;
  }

  get frameStart(): number | null {
    return this.frameStartMs;
  }

  push(id: string, value: T, atMs: number): "queued" | "rotate" {
    if (this.frameStartMs !== null && atMs - this.frameStartMs > this.windowMs) {
      return "rotate";
    }
    if (this.frameStartMs === null) this.frameStartMs = atMs;
    this.pending.set(id, value);
    return "queued";
  }

  drain(): Map<string, T> {
    const flushed = new Map(this.pending);
    this.pending.clear();
    this.frameStartMs = null;
    return flushed;
  }
}
