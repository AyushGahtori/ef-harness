import { DIRECTOR_LIMITS } from "./constants.js";
import type { OfficeRoomId } from "./constants.js";
import type { MotionEnqueue } from "./types.js";

export interface BurstCollapseResult {
  readonly collapsed: boolean;
  readonly kept: MotionEnqueue | null;
  readonly discardedCount: number;
}

/**
 * Collapses rapid room-target bursts inside `burstWindowMs`, keeping only the latest
 * authoritative destination per character.
 */
export class BurstCollapseEventQueue {
  private readonly pending: MotionEnqueue[] = [];

  constructor(
    private readonly agentId: string,
    private readonly maxLen = DIRECTOR_LIMITS.maxQueueLen,
    private readonly burstWindowMs = DIRECTOR_LIMITS.burstWindowMs,
  ) {}

  enqueue(targetRoomId: OfficeRoomId, enqueuedAtMs: number, authoritativeStateMs: number): BurstCollapseResult {
    const next: MotionEnqueue = {
      agentId: this.agentId,
      targetRoomId,
      enqueuedAtMs,
      authoritativeStateMs,
    };
    let collapsed = false;
    let discarded = 0;
    const recent = this.pending.filter((item) => enqueuedAtMs - item.enqueuedAtMs <= this.burstWindowMs);
    if (recent.length > 0) {
      collapsed = true;
      discarded = recent.length;
      for (const stale of recent) {
        const idx = this.pending.indexOf(stale);
        if (idx >= 0) this.pending.splice(idx, 1);
      }
    }
    this.pending.push(next);
    while (this.pending.length > this.maxLen) {
      this.pending.shift();
      discarded += 1;
    }
    return { collapsed, kept: next, discardedCount: discarded };
  }

  peek(): MotionEnqueue | null {
    return this.pending[0] ?? null;
  }

  shift(): MotionEnqueue | null {
    return this.pending.shift() ?? null;
  }

  clear(): void {
    this.pending.length = 0;
  }

  depth(): number {
    return this.pending.length;
  }

  collapseAllToLatest(nowMs: number): BurstCollapseResult {
    if (this.pending.length <= 1) {
      return { collapsed: false, kept: this.pending[0] ?? null, discardedCount: 0 };
    }
    const latest = this.pending[this.pending.length - 1]!;
    const discarded = this.pending.length - 1;
    this.pending.length = 0;
    this.pending.push({ ...latest, enqueuedAtMs: nowMs });
    return { collapsed: true, kept: latest, discardedCount: discarded };
  }
}