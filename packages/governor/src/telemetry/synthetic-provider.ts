import { BYTES_PER_GB } from "./types.js";
import type { CollectorCadence, HardwareSnapshot, ProviderKind } from "./types.js";
import {
  defenderSample,
  diskSample,
  gpuFallback,
  gpuSample,
  hardwareSnapshot,
  memorySample,
  neutralUi,
  unavailableDisk,
  unavailableJob,
  unavailableMemory,
  volumeSample,
} from "./snapshot.js";
import type { ResourceTelemetryProvider, TelemetrySampleRequest } from "./provider.js";

export const SYNTHETIC_SCENARIOS = [
  "low-memory",
  "commit-exhaustion",
  "split-drive",
  "defender-contention",
] as const;

export type SyntheticScenarioName = (typeof SYNTHETIC_SCENARIOS)[number];

const GB = BYTES_PER_GB;

export function syntheticScenario(name: SyntheticScenarioName, sampledAtMs = 0): HardwareSnapshot {
  if (name === "low-memory") return lowMemoryFrame(sampledAtMs);
  if (name === "commit-exhaustion") return commitExhaustionFrame(sampledAtMs);
  if (name === "split-drive") return splitDriveFrame(sampledAtMs);
  return defenderFrame(sampledAtMs);
}

export class SyntheticTelemetryProvider implements ResourceTelemetryProvider {
  readonly kind = "synthetic" as const;
  private readonly frames: HardwareSnapshot[];
  private index = 0;

  constructor(frames: readonly HardwareSnapshot[]) {
    if (frames.length === 0) throw new Error("synthetic telemetry needs at least one frame");
    this.frames = [...frames];
  }

  static scenario(name: SyntheticScenarioName): SyntheticTelemetryProvider {
    return new SyntheticTelemetryProvider([syntheticScenario(name)]);
  }

  static playlist(names: readonly SyntheticScenarioName[]): SyntheticTelemetryProvider {
    return new SyntheticTelemetryProvider(names.map((name) => syntheticScenario(name)));
  }

  push(frame: HardwareSnapshot): void {
    this.frames.push(frame);
  }

  async sample(request: TelemetrySampleRequest): Promise<HardwareSnapshot> {
    const frame = this.frames[Math.min(this.index, this.frames.length - 1)];
    if (!frame) throw new Error("synthetic telemetry frame is missing");
    if (this.index < this.frames.length - 1) this.index += 1;
    const jobs =
      request.jobs.length > 0
        ? request.jobs.map((slot) => {
            const existing = frame.jobs.find((job) => job.jobId === slot.id);
            return existing ?? unavailableJob(slot.id, slot.name, slot.role);
          })
        : frame.jobs;
    return hardwareSnapshot({
      sampledAtMs: request.sampledAtMs,
      provider: "synthetic",
      cadence: request.cadence,
      memory: frame.memory,
      jobs,
      gpu: frame.gpu,
      disk: frame.disk,
      defender: frame.defender,
      ui: request.ui,
      unavailableMetrics: frame.unavailableMetrics,
      sampleDurationMs: 0.1,
    });
  }

  async close(): Promise<void> {
    return undefined;
  }

}

function frame(input: {
  readonly sampledAtMs: number;
  readonly provider?: ProviderKind;
  readonly cadence?: CollectorCadence;
  readonly memory: HardwareSnapshot["memory"];
  readonly disk: HardwareSnapshot["disk"];
  readonly defender: HardwareSnapshot["defender"];
  readonly gpu?: HardwareSnapshot["gpu"];
  readonly jobs?: HardwareSnapshot["jobs"];
  readonly unavailableMetrics?: readonly string[];
}): HardwareSnapshot {
  return hardwareSnapshot({
    sampledAtMs: input.sampledAtMs,
    provider: input.provider ?? "synthetic",
    cadence: input.cadence ?? "active",
    memory: input.memory,
    jobs: input.jobs ?? [],
    gpu: input.gpu ?? gpuFallback(2 * GB, false),
    disk: input.disk,
    defender: input.defender,
    ui: neutralUi(),
    unavailableMetrics: input.unavailableMetrics ?? [],
    sampleDurationMs: 0.1,
  });
}

