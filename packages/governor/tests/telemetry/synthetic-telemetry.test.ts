import { describe, expect, it } from "vitest";
import { HardwareSnapshotSchema } from "../../src/telemetry/schema.js";
import {
  SYNTHETIC_SCENARIOS,
  SyntheticTelemetryProvider,
  syntheticScenario,
} from "../../src/telemetry/synthetic-provider.js";
import { neutralUi } from "../../src/telemetry/snapshot.js";
import { BYTES_PER_GB, HardwareSnapshotError } from "../../src/telemetry/types.js";

describe("HardwareSnapshotSchema", () => {
  it("accepts every synthetic scenario", () => {
    for (const name of SYNTHETIC_SCENARIOS) {
      const parsed = HardwareSnapshotSchema.parse(syntheticScenario(name, 10));
      expect(parsed.schemaId).toBe("ef.governor.hardware_snapshot.v1");
      expect(parsed.provider).toBe("synthetic");
    }
  });

  it("rejects a hidden window that claims UI pressure", () => {
    const frame = syntheticScenario("low-memory");
    const invalid = {
      ...frame,
      ui: { ...neutralUi(), windowVisible: false, pressure: true, uiLatencyMs: 80, suppressedHidden: true },
    };
    expect(HardwareSnapshotSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects Defender settings mutation", () => {
    const frame = syntheticScenario("defender-contention");
    const invalid = { ...frame, defender: { ...frame.defender, settingsMutated: true } };
    const parsed = HardwareSnapshotSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error).toBeInstanceOf(HardwareSnapshotError);
  });
});

describe("SyntheticTelemetryProvider", () => {
  it("replays low memory, commit exhaustion, split drives, and Defender contention", async () => {
    const provider = SyntheticTelemetryProvider.playlist([...SYNTHETIC_SCENARIOS]);
    const request = {
      sampledAtMs: 5,
      cadence: "active" as const,
      workspacePath: "D:\\work\\repo",
      appDataPath: "C:\\Users\\dev\\AppData\\Local",
      jobs: [],
      ui: neutralUi(),
    };
    const low = await provider.sample(request);
    expect(low.memory.lowMemoryNotification).toBe(true);
    expect(low.memory.physicalFreeRatio).toBeLessThan(0.1);
    const commit = await provider.sample({ ...request, sampledAtMs: 6 });
    expect(commit.memory.physicalFreeRatio).toBeCloseTo(0.3, 5);
    expect(commit.memory.availablePageFileBytes).toBeLessThan(BYTES_PER_GB);
    expect(commit.memory.commitExhausted).toBe(true);
    expect(commit.memory.lowMemoryNotification).toBe(false);
    const split = await provider.sample({ ...request, sampledAtMs: 7 });
    expect(split.disk.volumes.map((volume) => volume.drive)).toEqual(["D:", "C:"]);
    expect(split.disk.tightestDrive).toBe("C:");
    expect(split.disk.tightestRole).toBe("appdata");
    expect(split.disk.belowPause5Gb).toBe(true);
    expect(split.disk.belowEmergency2Gb).toBe(false);
    expect(split.disk.volumes[0]?.freeBytes).toBe(500 * BYTES_PER_GB);
    const defender = await provider.sample({ ...request, sampledAtMs: 8 });
    expect(defender.defender.processName).toBe("MsMpEng.exe");
    expect(defender.defender.cpuPercent).toBe(45);
    expect(defender.defender.avContentionActive).toBe(true);
    expect(defender.defender.settingsMutated).toBe(false);
    expect(defender.defender.exclusionTip).toContain("never changes its settings");
    await provider.close();
  });
});
