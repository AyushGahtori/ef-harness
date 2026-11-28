import os from "node:os";
import path from "node:path";
import { ManualScheduler, TimeoutScheduler, pollIntervalMs, type Scheduler } from "./cadence.js";
import { MemoryNotificationWatcher, type LowMemorySource } from "./memory-notification.js";
import { MemoryTelemetryDbRepo, type TelemetryDbRepo, type WindowsJobSupervisor } from "./ports.js";
import type { ResourceTelemetryProvider } from "./provider.js";
import { TelemetryFlushBuffer, TelemetryRingBuffer } from "./retention.js";
import { hardwareSnapshot } from "./snapshot.js";
import type {
  ActiveJobSlot,
  CollectorCadence,
  HardwareSnapshot,
  JobAccountingSample,
} from "./types.js";
import { MAX_COLLECTOR_RAM_BYTES, TelemetryError } from "./types.js";
import { UiLatencyHeartbeatMonitor } from "./ui-latency.js";

export interface CollectorClock {
  now(): number;
}

export interface WindowsResourceTelemetryCollectorOptions {
  readonly provider: ResourceTelemetryProvider;
  readonly jobs?: WindowsJobSupervisor;
  readonly telemetry?: TelemetryDbRepo;
  readonly ui?: UiLatencyHeartbeatMonitor;
  readonly lowMemory?: MemoryNotificationWatcher;
  readonly clock?: CollectorClock;
  readonly scheduler?: Scheduler;
  readonly workspacePath?: string;
  readonly appDataPath?: string;
  readonly ringCapacity?: number;
  readonly maxRetainedBytes?: number;
}

export class WindowsResourceTelemetryCollector {
  readonly provider: ResourceTelemetryProvider;
  readonly ui: UiLatencyHeartbeatMonitor;
  readonly lowMemory: MemoryNotificationWatcher;
  private readonly jobs: WindowsJobSupervisor | null;
  private readonly telemetry: TelemetryDbRepo;
  private readonly clock: CollectorClock;
  private readonly scheduler: Scheduler;
  private readonly workspacePath: string;
  private readonly appDataPath: string;
  private readonly ring: TelemetryRingBuffer;
  private readonly flushBuffer: TelemetryFlushBuffer;
  private mode: CollectorCadence = "idle";
  private running = false;

  constructor(options: WindowsResourceTelemetryCollectorOptions) {
    this.provider = options.provider;
    this.jobs = options.jobs ?? null;
    this.telemetry = options.telemetry ?? new MemoryTelemetryDbRepo();
    this.ui = options.ui ?? new UiLatencyHeartbeatMonitor();
    this.lowMemory = options.lowMemory ?? new MemoryNotificationWatcher(new SilentLowMemorySource());
    this.clock = options.clock ?? { now: () => Date.now() };
    this.scheduler = options.scheduler ?? new TimeoutScheduler();
    this.workspacePath = options.workspacePath ?? process.cwd();
    this.appDataPath = options.appDataPath ?? defaultAppDataPath();
    this.ring = new TelemetryRingBuffer(options.ringCapacity, options.maxRetainedBytes ?? MAX_COLLECTOR_RAM_BYTES);
    this.flushBuffer = new TelemetryFlushBuffer();
  }

  cadence(): CollectorCadence {
    return this.mode;
  }

  setBuildActive(buildActive: boolean): void {
    if (this.mode === "suspended") return;
    this.mode = buildActive ? "active" : "idle";
    if (this.running) this.arm();
  }

  suspend(): void {
    this.mode = "suspended";
    if (this.running) this.arm();
  }

  resume(buildActive: boolean): void {
    this.mode = buildActive ? "active" : "idle";
    if (this.running) this.arm();
  }

  start(): void {
    this.running = true;
    this.lowMemory.start();
    this.arm();
  }

  stop(): void {
    this.running = false;
    this.scheduler.clear();
  }

  async sampleOnce(): Promise<HardwareSnapshot> {
    const sampledAtMs = this.clock.now();
    const slots = this.jobs ? await Promise.resolve(this.jobs.listActiveJobs()) : [];
    const ui = this.ui.assessment();
    const started = performance.now();
    const sampled = await this.provider.sample({
      sampledAtMs,
      cadence: this.mode,
      workspacePath: this.workspacePath,
      appDataPath: this.appDataPath,
      jobs: slots,
      ui,
    });
    const sampleDurationMs = performance.now() - started;
    const jobs = await hydrateJobs(sampled.jobs, slots, this.jobs);
    const memory = this.lowMemory.isSignaled()
      ? { ...sampled.memory, lowMemoryNotification: true }
      : sampled.memory;
    const snapshot = hardwareSnapshot({
      sampledAtMs,
      provider: sampled.provider,
      cadence: this.mode,
      memory,
      jobs,
      gpu: sampled.gpu,
      disk: sampled.disk,
      defender: sampled.defender,
      ui,
      unavailableMetrics: sampled.unavailableMetrics,
      sampleDurationMs,
    });
    this.ring.push(snapshot);
    this.flushBuffer.push({ attempt: null, ts: sampledAtMs, kind: "metric", data: snapshot });
    this.flushBuffer.flush(this.telemetry);
    return snapshot;
  }

