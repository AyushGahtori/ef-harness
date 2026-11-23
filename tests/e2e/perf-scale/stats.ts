import os from "node:os";

export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? Number.POSITIVE_INFINITY;
}

export function median(samples: readonly number[]): number {
  return percentile(samples, 50);
}

export interface SampleSummary {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly count: number;
  readonly max: number;
}

export function summarize(samples: readonly number[]): SampleSummary {
  return {
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    count: samples.length,
    max: samples.length === 0 ? Number.POSITIVE_INFINITY : Math.max(...samples),
  };
}

export function hardwareMetadata(): Record<string, string | number> {
  const cpus = os.cpus();
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cpuModel: cpus[0]?.model ?? "unknown",
    logicalCpus: cpus.length,
    totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
  };
}

export function peakRssMb(): number {
  return Math.round(process.memoryUsage().rss / (1024 * 1024));
}