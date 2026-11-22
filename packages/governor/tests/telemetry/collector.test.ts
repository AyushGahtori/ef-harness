import { describe, expect, it } from "vitest";
import { ManualScheduler } from "../../src/telemetry/cadence.js";
import { WindowsResourceTelemetryCollector } from "../../src/telemetry/collector.js";
import { ManualLowMemorySource, MemoryNotificationWatcher } from "../../src/telemetry/memory-notification.js";
import { MemoryTelemetryDbRepo } from "../../src/telemetry/ports.js";
import { PollSubprocessGuard } from "../../src/telemetry/poll-guard.js";
import { neutralUi } from "../../src/telemetry/snapshot.js";
import { SyntheticTelemetryProvider } from "../../src/telemetry/synthetic-provider.js";
import { UiLatencyHeartbeatMonitor } from "../../src/telemetry/ui-latency.js";
import {
  ACTIVE_POLL_MS,
  IDLE_POLL_MS,
  MAX_COLLECTOR_CPU_RATIO,
  MAX_COLLECTOR_RAM_BYTES,
  MAX_SAMPLE_MS,
} from "../../src/telemetry/types.js";
import type { Win32SampleSource } from "../../src/telemetry/win32-provider.js";
import { Win32NativeTelemetryProvider } from "../../src/telemetry/win32-provider.js";
import type { HelperSample } from "../../src/telemetry/win32-helper-client.js";