function lowMemoryFrame(sampledAtMs: number): HardwareSnapshot {
  const total = 16 * GB;
  return frame({
    sampledAtMs,
    memory: memorySample({
      totalPhysicalBytes: total,
      availablePhysicalBytes: Math.round(total * 0.03),
      totalPageFileBytes: 20 * GB,
      availablePageFileBytes: 8 * GB,
      memoryLoadPercent: 97,
      lowMemoryNotification: true,
      lowMemoryNotificationUnavailable: false,
      commitMetricUnavailable: false,
      metricUnavailable: false,
    }),
    disk: healthyDisk(),
    defender: defenderSample(2, false),
    unavailableMetrics: [],
  });
}

function commitExhaustionFrame(sampledAtMs: number): HardwareSnapshot {
  const total = 16 * GB;
  return frame({
    sampledAtMs,
    memory: memorySample({
      totalPhysicalBytes: total,
      availablePhysicalBytes: Math.round(total * 0.3),
      totalPageFileBytes: 20 * GB,
      availablePageFileBytes: Math.round(0.5 * GB),
      memoryLoadPercent: 70,
      lowMemoryNotification: false,
      lowMemoryNotificationUnavailable: false,
      commitMetricUnavailable: false,
      metricUnavailable: false,
    }),
    disk: healthyDisk(),
    defender: defenderSample(4, false),
  });
}

function splitDriveFrame(sampledAtMs: number): HardwareSnapshot {
  return frame({
    sampledAtMs,
    memory: memorySample({
      totalPhysicalBytes: 16 * GB,
      availablePhysicalBytes: 8 * GB,
      totalPageFileBytes: 20 * GB,
      availablePageFileBytes: 10 * GB,
      memoryLoadPercent: 50,
      lowMemoryNotification: false,
      lowMemoryNotificationUnavailable: false,
      commitMetricUnavailable: false,
      metricUnavailable: false,
    }),
    disk: diskSample(
      volumeSample({
        role: "workspace",
        path: "D:\\work\\repo",
        freeBytes: 500 * GB,
        totalBytes: 1000 * GB,
        metricUnavailable: false,
      }),
      volumeSample({
        role: "appdata",
        path: "C:\\Users\\dev\\AppData\\Local",
        freeBytes: Math.round(3.2 * GB),
        totalBytes: 200 * GB,
        metricUnavailable: false,
      }),
      { queueLength: 1.5, ioBusyPercent: 40, queueMetricUnavailable: false },
    ),
    defender: defenderSample(3, false),
  });
}

function defenderFrame(sampledAtMs: number): HardwareSnapshot {
  return frame({
    sampledAtMs,
    memory: memorySample({
      totalPhysicalBytes: 16 * GB,
      availablePhysicalBytes: 8 * GB,
      totalPageFileBytes: 20 * GB,
      availablePageFileBytes: 10 * GB,
      memoryLoadPercent: 50,
      lowMemoryNotification: false,
      lowMemoryNotificationUnavailable: false,
      commitMetricUnavailable: false,
      metricUnavailable: false,
    }),
    disk: healthyDisk(),
    defender: defenderSample(45, false),
    gpu: gpuSample({
      gpuAvailable: false,
      adapterName: null,
      budgetBytes: null,
      currentUsageBytes: null,
      availableForReservationBytes: null,
      sharedVramBudgetBytes: 2 * GB,
      metricUnavailable: false,
    }),
  });
}

function healthyDisk(): HardwareSnapshot["disk"] {
  return diskSample(
    volumeSample({
      role: "workspace",
      path: "D:\\work\\repo",
      freeBytes: 200 * GB,
      totalBytes: 1000 * GB,
      metricUnavailable: false,
    }),
    volumeSample({
      role: "appdata",
      path: "C:\\Users\\dev\\AppData\\Local",
      freeBytes: 80 * GB,
      totalBytes: 200 * GB,
      metricUnavailable: false,
    }),
    { queueLength: 0.2, ioBusyPercent: 5, queueMetricUnavailable: false },
  );
}

export function unavailableProviderSnapshot(
  request: TelemetrySampleRequest,
  provider: ProviderKind,
  unavailableMetrics: readonly string[],
): HardwareSnapshot {
  return hardwareSnapshot({
    sampledAtMs: request.sampledAtMs,
    provider,
    cadence: request.cadence,
    memory: unavailableMemory(),
    jobs: [],
    gpu: gpuFallback(null, true),
    disk: unavailableDisk(request.workspacePath, request.appDataPath),
    defender: defenderSample(0, true),
    ui: request.ui,
    unavailableMetrics,
    sampleDurationMs: 0,
  });
}
