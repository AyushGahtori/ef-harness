import { percentile } from "./stats.mjs";

export const COLLECTOR_NAMES = [
  "committedMemoryAndWorkingSet",
  "cpuUtilization",
  "diskActiveTimeAndQueue",
  "sandboxLaunchLatency",
  "slotResetTime",
  "defenderCpu",
  "uiInputLatency",
];

/**
 * @param {Record<string, unknown>} sample
 * @param {{ launchMs: number[], slot: { coldCreateMs: number, reuseResetMs: number } | null, uiP95Ms: number | null }} extras
 */
export function buildCollectors(sample, extras) {
  return {
    committedMemoryAndWorkingSet: {
      committedBytes: Number(sample.commitCharge ?? 0),
      workingSetBytes: Number(sample.workingSetBytes ?? 0),
      commitChargeRatio: Number(sample.commitRatio ?? 0),
    },
    cpuUtilization: { percent: Number(sample.cpuPercent ?? 0) },
    diskActiveTimeAndQueue: {
      activePercent: Number(sample.diskActivePercent ?? 0),
      queueLength: Number(sample.diskQueueLength ?? 0),
    },
    sandboxLaunchLatency: {
      p50Ms: extras.launchMs.length ? percentile(extras.launchMs, 50) : null,
      p95Ms: extras.launchMs.length ? percentile(extras.launchMs, 95) : null,
    },
    slotResetTime: extras.slot,
    defenderCpu: {
      percent: Number(sample.defenderCpuPercent ?? 0),
      found: Boolean(sample.defenderFound),
      workingSetBytes: Number(sample.defenderWorkingSetBytes ?? 0),
      api: "Get-Process MsMpEng TotalProcessorTime delta / (elapsed * cores)",
    },
    uiInputLatency: { p95Ms: extras.uiP95Ms },
  };
}