describe("WindowsResourceTelemetryCollector", () => {
  it("polls at 1s while a build is active, 5s while idle, and 0 Hz while suspended", () => {
    const scheduler = new ManualScheduler();
    const collector = new WindowsResourceTelemetryCollector({
      provider: SyntheticTelemetryProvider.scenario("low-memory"),
      scheduler,
    });
    collector.start();
    expect(scheduler.pendingDelay()).toBe(IDLE_POLL_MS);
    collector.setBuildActive(true);
    expect(scheduler.pendingDelay()).toBe(ACTIVE_POLL_MS);
    collector.suspend();
    expect(scheduler.pendingDelay()).toBeNull();
    expect(collector.cadence()).toBe("suspended");
    collector.resume(true);
    expect(scheduler.pendingDelay()).toBe(ACTIVE_POLL_MS);
    collector.stop();
  });

  it("keeps the ring buffer and telemetry flush under 15 MB", async () => {
    const telemetry = new MemoryTelemetryDbRepo();
    const collector = new WindowsResourceTelemetryCollector({
      provider: SyntheticTelemetryProvider.scenario("split-drive"),
      telemetry,
    });
    for (let index = 0; index < 5000; index += 1) await collector.sampleOnce();
    expect(collector.ringLength()).toBeLessThanOrEqual(256);
    expect(telemetry.rows.length).toBeLessThanOrEqual(2000);
    expect(collector.retainedBytes()).toBeLessThan(MAX_COLLECTOR_RAM_BYTES);
    expect(collector.latest()?.disk.tightestDrive).toBe("C:");
    await collector.close();
  });

  it("stays under the 5 ms and 0.5% CPU sample budget on the synthetic path", async () => {
    const collector = new WindowsResourceTelemetryCollector({
      provider: SyntheticTelemetryProvider.scenario("commit-exhaustion"),
    });
    collector.setBuildActive(true);
    const durations: number[] = [];
    for (let index = 0; index < 30; index += 1) {
      const snapshot = await collector.sampleOnce();
      durations.push(snapshot.sampleDurationMs);
    }
    const mean = durations.reduce((sum, value) => sum + value, 0) / durations.length;
    expect(mean).toBeLessThan(MAX_SAMPLE_MS);
    expect(mean / ACTIVE_POLL_MS).toBeLessThan(MAX_COLLECTOR_CPU_RATIO);
    await collector.close();
  });

  it("signals low memory from the kernel watcher without waiting for the next poll", async () => {
    const source = new ManualLowMemorySource();
    const lowMemory = new MemoryNotificationWatcher(source);
    lowMemory.start();
    let signaled = false;
    lowMemory.onLowMemory(() => {
      signaled = true;
    });
    source.emit(true);
    expect(signaled).toBe(true);
    const collector = new WindowsResourceTelemetryCollector({
      provider: SyntheticTelemetryProvider.scenario("commit-exhaustion"),
      lowMemory,
    });
    const snapshot = await collector.sampleOnce();
    expect(snapshot.memory.lowMemoryNotification).toBe(true);
    expect(snapshot.memory.commitExhausted).toBe(true);
    await collector.close();
  });

  it("overlays foreground UI lag and ignores a minimized window", async () => {
    const ui = new UiLatencyHeartbeatMonitor(1);
    const collector = new WindowsResourceTelemetryCollector({
      provider: SyntheticTelemetryProvider.scenario("low-memory"),
      ui,
    });
    ui.ingest({ atMs: 1, uiLatencyMs: 1000, documentHidden: true, interacting: true });
    const hidden = await collector.sampleOnce();
    expect(hidden.ui.pressure).toBe(false);
    expect(hidden.ui.suppressedHidden).toBe(true);
    ui.ingest({ atMs: 2, uiLatencyMs: 70, documentHidden: false, interacting: true });
    const visible = await collector.sampleOnce();
    expect(visible.ui.pressure).toBe(true);
    expect(visible.ui.uiLatencyMs).toBe(70);
    await collector.close();
  });

  it("uses supervisor job accounting when the native job open is denied", async () => {
    const collector = new WindowsResourceTelemetryCollector({
      provider: SyntheticTelemetryProvider.scenario("low-memory"),
      jobs: {
        listActiveJobs: () => [{ id: "job-1", name: "Local\\EFHarness-job-1", role: "verifier" }],
        queryJobAccounting: () => ({
          peakJobMemoryUsedBytes: 4096,
          currentWorkingSetBytes: 2048,
          totalUserTimeMs: 12,
          totalKernelTimeMs: 4,
          activeProcessCount: 2,
        }),
      },
    });
    const snapshot = await collector.sampleOnce();
    expect(snapshot.jobs[0]).toMatchObject({
      jobId: "job-1",
      role: "verifier",
      peakJobMemoryUsedBytes: 4096,
      currentWorkingSetBytes: 2048,
      totalUserTimeMs: 12,
      totalKernelTimeMs: 4,
      activeProcessCount: 2,
      metricUnavailable: false,
    });
    await collector.close();
  });
});

describe("Win32 metric isolation", () => {
  it("keeps memory and disk flowing when Defender and a job return ACCESS_DENIED", async () => {
    const provider = new Win32NativeTelemetryProvider(new DeniedDefenderSource());
    const snapshot = await provider.sample({
      sampledAtMs: 1,
      cadence: "active",
      workspacePath: "D:\\work\\repo",
      appDataPath: "C:\\Users\\dev\\AppData\\Local",
      jobs: [{ id: "job-1", name: "denied", role: "worker" }],
      ui: neutralUi(),
    });
    expect(snapshot.memory.metricUnavailable).toBe(false);
    expect(snapshot.memory.totalPhysicalBytes).toBe(16 * 1024 * 1024 * 1024);
    expect(snapshot.disk.volumes[1]?.metricUnavailable).toBe(false);
    expect(snapshot.defender.metricUnavailable).toBe(true);
    expect(snapshot.defender.settingsMutated).toBe(false);
    expect(snapshot.jobs[0]?.metricUnavailable).toBe(true);
    expect(snapshot.jobs[0]?.role).toBe("worker");
    expect(snapshot.gpu.gpuAvailable).toBe(false);
    expect(snapshot.gpu.sharedVramBudgetBytes).toBe(0);
    expect(snapshot.unavailableMetrics).toContain("defender");
    expect(snapshot.unavailableMetrics).toContain("jobs");
    await provider.close();
  });

  it("isolates a malformed memory section from disk and GPU", async () => {
    const provider = new Win32NativeTelemetryProvider(new MalformedMemorySource());
    const snapshot = await provider.sample({
      sampledAtMs: 2,
      cadence: "idle",
      workspacePath: "C:\\repo",
      appDataPath: "C:\\Users\\dev\\AppData\\Local",
      jobs: [],
      ui: neutralUi(),
    });
    expect(snapshot.memory.metricUnavailable).toBe(true);
    expect(snapshot.disk.volumes[0]?.freeBytes).toBe(80);
    expect(snapshot.gpu.gpuAvailable).toBe(false);
    expect(snapshot.gpu.sharedVramBudgetBytes).toBe(32);
    expect(snapshot.unavailableMetrics).toContain("memory");
    await provider.close();
  });
});

