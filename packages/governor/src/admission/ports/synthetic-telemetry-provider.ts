import type { HardwareSnapshot, ResourceTelemetryProvider } from "./hardware-snapshot.js";

interface Segment {
  readonly fromMs: number;
  readonly snapshot: HardwareSnapshot;
}

/**
 * Local port of Task 117 `SyntheticTelemetryProvider`.
 * Samples are chosen by virtual time so hysteresis tests stay deterministic.
 */
export class SyntheticTelemetryProvider implements ResourceTelemetryProvider {
  private segments: Segment[] = [];

  setFrom(fromMs: number, snapshot: HardwareSnapshot): void {
    this.segments = this.segments.filter((segment) => segment.fromMs !== fromMs);
    this.segments.push({ fromMs, snapshot });
    this.segments.sort((left, right) => left.fromMs - right.fromMs);
  }

  current(nowMs: number = Date.now()): HardwareSnapshot {
    let chosen: Segment | undefined;
    for (const segment of this.segments) {
      if (segment.fromMs <= nowMs) chosen = segment;
      else break;
    }
    if (!chosen) {
      throw new Error("SyntheticTelemetryProvider has no sample at or before the requested time");
    }
    return chosen.snapshot;
  }
}
