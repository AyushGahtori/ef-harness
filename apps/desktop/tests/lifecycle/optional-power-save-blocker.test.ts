import { describe, expect, it } from "vitest";
import {
  OptionalPowerSaveBlocker,
  PREVENT_APP_SUSPENSION,
  PREVENT_SLEEP_SETTING_LABEL,
  type ExecutionState,
} from "../../src/lifecycle/index.js";
import { MemoryPowerSaveBlocker, building, createHarness } from "./support.js";

describe("OptionalPowerSaveBlocker", () => {
  it("stays off by default and only starts prevent-app-suspension while BUILDING", () => {
    const blocker = new MemoryPowerSaveBlocker();
    const power = new OptionalPowerSaveBlocker(blocker);
    expect(power.isOptedIn()).toBe(false);
    expect(power.settingLabel).toBe(PREVENT_SLEEP_SETTING_LABEL);
    power.sync({ state: "BUILDING", batteryPercent: 80 });
    expect(blocker.starts).toHaveLength(0);

    power.setOptIn(true);
    power.sync({ state: "BUILDING", batteryPercent: 80 });
    expect(blocker.starts).toEqual([PREVENT_APP_SUSPENSION]);
    expect(power.isActive()).toBe(true);
    power.sync({ state: "BUILDING", batteryPercent: 80 });
    expect(blocker.starts).toHaveLength(1);
  });

  it("releases on DONE, PAUSED, STOPPED, WAITING_ON_USER, and low battery", () => {
    const releases: ExecutionState[] = ["DONE", "PAUSED", "STOPPED", "WAITING_ON_USER"];
    for (const state of releases) {
      const blocker = new MemoryPowerSaveBlocker();
      const power = new OptionalPowerSaveBlocker(blocker);
      power.setOptIn(true);
      power.sync({ state: "BUILDING", batteryPercent: 90 });
      const id = blocker.stops.length;
      power.sync({ state, batteryPercent: 90 });
      expect(blocker.stops).toHaveLength(id + 1);
      expect(power.isActive()).toBe(false);
      expect(power.lastReleaseReason()).toBe(`state:${state}`);
    }

    const low = new OptionalPowerSaveBlocker(new MemoryPowerSaveBlocker());
    const host = new MemoryPowerSaveBlocker();
    const battery = new OptionalPowerSaveBlocker(host);
    battery.setOptIn(true);
    battery.sync({ state: "BUILDING", batteryPercent: 20 });
    expect(battery.isActive()).toBe(true);
    battery.sync({ state: "BUILDING", batteryPercent: 19 });
    expect(battery.isActive()).toBe(false);
    expect(battery.lastReleaseReason()).toBe("low-battery");
    expect(host.stops).toHaveLength(1);
    battery.sync({ state: "BUILDING", batteryPercent: 50 });
    expect(battery.isActive()).toBe(true);
    expect(low.isOptedIn()).toBe(false);
  });

  it("does not arm for verification or merge queue, and the coordinator wires the build header toggle", () => {
    const verifying = new OptionalPowerSaveBlocker(new MemoryPowerSaveBlocker());
    verifying.setOptIn(true);
    verifying.sync({ state: "VERIFYING", batteryPercent: 100 });
    verifying.sync({ state: "MERGE_QUEUE", batteryPercent: 100 });
    verifying.sync({ state: "IDLE", batteryPercent: null });
    expect(verifying.isActive()).toBe(false);

    const harness = createHarness(building());
    expect(harness.blocker.starts).toHaveLength(0);
    harness.coordinator.setPreventSleepDuringActiveBuild(true);
    expect(harness.blocker.starts).toEqual(["prevent-app-suspension"]);
    harness.coordinator.setActivity(building({ state: "WAITING_ON_USER", activeWorkers: 0 }));
    expect(harness.blocker.stops).toHaveLength(1);
    harness.coordinator.setActivity(building({ batteryPercent: 10 }));
    expect(harness.coordinator.blocker.isActive()).toBe(false);
  });
});
