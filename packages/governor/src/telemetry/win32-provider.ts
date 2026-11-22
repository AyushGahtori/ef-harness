import { Win32HelperClient, type HelperJob, type HelperSample } from "./win32-helper-client.js";
import type { ResourceTelemetryProvider, TelemetrySampleRequest } from "./provider.js";
import {
  defenderSample,
  diskSample,
  gpuFallback,
  gpuSample,
  hardwareSnapshot,
  memorySample,
  unavailableDisk,
  unavailableJob,
  unavailableMemory,
  volumeSample,
} from "./snapshot.js";
import { TelemetryError, type HardwareSnapshot, type JobRole } from "./types.js";
import { JOB_ROLES } from "./types.js";

export interface Win32SampleSource {
  sample(input: {
    readonly workspace: string;
    readonly appData: string;
    readonly jobs: TelemetrySampleRequest["jobs"];
  }): Promise<HelperSample>;
  close(): Promise<void>;
}

export class Win32NativeTelemetryProvider implements ResourceTelemetryProvider {
  readonly kind = "win32" as const;

  constructor(private readonly source: Win32SampleSource) {}

  static async connect(client?: Win32HelperClient): Promise<Win32NativeTelemetryProvider> {
    const connected = client ?? (await Win32HelperClient.connect());
    return new Win32NativeTelemetryProvider(connected);
  }

  async sample(request: TelemetrySampleRequest): Promise<HardwareSnapshot> {
    const started = performance.now();
    let raw: HelperSample;
    try {
      raw = await this.source.sample({
        workspace: request.workspacePath,
        appData: request.appDataPath,
        jobs: request.jobs,
      });
    } catch {
      const failed = ["memory", "disk", "gpu", "defender", "jobs", "lowMemoryNotification"];
      return hardwareSnapshot({
        sampledAtMs: request.sampledAtMs,
        provider: "win32",
        cadence: request.cadence,
        memory: unavailableMemory(),
        jobs: request.jobs.map((job) => unavailableJob(job.id, job.name, job.role)),
        gpu: gpuFallback(null, true),
        disk: unavailableDisk(request.workspacePath, request.appDataPath),
        defender: defenderSample(0, true),
        ui: request.ui,
        unavailableMetrics: failed,
        sampleDurationMs: performance.now() - started,
      });
    }
    const unavailable: string[] = [];
    const memory = isolate("memory", unavailable, () => mapMemory(raw), unavailableMemory);
    const disk = isolate("disk", unavailable, () => mapDisk(raw, request), () =>
      unavailableDisk(request.workspacePath, request.appDataPath),
    );
    const gpu = isolate("gpu", unavailable, () => mapGpu(raw), () => gpuFallback(null, true));
    const defender = isolate("defender", unavailable, () => mapDefender(raw), () => defenderSample(0, true));
    const jobs = isolate("jobs", unavailable, () => mapJobs(raw), () =>
      request.jobs.map((job) => unavailableJob(job.id, job.name, job.role)),
    );
    if (!raw.lowMemoryOk) unavailable.push("lowMemoryNotification");
    noteUnavailable(unavailable, "memory", memory.metricUnavailable);
    noteUnavailable(unavailable, "disk", memoryDiskUnavailable(disk));
    noteUnavailable(unavailable, "disk.queue", disk.queueMetricUnavailable);
    noteUnavailable(unavailable, "gpu", gpu.metricUnavailable);
    noteUnavailable(unavailable, "defender", defender.metricUnavailable);
    if (jobs.some((job) => job.metricUnavailable)) noteUnavailable(unavailable, "jobs", true);
    return hardwareSnapshot({
      sampledAtMs: request.sampledAtMs,
      provider: "win32",
      cadence: request.cadence,
      memory,
      jobs,
      gpu,
      disk,
      defender,
      ui: request.ui,
      unavailableMetrics: unavailable,
      sampleDurationMs: performance.now() - started,
    });
  }

  async close(): Promise<void> {
    await this.source.close();
  }
}

function isolate<T>(name: string, unavailable: string[], read: () => T, fallback: () => T): T {
  try {
    return read();
  } catch {
    unavailable.push(name);
    return fallback();
  }
}

