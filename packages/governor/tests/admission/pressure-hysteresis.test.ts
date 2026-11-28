import { afterEach, describe, expect, it, vi } from "vitest";
import { DiskHeadroomGuard } from "../../src/admission/disk-headroom-guard.js";
import { PressureHysteresisStateMachine } from "../../src/admission/pressure-hysteresis-state-machine.js";
import { SyntheticTelemetryProvider } from "../../src/admission/ports/synthetic-telemetry-provider.js";
import {
  EMERGENCY_ENTER_MS,
  ENTER_WORSE_MS,
  GiB,
  RECOVER_BETTER_MS,
} from "../../src/admission/thresholds.js";
import { laptopSnapshot } from "./laptop.js";

const orangeRam = laptopSnapshot({ availPhysMb: 800 });
const greenRam = laptopSnapshot({ availPhysMb: 10 * 1024 });
const yellowRam = laptopSnapshot({ availPhysMb: 1_843 });
const redRam = laptopSnapshot({ availPhysMb: 400 });

describe("pressure hysteresis", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pins the 10s enter, 30s recover, and 0s emergency timers", () => {
    expect(ENTER_WORSE_MS).toBe(10_000);
    expect(RECOVER_BETTER_MS).toBe(30_000);
    expect(EMERGENCY_ENTER_MS).toBe(0);
  });

  it("enters ORANGE only after a sustained 10s breach and can skip YELLOW", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const machine = new PressureHysteresisStateMachine(new SyntheticTelemetryProvider(), {
      baseWarmSlots: 2,
    });
    machine.observe(Date.now(), orangeRam);
    vi.setSystemTime(9_999);
    expect(machine.observe(Date.now(), orangeRam)).toBeNull();
    expect(machine.pressure).toBe("GREEN");
    vi.setSystemTime(10_000);
    const shift = machine.observe(Date.now(), orangeRam);
    expect(machine.pressure).toBe("ORANGE");
    expect(shift?.from).toBe("GREEN");
    expect(shift?.to).toBe("ORANGE");
    expect(shift?.elapsedMs).toBe(10_000);
    expect(shift?.emergency).toBe(false);
    expect(shift?.orangeEntered).toBe(true);
    expect(shift?.eventNames).toEqual(["governor.orange_entered"]);
    expect(shift?.actions.warmExecutionSlotCap).toBe(1);
    expect(shift?.actions.officeToBoardFallback).toBe(true);
    expect(shift?.actions.officeAnimationsEnabled).toBe(false);
    expect(shift?.actions.pauseBackgroundTasks).toBe(true);
    expect(shift?.actions.waitBeforeHeavyJobs).toBe(true);
    expect(shift?.actions.haltNewExecutionLaunches).toBe(false);
    expect(machine.events).toHaveLength(1);
  });

  it("absorbs a 3 second RAM spike with zero flapping transitions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const provider = new SyntheticTelemetryProvider();
    provider.setFrom(0, orangeRam);
    provider.setFrom(3_000, greenRam);
    const machine = new PressureHysteresisStateMachine(provider);
    const seen: string[] = [];
    machine.subscribe({
      onPressureShift(event) {
        seen.push(event.to);
      },
    });
    machine.start(1_000);
    vi.advanceTimersByTime(3_000);
    expect(machine.pressure).toBe("GREEN");
    vi.advanceTimersByTime(20_000);
    expect(machine.pressure).toBe("GREEN");
    expect(machine.events).toHaveLength(0);
    expect(seen).toEqual([]);
    expect(machine.actions.officeAnimationsEnabled).toBe(true);
    expect(machine.actions.warmExecutionSlotCap).toBe(2);
    machine.stop();
  });

  it("stays ORANGE when headroom returns for only 15s and then dips again", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const provider = new SyntheticTelemetryProvider();
    provider.setFrom(0, orangeRam);
    const machine = new PressureHysteresisStateMachine(provider);
    machine.start(1_000);
    vi.advanceTimersByTime(12_000);
    expect(machine.pressure).toBe("ORANGE");
    expect(machine.events.map((event) => `${event.from}->${event.to}`)).toEqual(["GREEN->ORANGE"]);
    provider.setFrom(12_000, greenRam);
    vi.advanceTimersByTime(15_000);
    expect(machine.pressure).toBe("ORANGE");
    provider.setFrom(27_000, orangeRam);
    vi.advanceTimersByTime(12_000);
    expect(machine.pressure).toBe("ORANGE");
    expect(machine.events).toHaveLength(1);
    machine.stop();
  });

  it("recovers only after 30s of clean headroom", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const machine = new PressureHysteresisStateMachine(new SyntheticTelemetryProvider());
    machine.observe(0, orangeRam);
    machine.observe(10_000, orangeRam);
    expect(machine.pressure).toBe("ORANGE");
    machine.observe(10_000, greenRam);
    vi.setSystemTime(39_999);
    expect(machine.observe(Date.now(), greenRam)?.to).toBeUndefined();
    expect(machine.pressure).toBe("ORANGE");
    vi.setSystemTime(40_000);
    const recovered = machine.observe(Date.now(), greenRam);
    expect(recovered?.to).toBe("GREEN");
    expect(recovered?.elapsedMs).toBe(30_000);
    expect(recovered?.primaryDriver).toBe("Headroom recovered");
    expect(machine.actions.backgroundIndexingEnabled).toBe(true);
  });

  it("jumps to RED in 0s on LowMemoryResourceNotification", () => {
    vi.useFakeTimers();
    vi.setSystemTime(4_000);
    const machine = new PressureHysteresisStateMachine(new SyntheticTelemetryProvider());
    machine.observe(0, greenRam);
    const shift = machine.observe(
      Date.now(),
      laptopSnapshot({ lowMemoryNotification: true, availPhysMb: 10 * 1024 }),
    );
    expect(machine.pressure).toBe("RED");
    expect(shift?.elapsedMs).toBe(EMERGENCY_ENTER_MS);
    expect(shift?.emergency).toBe(true);
    expect(shift?.atMs).toBe(4_000);
    expect(shift?.primaryDriver).toBe("Windows low-memory notification");
    expect(shift?.actions.haltNewExecutionLaunches).toBe(true);
    expect(shift?.actions.pauseNonEssentialLocalModels).toBe(true);
    expect(shift?.actions.preserveDbAndWorktreeIntegrity).toBe(true);
    expect(shift?.actions.showHardwarePressureCard).toBe(true);
    expect(shift?.actions.warmExecutionSlotCap).toBe(0);
    expect(shift?.card?.ram).toContain("GB free");
    expect(shift?.card?.disk).toContain("C:");
    expect(shift?.card?.gpu).toContain("VRAM");
    expect(shift?.orangeEntered).toBe(false);
  });

  it("jumps to RED in 0s when a drive drops under 2 GB", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_500);
    const machine = new PressureHysteresisStateMachine(new SyntheticTelemetryProvider());
    const shift = machine.observe(
      Date.now(),
      laptopSnapshot({
        appDataDisk: { letter: "C:", freeBytes: 1.8 * GiB, totalBytes: 256 * GiB },
      }),
    );
    expect(machine.pressure).toBe("RED");
    expect(shift?.elapsedMs).toBe(0);
    expect(shift?.primaryDriver).toBe("Disk C: < 2 GB");
    expect(shift?.card?.headline).toBe("Disk C: < 2 GB");
  });

  it("does not treat a sub-4% RAM reading as an instant emergency", () => {
    vi.useFakeTimers();
    const machine = new PressureHysteresisStateMachine(new SyntheticTelemetryProvider());
    machine.observe(0, redRam);
    expect(machine.observe(3_000, redRam)).toBeNull();
    expect(machine.pressure).toBe("GREEN");
    expect(machine.observe(10_000, redRam)?.to).toBe("RED");
    expect(machine.events[0]?.emergency).toBe(false);
    expect(machine.events[0]?.elapsedMs).toBe(10_000);
  });

  it("names RAM, Defender, UI latency, disk, and commit as the primary driver", () => {
    const machine = new PressureHysteresisStateMachine(new SyntheticTelemetryProvider(), {
      baseWarmSlots: 4,
    });
    machine.observe(0, yellowRam);
    const yellow = machine.observe(10_000, yellowRam);
    expect(yellow?.to).toBe("YELLOW");
    expect(yellow?.primaryDriver).toBe("RAM low (1.8 GB free)");
    expect(yellow?.actions.warmExecutionSlotCap).toBe(3);
    expect(yellow?.actions.deferBackgroundIndexing).toBe(true);
    expect(yellow?.actions.deferBackgroundGc).toBe(true);
    expect(yellow?.actions.deferNonCriticalPrewarm).toBe(true);
    expect(yellow?.actions.officeAnimationsEnabled).toBe(true);
    expect(yellow?.actions.haltNewExecutionLaunches).toBe(false);

    const defender = new PressureHysteresisStateMachine(new SyntheticTelemetryProvider());
    const defenderSnap = laptopSnapshot({ defenderCpuRatio: 0.45, avContentionActive: true });
    defender.observe(0, defenderSnap);
    expect(defender.observe(10_000, defenderSnap)?.primaryDriver).toBe("Windows Defender scanning");

    const ui = new PressureHysteresisStateMachine(new SyntheticTelemetryProvider());
    const uiSnap = laptopSnapshot({ uiLatencyMs: 60 });
    ui.observe(0, uiSnap);
    expect(ui.observe(10_000, uiSnap)?.primaryDriver).toBe("UI latency > 50 ms");

    const hidden = new PressureHysteresisStateMachine(new SyntheticTelemetryProvider());
    const hiddenSnap = laptopSnapshot({ uiLatencyMs: 500, uiSampleValid: false });
    hidden.observe(0, hiddenSnap);
    expect(hidden.observe(10_000, hiddenSnap)).toBeNull();
    expect(hidden.pressure).toBe("GREEN");

    const disk = new PressureHysteresisStateMachine(new SyntheticTelemetryProvider());
    const diskSnap = laptopSnapshot({
      appDataDisk: { letter: "C:", freeBytes: 4 * GiB, totalBytes: 256 * GiB },
    });
    disk.observe(0, diskSnap);
    const diskShift = disk.observe(10_000, diskSnap);
    expect(diskShift?.to).toBe("ORANGE");
    expect(diskShift?.primaryDriver).toBe("Disk C: < 5 GB");

    const commit = new PressureHysteresisStateMachine(new SyntheticTelemetryProvider());
    const commitSnap = laptopSnapshot({ totalCommitMb: 1_000, availCommitMb: 40 });
    commit.observe(0, commitSnap);
    expect(commit.observe(3_000, commitSnap)).toBeNull();
    expect(commit.observe(10_000, commitSnap)?.primaryDriver).toBe("Commit charge > 95%");
    expect(commit.pressure).toBe("RED");
  });

  it("rechecks disk pressure immediately when the operator asks", () => {
    const machine = new PressureHysteresisStateMachine(new SyntheticTelemetryProvider());
    const tight = laptopSnapshot({
      appDataDisk: { letter: "C:", freeBytes: 4 * GiB, totalBytes: 256 * GiB },
    });
    machine.observe(0, tight);
    machine.observe(10_000, tight);
    expect(machine.pressure).toBe("ORANGE");
    const cleared = machine.recheck(10_500, greenRam);
    expect(cleared?.to).toBe("GREEN");
    expect(cleared?.elapsedMs).toBe(0);
    expect(machine.pressure).toBe("GREEN");
  });

  it("does not emit governor.orange_entered while recovering out of RED", () => {
    const machine = new PressureHysteresisStateMachine(new SyntheticTelemetryProvider());
    const low = laptopSnapshot({ lowMemoryNotification: true });
    machine.observe(0, low);
    expect(machine.pressure).toBe("RED");
    const band = laptopSnapshot({ availPhysMb: Math.round(0.1 * 16 * 1024) });
    const shift = machine.recheck(1_000, band);
    expect(shift?.to).toBe("ORANGE");
    expect(shift?.orangeEntered).toBe(false);
    expect(shift?.eventNames).toEqual([]);
  });
});

