import { AUTO_RESUME_JITTER_MS, DISK_HEADROOM_MIN_BYTES } from "./constants.js";
import type { AutoResumeDecision, AutoResumeSnapshot, DiskHeadroomCard } from "./types.js";

export interface ResumePreflightPort {
  connectionHealthy(connectionId: string): boolean;
  pendingConflicts(connectionId: string): number;
  pendingHolds(connectionId: string): number;
  diskFreeBytes(): number;
}

/**
 * Auto-resume is off unless the developer checks it. Wake is reset_at + 15s.
 * A failed disk, health, or hold check leaves the build parked.
 */
export class AutoResumeScheduler {
  private optIn: boolean;
  private resetAtMs: number | null;
  private wakeAtMs: number | null;

  constructor(snapshot?: AutoResumeSnapshot) {
    this.optIn = snapshot?.optIn ?? false;
    this.resetAtMs = snapshot?.resetAtMs ?? null;
    this.wakeAtMs = snapshot?.wakeAtMs ?? null;
  }

  static restore(snapshot: AutoResumeSnapshot): AutoResumeScheduler {
    return new AutoResumeScheduler(snapshot);
  }

  snapshot(): AutoResumeSnapshot {
    return {
      optIn: this.optIn,
      resetAtMs: this.resetAtMs,
      wakeAtMs: this.wakeAtMs,
    };
  }

  get optedIn(): boolean {
    return this.optIn;
  }

  setOptIn(enabled: boolean): void {
    this.optIn = enabled;
    if (!enabled) {
      this.resetAtMs = null;
      this.wakeAtMs = null;
    }
  }

  /** Arms only when opted in. Returns the wake timestamp, or null when the default-off path applies. */
  arm(resetAtMs: number): number | null {
    if (!this.optIn) {
      this.resetAtMs = null;
      this.wakeAtMs = null;
      return null;
    }
    this.resetAtMs = resetAtMs;
    this.wakeAtMs = resetAtMs + AUTO_RESUME_JITTER_MS;
    return this.wakeAtMs;
  }

  evaluate(nowMs: number, preflight: ResumePreflightPort, connectionId: string): AutoResumeDecision {
    if (!this.optIn) {
      return { action: "idle", reason: "opt_in_off", wakeAtMs: null, cwnd: null, diskCard: null };
    }
    if (this.wakeAtMs === null || this.resetAtMs === null) {
      return { action: "idle", reason: "not_armed", wakeAtMs: null, cwnd: null, diskCard: null };
    }
    if (nowMs < this.wakeAtMs) {
      return {
        action: "waiting",
        reason: "before_wake",
        wakeAtMs: this.wakeAtMs,
        cwnd: null,
        diskCard: null,
      };
    }
    const freeBytes = preflight.diskFreeBytes();
    if (freeBytes < DISK_HEADROOM_MIN_BYTES) {
      const diskCard: DiskHeadroomCard = {
        kind: "disk_headroom",
        freeBytes,
        requiredBytes: DISK_HEADROOM_MIN_BYTES,
        message: "Disk headroom is below 5 GB. The build stays parked.",
      };
      return { action: "stay_parked", reason: "disk_headroom", wakeAtMs: this.wakeAtMs, cwnd: null, diskCard };
    }
    if (!preflight.connectionHealthy(connectionId)) {
      return {
        action: "stay_parked",
        reason: "connection_unhealthy",
        wakeAtMs: this.wakeAtMs,
        cwnd: null,
        diskCard: null,
      };
    }
    if (preflight.pendingConflicts(connectionId) > 0 || preflight.pendingHolds(connectionId) > 0) {
      return {
        action: "stay_parked",
        reason: "pending_conflict_or_hold",
        wakeAtMs: this.wakeAtMs,
        cwnd: null,
        diskCard: null,
      };
    }
    this.wakeAtMs = null;
    this.resetAtMs = null;
    return { action: "resume", reason: "preflight_clear", wakeAtMs: null, cwnd: 2, diskCard: null };
  }
}
