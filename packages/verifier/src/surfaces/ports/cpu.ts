import os from "node:os";

export interface CpuSample {
  readonly idleMs: number;
  readonly totalMs: number;
}

export interface HostCpuSampler {
  sample(): CpuSample;
}

export function createOsCpuSampler(): HostCpuSampler {
  return {
    sample() {
      let idleMs = 0;
      let totalMs = 0;
      for (const cpu of os.cpus()) {
        const times = cpu.times;
        idleMs += times.idle;
        totalMs += times.user + times.nice + times.sys + times.idle + times.irq;
      }
      return { idleMs, totalMs };
    },
  };
}

export function hostCpuPercent(before: CpuSample, after: CpuSample): number {
  const idle = after.idleMs - before.idleMs;
  const total = after.totalMs - before.totalMs;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - idle / total) * 100));
}

export function percentileNearestRank(samples: readonly number[], percentile: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil((percentile / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}
