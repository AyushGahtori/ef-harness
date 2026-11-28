import type { HardwareGovernorLatencySink, UiLatencySample } from "./ports.js";
import { HEARTBEAT_INTERVAL_MS } from "./types.js";

export function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export class UiLatencyHeartbeatMonitor {
  private samples: number[] = [];
  private windowStart: number | null = null;
  emissions = 0;

  constructor(private readonly sink: HardwareGovernorLatencySink) {}

  noteSample(latencyMs: number, atMs: number, hidden: boolean): void {
    if (hidden || !Number.isFinite(latencyMs) || latencyMs < 0) return;
    if (this.windowStart === null) this.windowStart = atMs;
    this.samples.push(latencyMs);
    if (atMs - this.windowStart >= HEARTBEAT_INTERVAL_MS) this.emit(atMs);
  }

  private emit(atMs: number): void {
    if (this.samples.length === 0) return;
    const sample: UiLatencySample = {
      p95Ms: percentile95(this.samples),
      sampleCount: this.samples.length,
      atMs,
    };
    this.sink.ingestUiLatency(sample);
    this.samples = [];
    this.windowStart = atMs;
    this.emissions += 1;
  }
}
