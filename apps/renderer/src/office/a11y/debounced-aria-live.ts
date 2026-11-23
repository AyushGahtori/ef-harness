import { ARIA_LIVE_DEBOUNCE_MS } from "./types.js";

export class DebouncedAriaLive {
  private pending: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastAnnounced = "";

  constructor(private readonly debounceMs = ARIA_LIVE_DEBOUNCE_MS) {}

  queue(message: string): void {
    if (!message.trim()) return;
    this.pending.push(message.trim());
    this.schedule();
  }

  flush(): string | null {
    if (this.pending.length === 0) return null;
    const unique = [...new Set(this.pending)];
    this.pending = [];
    const combined = unique.join(". ");
    if (combined === this.lastAnnounced) return null;
    this.lastAnnounced = combined;
    return combined;
  }

  peekRendered(): string {
    return this.lastAnnounced;
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }
}