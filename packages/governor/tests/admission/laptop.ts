import type { HardwareSnapshot } from "../../src/admission/ports/hardware-snapshot.js";
import { GiB } from "../../src/admission/thresholds.js";

export function laptopSnapshot(overrides: Partial<HardwareSnapshot> = {}): HardwareSnapshot {
  const base: HardwareSnapshot = {
    sampledAtMs: 0,
    totalPhysMb: 16 * 1024,
    availPhysMb: 10 * 1024,
    totalCommitMb: 32 * 1024,
    availCommitMb: 20 * 1024,
    lowMemoryNotification: false,
    cpuCoreCount: 8,
    cpuLoadRatio: 0.2,
    defenderCpuRatio: 0.02,
    avContentionActive: false,
    uiLatencyMs: 8,
    uiSampleValid: true,
    gpuAvailable: true,
    gpuClass: "discrete",
    vramBudgetMb: 8_192,
    vramUsedMb: 1_024,
    projectDisk: { letter: "D:", freeBytes: 200 * GiB, totalBytes: 512 * GiB },
    appDataDisk: { letter: "C:", freeBytes: 80 * GiB, totalBytes: 256 * GiB },
    diskQueueDepth: 0.1,
    ioLatencyMs: 0.4,
    storageClass: "ssd",
    devDrive: false,
  };
  return { ...base, ...overrides };
}

export function volume(letter: string, freeBytes: number, totalBytes = freeBytes + 100 * GiB) {
  return { letter, freeBytes, totalBytes };
}
