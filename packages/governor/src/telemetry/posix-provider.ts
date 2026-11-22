import fs from "node:fs";
import os from "node:os";
import type { ResourceTelemetryProvider, TelemetrySampleRequest } from "./provider.js";
import { defenderSample, diskSample, gpuFallback, hardwareSnapshot, memorySample, volumeSample } from "./snapshot.js";
import { unavailableJob } from "./snapshot.js";

export class PosixFallbackTelemetryProvider implements ResourceTelemetryProvider {
  readonly kind = "posix" as const;

  async sample(request: TelemetrySampleRequest): Promise<ReturnType<typeof hardwareSnapshot>> {
    const started = performance.now();
    const unavailable: string[] = [];
    const totalPhysicalBytes = os.totalmem();
    const availablePhysicalBytes = os.freemem();
    const memory = memorySample({
      totalPhysicalBytes,
      availablePhysicalBytes,
      totalPageFileBytes: 0,
      availablePageFileBytes: 0,
      memoryLoadPercent: loadPercent(availablePhysicalBytes, totalPhysicalBytes),
      lowMemoryNotification: false,
      lowMemoryNotificationUnavailable: true,
      commitMetricUnavailable: true,
      metricUnavailable: false,
    });
    unavailable.push("commit", "lowMemoryNotification");
    const disk = readDisk(request.workspacePath, request.appDataPath, unavailable);
    const jobs = request.jobs.map((job) => unavailableJob(job.id, job.name, job.role));
    if (jobs.length > 0) unavailable.push("jobs");
    unavailable.push("gpu", "defender");
    return hardwareSnapshot({
      sampledAtMs: request.sampledAtMs,
      provider: "posix",
      cadence: request.cadence,
      memory,
      jobs,
      gpu: gpuFallback(null, true),
      disk,
      defender: defenderSample(0, true),
      ui: request.ui,
      unavailableMetrics: unavailable,
      sampleDurationMs: performance.now() - started,
    });
  }

  async close(): Promise<void> {
    return undefined;
  }
}

function readDisk(workspacePath: string, appDataPath: string, unavailable: string[]): ReturnType<typeof diskSample> {
  const workspace = readVolume("workspace", workspacePath, unavailable);
  const appData = readVolume("appdata", appDataPath, unavailable);
  return diskSample(workspace, appData, {
    queueLength: null,
    ioBusyPercent: null,
    queueMetricUnavailable: true,
  });
}

function readVolume(
  role: "workspace" | "appdata",
  filePath: string,
  unavailable: string[],
): ReturnType<typeof volumeSample> {
  try {
    const stats = fs.statfsSync(filePath);
    const freeBytes = Math.max(0, Math.trunc(Number(stats.bavail) * Number(stats.bsize)));
    const totalBytes = Math.max(0, Math.trunc(Number(stats.blocks) * Number(stats.bsize)));
    return volumeSample({ role, path: filePath, freeBytes, totalBytes, metricUnavailable: false });
  } catch {
    unavailable.push(role === "workspace" ? "disk.workspace" : "disk.appdata");
    return volumeSample({
      role,
      path: filePath,
      freeBytes: 0,
      totalBytes: 0,
      metricUnavailable: true,
    });
  }
}

function loadPercent(available: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((1 - available / total) * 100)));
}
