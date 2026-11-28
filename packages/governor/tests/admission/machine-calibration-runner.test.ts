import { describe, expect, it } from "vitest";
import {
  CalibrationBudgetExceededError,
  MachineCalibrationRunner,
} from "../../src/admission/machine-calibration-runner.js";
import { InMemoryGlobalDb } from "../../src/admission/ports/in-memory-global-db.js";
import { CALIBRATION_BUDGET_MS, concurrencyCaps } from "../../src/admission/thresholds.js";
import type { MachineHardwareProbe } from "../../src/admission/machine-calibration-runner.js";

function probe(overrides: Partial<MachineHardwareProbe> = {}): MachineHardwareProbe {
  return {
    cpuCoreCount: 8,
    totalPhysicalRamMb: 16 * 1024,
    gpuAvailable: true,
    vramBudgetMb: 8_192,
    ioLatencyMs: 0.4,
    devDrive: false,
    inspectionDurationMs: 12,
    ...overrides,
  };
}

describe("machine calibration runner", () => {
  it("sets 2 warm slots on a 16 GB laptop and 4 on a 64 GB desktop", () => {
    expect(concurrencyCaps(16 * 1024)).toMatchObject({
      warmExecutionSlots: 2,
      thinkingSlots: 12,
      heavyLanePermits: 1,
    });
    expect(concurrencyCaps(64 * 1024)).toMatchObject({
      warmExecutionSlots: 4,
      thinkingSlots: 20,
      heavyLanePermits: 2,
    });
    expect(CALIBRATION_BUDGET_MS).toBe(3_000);

    let now = 1_700_000_000_000;
    const clock = { now: () => now };
    const db = new InMemoryGlobalDb();
    const runner = new MachineCalibrationRunner(db, clock);
    const first = runner.ensure(probe());
    expect(first.reason).toBe("first_launch");
    expect(first.warmExecutionSlots).toBe(2);
    expect(first.elapsedMs).toBeLessThanOrEqual(3_000);
    expect(first.storageClass).toBe("ssd");
    expect(first.gpu).toBe("discrete:8192mb");
    expect(db.machineProfile.get("ram_total_mb")).toEqual({
      key: "ram_total_mb",
      value: String(16 * 1024),
      measuredAt: now,
    });
    expect(db.machineProfile.get("cores")?.value).toBe("8");
    expect(db.machineProfile.get("gpu")?.value).toBe("discrete:8192mb");
    expect(db.machineProfile.get("dev_drive")?.value).toBe("false");
    expect(db.machineProfile.get("warm_execution_slots")?.value).toBe("2");
    expect(db.machineProfile.get("calibration_run")?.value).toContain("\"nonIntrusive\":true");

    now += 5_000;
    const again = runner.ensure(probe());
    expect(again.measuredAtMs).toBe(first.measuredAtMs);
    expect(db.machineProfile.get("ram_total_mb")?.measuredAt).toBe(first.measuredAtMs);

    const changed = runner.ensure(probe({ totalPhysicalRamMb: 64 * 1024, cpuCoreCount: 16 }));
    expect(changed.reason).toBe("hardware_change");
    expect(changed.warmExecutionSlots).toBe(4);
    expect(changed.heavyLanePermits).toBe(2);
    expect(changed.thinkingSlots).toBe(20);
    expect(db.machineProfile.get("ram_total_mb")?.value).toBe(String(64 * 1024));

    now += 5_000;
    const manual = runner.run(
      probe({
        totalPhysicalRamMb: 64 * 1024,
        cpuCoreCount: 16,
        ioLatencyMs: 15,
        devDrive: true,
        gpuAvailable: false,
        vramBudgetMb: 0,
      }),
      "manual",
    );
    expect(manual.reason).toBe("manual");
    expect(manual.storageClass).toBe("hdd");
    expect(manual.devDrive).toBe(true);
    expect(manual.gpu).toBe("none");
    expect(manual.measuredAtMs).toBe(now);
    expect(manual.elapsedMs).toBeLessThanOrEqual(3_000);
    expect(db.machineProfile.get("storage_class")?.value).toBe("hdd");
    expect(db.machineProfile.get("dev_drive")?.value).toBe("true");
  });

  it("rejects a probe that exceeds the 3 second non-intrusive budget", () => {
    const db = new InMemoryGlobalDb();
    const runner = new MachineCalibrationRunner(db, { now: () => 10 });
    expect(() => runner.ensure(probe({ inspectionDurationMs: 3_001 }))).toThrow(
      CalibrationBudgetExceededError,
    );
    expect(db.machineProfile.list()).toEqual([]);
  });
});
