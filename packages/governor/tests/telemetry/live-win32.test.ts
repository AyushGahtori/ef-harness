import fs from "node:fs";
import os from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import { WindowsResourceTelemetryCollector } from "../../src/telemetry/collector.js";
import { HardwareSnapshotSchema } from "../../src/telemetry/schema.js";
import { PosixFallbackTelemetryProvider } from "../../src/telemetry/posix-provider.js";
import { neutralUi } from "../../src/telemetry/snapshot.js";
import { MAX_SAMPLE_MS } from "../../src/telemetry/types.js";
import { Win32HelperClient } from "../../src/telemetry/win32-helper-client.js";
import { Win32NativeTelemetryProvider } from "../../src/telemetry/win32-provider.js";

const windows = process.platform === "win32";

describe.skipIf(!windows)("live Windows resource telemetry", () => {
  let client: Win32HelperClient | null = null;

  afterAll(async () => {
    if (!client) return;
    await client.closeProbeJob().catch(() => undefined);
    await client.close().catch(() => undefined);
  });

  it("reads GlobalMemoryStatusEx, both volumes, DXGI, Defender, and a Job Object without spawning on the sample tick", async () => {
    client = await Win32HelperClient.connect();
    const startsBefore = client.guard.sampleProcessStarts;
    const probe = await client.createProbeJob();
    const provider = new Win32NativeTelemetryProvider(client);
    const workspace = process.cwd();
    const appData = process.env["LOCALAPPDATA"] ?? workspace;
    const collector = new WindowsResourceTelemetryCollector({
      provider,
      workspacePath: workspace,
      appDataPath: appData,
      jobs: { listActiveJobs: () => [{ id: probe.jobId, name: probe.name, role: "worker" }] },
    });
    await collector.sampleOnce();
    await collector.sampleOnce();
    const snapshot = await collector.sampleOnce();
    HardwareSnapshotSchema.parse(snapshot);
    expect(snapshot.provider).toBe("win32");
    expect(snapshot.memory.totalPhysicalBytes).toBe(os.totalmem());
    expect(snapshot.memory.availablePhysicalBytes).toBeGreaterThan(0);
    expect(snapshot.memory.totalPageFileBytes).toBeGreaterThan(0);
    expect(snapshot.memory.availablePageFileBytes).toBeGreaterThan(0);
    expect(snapshot.memory.totalPageFileBytes).toBeGreaterThanOrEqual(snapshot.memory.availablePageFileBytes);
    expect(snapshot.memory.metricUnavailable).toBe(false);
    expect(snapshot.memory.commitMetricUnavailable).toBe(false);
    expect(snapshot.disk.volumes).toHaveLength(2);
    expect(snapshot.disk.volumes[0]?.role).toBe("workspace");
    expect(snapshot.disk.volumes[1]?.role).toBe("appdata");
    expect(snapshot.disk.volumes[0]?.freeBytes).toBeGreaterThan(0);
    expect(snapshot.disk.volumes[1]?.freeBytes).toBeGreaterThan(0);
    const workspaceFree = freeBytes(workspace);
    const appDataFree = freeBytes(appData);
    expect(relativeGap(snapshot.disk.volumes[0].freeBytes, workspaceFree)).toBeLessThan(0.05);
    expect(relativeGap(snapshot.disk.volumes[1].freeBytes, appDataFree)).toBeLessThan(0.05);
    expect(snapshot.gpu.gpuAvailable === true || typeof snapshot.gpu.sharedVramBudgetBytes === "number").toBe(true);
    expect(snapshot.defender.processName).toBe("MsMpEng.exe");
    expect(snapshot.defender.settingsMutated).toBe(false);
    expect(snapshot.jobs[0]?.metricUnavailable).toBe(false);
    expect(snapshot.jobs[0]?.activeProcessCount).toBeGreaterThan(0);
    expect(snapshot.jobs[0]?.peakJobMemoryUsedBytes).toBeGreaterThan(0);
    expect(snapshot.sampleDurationMs).toBeLessThan(MAX_SAMPLE_MS);
    expect(client.guard.sampleProcessStarts).toBe(startsBefore);
    expect(client.executable.toLowerCase()).not.toMatch(/powershell|wmic|cmd\.exe/);
    expect(collector.retainedBytes()).toBeLessThan(15 * 1024 * 1024);
    await collector.close();
    client = null;
  });
});

describe("PosixFallbackTelemetryProvider", () => {
  it("samples physical memory and both volumes without a Win32 helper", async () => {
    const provider = new PosixFallbackTelemetryProvider();
    const snapshot = await provider.sample({
      sampledAtMs: 1,
      cadence: "idle",
      workspacePath: process.cwd(),
      appDataPath: process.cwd(),
      jobs: [],
      ui: neutralUi(),
    });
    expect(snapshot.provider).toBe("posix");
    expect(snapshot.memory.totalPhysicalBytes).toBe(os.totalmem());
    expect(snapshot.memory.commitMetricUnavailable).toBe(true);
    expect(snapshot.memory.commitExhausted).toBe(false);
    expect(snapshot.disk.volumes).toHaveLength(2);
    expect(snapshot.gpu.gpuAvailable).toBe(false);
    expect(snapshot.gpu.metricUnavailable).toBe(true);
    expect(snapshot.defender.metricUnavailable).toBe(true);
    expect(snapshot.defender.settingsMutated).toBe(false);
    HardwareSnapshotSchema.parse(snapshot);
    await provider.close();
  });
});

function freeBytes(filePath: string): number {
  const stats = fs.statfsSync(filePath);
  return Math.trunc(Number(stats.bavail) * Number(stats.bsize));
}

function relativeGap(actual: number, expected: number): number {
  const scale = Math.max(expected, 1);
  return Math.abs(actual - expected) / scale;
}