describe("disk guard agrees with the pressure clock", () => {
  it("reaches PAUSE and RED on the same timestamps as the pressure machine", () => {
    const guard = new DiskHeadroomGuard();
    const machine = new PressureHysteresisStateMachine(new SyntheticTelemetryProvider());
    const pause = {
      project: { letter: "D:", freeBytes: 40 * GiB, totalBytes: 100 * GiB },
      appData: { letter: "C:", freeBytes: 4 * GiB, totalBytes: 100 * GiB },
    };
    const snap = laptopSnapshot({
      projectDisk: pause.project,
      appDataDisk: pause.appData,
    });
    guard.observe({ ...pause, nowMs: 0 });
    machine.observe(0, snap);
    expect(guard.view().appData.tier).toBe("OK");
    expect(machine.pressure).toBe("GREEN");
    guard.observe({ ...pause, nowMs: 10_000 });
    machine.observe(10_000, snap);
    expect(guard.view().appData.tier).toBe("PAUSE");
    expect(machine.pressure).toBe("ORANGE");

    const emergency = laptopSnapshot({
      projectDisk: { letter: "D:", freeBytes: 1.5 * GiB, totalBytes: 100 * GiB },
    });
    const jumped = machine.observe(10_500, emergency);
    const disk = guard.observe({
      project: emergency.projectDisk,
      appData: emergency.appDataDisk,
      nowMs: 10_500,
    });
    expect(jumped?.to).toBe("RED");
    expect(jumped?.elapsedMs).toBe(0);
    expect(disk.project.tier).toBe("EMERGENCY");
    expect(disk.maintenance.pauseAllRunningWriters).toBe(true);
  });
});