describe("poll subprocess guard", () => {
  it("rejects powershell, cmd, and wmic, and any spawn during a sample", () => {
    const guard = new PollSubprocessGuard();
    expect(() => guard.assertCanStart("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toThrow(
      /powershell.exe/,
    );
    expect(() => guard.assertCanStart("C:\\Windows\\System32\\cmd.exe")).toThrow(/cmd.exe/);
    expect(() => guard.assertCanStart("C:\\Windows\\System32\\wbem\\wmic.exe")).toThrow(/wmic.exe/);
    guard.enterSample();
    expect(() => guard.assertCanStart("C:\\helper.exe")).toThrow(/subprocess/);
    expect(guard.sampleProcessStarts).toBe(1);
    guard.exitSample();
  });
});

class DeniedDefenderSource implements Win32SampleSource {
  async sample(): Promise<HelperSample> {
    return baseSample({
      defender: {
        ok: false,
        cpuPercent: 45,
        accessDenied: true,
        found: true,
        error: "ACCESS_DENIED",
      },
      jobs: [
        {
          id: "job-1",
          name: "denied",
          role: "worker",
          ok: false,
          peakJobMemoryUsed: 0,
          currentWorkingSet: 0,
          totalUserTimeMs: 0,
          totalKernelTimeMs: 0,
          activeProcesses: 0,
          win32: 5,
          error: "ACCESS_DENIED",
        },
      ],
    });
  }

  async close(): Promise<void> {
    return undefined;
  }
}

class MalformedMemorySource implements Win32SampleSource {
  async sample(): Promise<HelperSample> {
    const sample = baseSample();
    return {
      ...sample,
      memory: { ...sample.memory, ok: true, totalPhys: -1 },
      gpu: { ...sample.gpu, sharedVramBudgetBytes: 32 },
    };
  }

  async close(): Promise<void> {
    return undefined;
  }
}

function baseSample(overrides: Partial<HelperSample> = {}): HelperSample {
  const gib = 1024 * 1024 * 1024;
  return {
    memory: {
      ok: true,
      totalPhys: 16 * gib,
      availPhys: 8 * gib,
      totalPage: 20 * gib,
      availPage: 10 * gib,
      load: 50,
      error: null,
    },
    lowMemory: false,
    lowMemoryOk: true,
    disk: {
      workspace: { ok: true, path: "D:\\work\\repo", free: 80, total: 100, error: null },
      appData: { ok: true, path: "C:\\Users\\dev\\AppData\\Local", free: 40, total: 100, error: null },
      queueLength: 0.2,
      ioBusyPercent: 3,
      queueOk: true,
    },
    gpu: {
      ok: true,
      available: false,
      adapterName: null,
      budgetBytes: null,
      currentUsageBytes: null,
      availableForReservationBytes: null,
      sharedVramBudgetBytes: overrides.gpu?.sharedVramBudgetBytes ?? 0,
      error: null,
    },
    defender: {
      ok: true,
      cpuPercent: 1,
      accessDenied: false,
      found: true,
      error: null,
    },
    jobs: [],
    ...overrides,
  };
}
