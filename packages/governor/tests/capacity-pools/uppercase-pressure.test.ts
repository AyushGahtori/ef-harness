import { describe, expect, it } from "vitest";
import { DiskHeadroomGuard } from "../../src/admission/disk-headroom-guard.js";
import { GpuWhisperPriorityArbiter } from "../../src/admission/gpu-whisper-priority-arbiter.js";
import { HeavyLaneSemaphore } from "../../src/admission/heavy-lane-semaphore.js";
import { PressureHysteresisStateMachine } from "../../src/admission/pressure-hysteresis-state-machine.js";
import { SyntheticTelemetryProvider } from "../../src/admission/ports/synthetic-telemetry-provider.js";
import { applyGovernorPressure } from "../../src/chain.js";
import { ThreePoolCapacityScheduler } from "../../src/capacity-pools/scheduler.js";
import { laptopSnapshot } from "../admission/laptop.js";

const green = laptopSnapshot({ availPhysMb: 10 * 1024 });
const yellow = laptopSnapshot({ availPhysMb: 1_843 });
const orange = laptopSnapshot({ availPhysMb: 800 });
const red = laptopSnapshot({ lowMemoryNotification: true, availPhysMb: 10 * 1024 });

describe("uppercase governor pressure crosses hysteresis into the three pools", () => {
  it("feeds GREEN, YELLOW, ORANGE, and RED without a casing error", async () => {
    const machine = new PressureHysteresisStateMachine(new SyntheticTelemetryProvider());
    const seen: string[] = [];
    machine.subscribe((level) => {
      seen.push(level);
    });
    const scheduler = await ThreePoolCapacityScheduler.create({ totalRamGb: 16, pressure: "Green" });
    const heavyLane = new HeavyLaneSemaphore(16 * 1024);
    const disk = new DiskHeadroomGuard();
    const whisper = new GpuWhisperPriorityArbiter(8_192);
    expect(scheduler.currentPressure()).toBe("GREEN");

    const feed = (nowMs: number, snapshot: typeof green) =>
      applyGovernorPressure({ machine, scheduler, heavyLane, disk, whisper, nowMs, snapshot });

    expect(feed(0, green).pressure).toBe("GREEN");
    expect(feed(0, yellow).pressure).toBe("GREEN");
    const enteredYellow = feed(10_000, yellow);
    expect(enteredYellow.pressure).toBe("YELLOW");
    expect(enteredYellow.executionTarget).toBe(1);
    expect(feed(10_000, orange).pressure).toBe("YELLOW");
    const enteredOrange = feed(20_000, orange);
    expect(enteredOrange.pressure).toBe("ORANGE");
    expect(enteredOrange.executionTarget).toBe(1);
    const enteredRed = feed(20_000, red);
    expect(enteredRed.pressure).toBe("RED");
    expect(enteredRed.executionTarget).toBe(0);
    expect(enteredRed.actions.haltNewExecutionLaunches).toBe(true);
    expect(heavyLane.permitCap).toBe(0);
    expect(scheduler.currentPressure()).toBe("RED");
    expect(seen).toEqual(["YELLOW", "ORANGE", "RED"]);
    expect(() => scheduler.setPressure("ORANGE")).not.toThrow();
    expect(scheduler.currentPressure()).toBe("ORANGE");
  });
});
