import { DIRECTOR_LIMITS } from "./constants.js";
import type { DirectorTelemetry } from "./types.js";

export type OfficeVisibility = "active" | "idle" | "hidden";

export interface FrameTickSample {
  readonly tickMs: number;
  readonly nowMs: number;
}

export class OfficeFrameBudgetMonitor {
  private visibility: OfficeVisibility = "active";
  private reducedMotion = false;
  private tickSamples: number[] = [];
  private lastTickMs = 0;
  private maxVisualLagMs = 0;
  private activeWalkers = 0;
  private continuousMotion = 0;
  private ticksThisSecond = 0;
  private secondWindowStart = 0;
  private currentFps: number = DIRECTOR_LIMITS.activeTargetFps;

  setVisibility(visibility: OfficeVisibility): void {
    this.visibility = visibility;
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  recordLag(maxLagMs: number): void {
    this.maxVisualLagMs = Math.max(this.maxVisualLagMs, maxLagMs);
  }

  resetMaxVisualLag(): void {
    this.maxVisualLagMs = 0;
  }

  recordWalkers(activeWalkers: number, continuousMotion: number): void {
    this.activeWalkers = activeWalkers;
    this.continuousMotion = continuousMotion;
  }

  shouldTick(nowMs: number): boolean {
    if (this.visibility === "hidden" || this.reducedMotion) return false;
    if (this.lastTickMs === 0) {
      this.lastTickMs = nowMs;
      return true;
    }
    const elapsed = nowMs - this.lastTickMs;
    const cadence = this.pickCadence();
    if (elapsed < cadence) return false;
    this.lastTickMs = nowMs;
    return true;
  }

  pickCadence(): number {
    if (this.visibility === "hidden" || this.reducedMotion) return Number.POSITIVE_INFINITY;
    if (this.visibility === "idle" && this.activeWalkers === 0) {
      const fps = (DIRECTOR_LIMITS.idleMinFps + DIRECTOR_LIMITS.idleMaxFps) / 2;
      return 1000 / fps;
    }
    return 1000 / DIRECTOR_LIMITS.activeTargetFps;
  }

  onTick(tickMs: number, nowMs: number): void {
    if (this.visibility === "hidden" || this.reducedMotion) return;
    this.tickSamples.push(tickMs);
    if (this.tickSamples.length > 120) this.tickSamples.shift();
    if (this.secondWindowStart === 0) this.secondWindowStart = nowMs;
    this.ticksThisSecond += 1;
    if (nowMs - this.secondWindowStart >= 1000) {
      this.currentFps = this.ticksThisSecond;
      this.ticksThisSecond = 0;
      this.secondWindowStart = nowMs;
    }
  }

  telemetry(): DirectorTelemetry {
    const avgTickMs =
      this.tickSamples.length === 0
        ? 0
        : this.tickSamples.reduce((sum, value) => sum + value, 0) / this.tickSamples.length;
    const cadence: DirectorTelemetry["tickCadence"] =
      this.visibility === "hidden" || this.reducedMotion
        ? "hidden"
        : this.activeWalkers > 0
          ? "active"
          : "idle";
    return {
      currentFps: cadence === "hidden" ? 0 : this.currentFps,
      avgTickMs,
      maxVisualLagMs: this.maxVisualLagMs,
      activeWalkersCount: this.activeWalkers,
      continuousMotionCount: this.continuousMotion,
      tickCadence: cadence,
    };
  }

  assertActiveBudget(sample: FrameTickSample): void {
    if (this.visibility !== "active" || this.activeWalkers === 0) return;
    if (sample.tickMs > DIRECTOR_LIMITS.activeFrameBudgetMs) {
      throw new Error(`Active tick ${sample.tickMs}ms exceeds ${DIRECTOR_LIMITS.activeFrameBudgetMs}ms budget`);
    }
  }
}