  retainedBytes(): number {
    const repoBytes = this.telemetry.estimatedBytes?.() ?? 0;
    return this.ring.estimatedBytes() + this.flushBuffer.estimatedBytes() + repoBytes;
  }

  ringLength(): number {
    return this.ring.length;
  }

  latest(): HardwareSnapshot | null {
    return this.ring.latest();
  }

  pendingDelay(): number | null {
    return pollIntervalMs(this.mode);
  }

  async close(): Promise<void> {
    this.stop();
    this.lowMemory.stop();
    this.flushBuffer.flush(this.telemetry);
    await this.provider.close();
  }

  private arm(): void {
    this.scheduler.clear();
    if (!this.running) return;
    const delay = pollIntervalMs(this.mode);
    if (delay === null) return;
    this.scheduler.set(delay, () => {
      void this.sampleOnce().finally(() => {
        if (this.running) this.arm();
      });
    });
  }
}

export function defaultAppDataPath(): string {
  const local = process.env["LOCALAPPDATA"];
  if (local && local.trim().length > 0) return local;
  if (process.platform === "win32") return path.join(os.homedir(), "AppData", "Local");
  return path.join(os.homedir(), ".local", "share");
}

export async function openWindowsResourceTelemetryCollector(
  options: Partial<Omit<WindowsResourceTelemetryCollectorOptions, "provider">> & {
    readonly provider?: ResourceTelemetryProvider;
  } = {},
): Promise<WindowsResourceTelemetryCollector> {
  if (options.provider) {
    return new WindowsResourceTelemetryCollector({ ...options, provider: options.provider });
  }
  if (process.platform === "win32") {
    try {
      const { Win32HelperClient } = await import("./win32-helper-client.js");
      const { Win32NativeTelemetryProvider } = await import("./win32-provider.js");
      const client = await Win32HelperClient.connect();
      const provider = new Win32NativeTelemetryProvider(client);
      const lowMemory =
        options.lowMemory ??
        new MemoryNotificationWatcher({
          watch(onSignal) {
            return client.onLowMemory(onSignal);
          },
        });
      lowMemory.start();
      return new WindowsResourceTelemetryCollector({ ...options, provider, lowMemory });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Win32 telemetry helper failed";
      throw error instanceof TelemetryError ? error : new TelemetryError("helper_unavailable", message);
    }
  }
  const { PosixFallbackTelemetryProvider } = await import("./posix-provider.js");
  return new WindowsResourceTelemetryCollector({
    ...options,
    provider: new PosixFallbackTelemetryProvider(),
  });
}

async function hydrateJobs(
  jobs: readonly JobAccountingSample[],
  slots: readonly ActiveJobSlot[],
  supervisor: WindowsJobSupervisor | null,
): Promise<readonly JobAccountingSample[]> {
  if (!supervisor?.queryJobAccounting) return jobs;
  const query = supervisor.queryJobAccounting.bind(supervisor);
  const filled: JobAccountingSample[] = [];
  for (const job of jobs) {
    if (!job.metricUnavailable) {
      filled.push(job);
      continue;
    }
    const slot = slots.find((item) => item.id === job.jobId);
    if (!slot) {
      filled.push(job);
      continue;
    }
    try {
      const numbers = await query(slot);
      filled.push({
        jobId: job.jobId,
        jobName: job.jobName,
        role: job.role,
        peakJobMemoryUsedBytes: numbers.peakJobMemoryUsedBytes,
        currentWorkingSetBytes: numbers.currentWorkingSetBytes,
        totalUserTimeMs: numbers.totalUserTimeMs,
        totalKernelTimeMs: numbers.totalKernelTimeMs,
        activeProcessCount: numbers.activeProcessCount,
        metricUnavailable: false,
      });
    } catch {
      filled.push(job);
    }
  }
  return filled;
}

class SilentLowMemorySource implements LowMemorySource {
  watch(): () => void {
    return () => undefined;
  }
}

export function describeCadence(scheduler: ManualScheduler): number | null {
  return scheduler.pendingDelay();
}