function mapMemory(raw: HelperSample): ReturnType<typeof memorySample> {
  const memory = raw.memory;
  if (!memory.ok) return unavailableMemory();
  assertBytes(memory.totalPhys, "totalPhys");
  assertBytes(memory.availPhys, "availPhys");
  assertBytes(memory.totalPage, "totalPage");
  assertBytes(memory.availPage, "availPage");
  if (memory.load < 0 || memory.load > 100) throw new TelemetryError("memory", "memory load is out of range");
  return memorySample({
    totalPhysicalBytes: memory.totalPhys,
    availablePhysicalBytes: memory.availPhys,
    totalPageFileBytes: memory.totalPage,
    availablePageFileBytes: memory.availPage,
    memoryLoadPercent: memory.load,
    lowMemoryNotification: raw.lowMemoryOk && raw.lowMemory,
    lowMemoryNotificationUnavailable: !raw.lowMemoryOk,
    commitMetricUnavailable: false,
    metricUnavailable: false,
  });
}

function mapDisk(raw: HelperSample, request: TelemetrySampleRequest): ReturnType<typeof diskSample> {
  return diskSample(mapVolume("workspace", raw.disk.workspace, request.workspacePath), mapVolume("appdata", raw.disk.appData, request.appDataPath), {
    queueLength: raw.disk.queueOk ? raw.disk.queueLength : null,
    ioBusyPercent: raw.disk.queueOk ? raw.disk.ioBusyPercent : null,
    queueMetricUnavailable: !raw.disk.queueOk,
  });
}

function mapVolume(
  role: "workspace" | "appdata",
  raw: HelperSample["disk"]["workspace"],
  fallbackPath: string,
): ReturnType<typeof volumeSample> {
  if (!raw.ok) {
    return volumeSample({
      role,
      path: raw.path || fallbackPath,
      freeBytes: 0,
      totalBytes: 0,
      metricUnavailable: true,
    });
  }
  assertBytes(raw.free, "free");
  assertBytes(raw.total, "total");
  return volumeSample({
    role,
    path: raw.path || fallbackPath,
    freeBytes: raw.free,
    totalBytes: raw.total,
    metricUnavailable: false,
  });
}

function mapGpu(raw: HelperSample): ReturnType<typeof gpuSample> {
  const gpu = raw.gpu;
  if (!gpu.ok) return gpuFallback(gpu.sharedVramBudgetBytes, true);
  if (!gpu.available) return gpuFallback(gpu.sharedVramBudgetBytes ?? 0, false);
  return gpuSample({
    gpuAvailable: true,
    adapterName: gpu.adapterName,
    budgetBytes: gpu.budgetBytes,
    currentUsageBytes: gpu.currentUsageBytes,
    availableForReservationBytes: gpu.availableForReservationBytes,
    sharedVramBudgetBytes: gpu.sharedVramBudgetBytes,
    metricUnavailable: false,
  });
}

function mapDefender(raw: HelperSample): ReturnType<typeof defenderSample> {
  if (!raw.defender.ok && raw.defender.error) {
    throw new TelemetryError("defender", raw.defender.error);
  }
  return defenderSample(raw.defender.cpuPercent, raw.defender.accessDenied || !raw.defender.ok);
}

function mapJobs(raw: HelperSample): ReturnType<typeof unavailableJob>[] {
  return raw.jobs.map((job) => mapJob(job));
}

function mapJob(job: HelperJob): ReturnType<typeof unavailableJob> {
  const role = jobRole(job.role);
  if (!job.ok) return unavailableJob(job.id, job.name, role);
  assertBytes(job.peakJobMemoryUsed, "peak");
  assertBytes(job.currentWorkingSet, "workingSet");
  assertBytes(job.totalUserTimeMs, "user");
  assertBytes(job.totalKernelTimeMs, "kernel");
  assertBytes(job.activeProcesses, "active");
  return {
    jobId: job.id,
    jobName: job.name,
    role,
    peakJobMemoryUsedBytes: job.peakJobMemoryUsed,
    currentWorkingSetBytes: job.currentWorkingSet,
    totalUserTimeMs: job.totalUserTimeMs,
    totalKernelTimeMs: job.totalKernelTimeMs,
    activeProcessCount: job.activeProcesses,
    metricUnavailable: false,
  };
}

function jobRole(value: string): JobRole {
  if (JOB_ROLES.some((role) => role === value)) return value as JobRole;
  throw new TelemetryError("job_role", `unknown job role ${value}`);
}

function assertBytes(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TelemetryError("metric", `${label} is not a non-negative integer`);
  }
}

function noteUnavailable(unavailable: string[], name: string, failed: boolean): void {
  if (failed && !unavailable.includes(name)) unavailable.push(name);
}

function memoryDiskUnavailable(disk: ReturnType<typeof diskSample>): boolean {
  return disk.volumes.some((volume) => volume.metricUnavailable);
}
