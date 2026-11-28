import { describe, expect, it } from "vitest";
import { HEALTHY_ENVIRONMENT } from "../../src/lifecycle/index.js";
import { building, createHarness } from "./support.js";

const FOUR_HOURS = 4 * 60 * 60 * 1000;
const TWO_HOURS = 2 * 60 * 60 * 1000;

describe("PowerMonitorSleepReconciler", () => {
  it("pauses claiming and stuck clocks on suspend", async () => {
    const harness = createHarness(building());
    harness.clocks.register("worker-a", 60_000);
    const suspended = await harness.coordinator.power.onSuspend();
    expect(harness.claims.paused).toBe(true);
    expect(harness.claims.history[0]).toBe("pause:suspend");
    expect(harness.checkpoints.reasons).toContain("suspend");
    expect(harness.clocks.paused).toBe(true);
    expect(harness.clocks.pausedAt).toBe(suspended.suspendedAt);
    expect(harness.daemon.power[0]).toEqual({ type: "suspend", at: suspended.suspendedAt });
  });

  it("compensates a 4 hour offline sleep without false stuck alarms or burned retries", async () => {
    const harness = createHarness(building());
    harness.clocks.register("worker-a", 60_000);
    await harness.coordinator.power.onSuspend();
    harness.clock.advance(FOUR_HOURS);
    harness.probe.setHealth({ ...HEALTHY_ENVIRONMENT, networkOnline: false });
    const outcome = await harness.coordinator.power.onResume();
    expect(outcome.sleepDurationMs).toBe(FOUR_HOURS);
    expect(outcome.band).toBe("over_30_min");
    expect(outcome.holdWelcomeBack).toBe(true);
    expect(outcome.message).toBe("Paused while laptop slept (4h) · Offline — Resume when back online");
    expect(outcome.falseStuckAlarms).toBe(0);
    expect(outcome.burnedRetries).toBe(0);
    expect(outcome.spuriousLeaseExpiries).toBe(0);
    expect(outcome.addedStuckMs).toBe(0);
    expect(outcome.reconcileCalled).toBe(true);
    expect(harness.clocks.activeMs("worker-a")).toBe(60_000);
    expect(harness.clocks.lastIgnoredSleepMs).toBe(FOUR_HOURS);
    expect(harness.clocks.stuckLabel("worker-a", 30 * 60 * 1000)).toBeNull();
    expect(harness.clocks.stuckLabel("worker-a", 30 * 60 * 1000)).not.toBe("Stuck for 120m");
    expect(harness.retries.burned()).toBe(0);
    expect(harness.leases.spuriousLeaseExpiries).toBe(0);
    expect(harness.leases.expirySweeperSuspended).toBe(true);
    expect(harness.coldOpen.calls[0]).toMatchObject({
      reopen: "wake",
      sleepMinutes: FOUR_HOURS / 60_000,
      offline: true,
      repoChanged: false,
    });
    expect(harness.claims.paused).toBe(true);
    expect(harness.daemon.power.at(-1)).toMatchObject({
      type: "resume",
      sleepDurationMs: FOUR_HOURS,
      resumeClaiming: false,
    });
  });

  it("does not count a 2 hour sleep toward stuck clocks", async () => {
    const harness = createHarness(building());
    harness.clocks.register("worker-b", 5 * 60 * 1000);
    await harness.coordinator.power.onSuspend();
    harness.clock.advance(TWO_HOURS);
    const outcome = await harness.coordinator.power.onResume();
    expect(outcome.falseStuckAlarms).toBe(0);
    expect(harness.clocks.stuckLabel("worker-b", 30 * 60 * 1000)).toBeNull();
    expect(harness.clocks.activeMs("worker-b")).toBe(5 * 60 * 1000);
  });

  it("resumes a short healthy sleep and holds when sleep exceeds 30 minutes", async () => {
    const short = createHarness(building());
    await short.coordinator.power.onSuspend();
    short.clock.advance(5 * 60 * 1000);
    const quick = await short.coordinator.power.onResume();
    expect(quick.band).toBe("under_10_min");
    expect(quick.holdWelcomeBack).toBe(false);
    expect(short.claims.paused).toBe(false);
    expect(short.coldOpen.calls).toHaveLength(1);

    const boundary = createHarness(building());
    await boundary.coordinator.power.onSuspend();
    boundary.clock.advance(30 * 60 * 1000);
    const exact = await boundary.coordinator.power.onResume();
    expect(exact.band).toBe("between_10_and_30_min");
    expect(exact.holdWelcomeBack).toBe(false);

    const longer = createHarness(building());
    await longer.coordinator.power.onSuspend();
    longer.clock.advance(30 * 60 * 1000 + 1);
    const held = await longer.coordinator.power.onResume();
    expect(held.band).toBe("over_30_min");
    expect(held.holdWelcomeBack).toBe(true);
    expect(held.message).toBe("Paused while laptop slept (30m) · Welcome back");
  });

  it("holds when the repo changed even after a short sleep", async () => {
    const harness = createHarness(building());
    await harness.coordinator.power.onSuspend();
    harness.clock.advance(60_000);
    harness.probe.setHealth({ ...HEALTHY_ENVIRONMENT, repoChanged: true });
    const outcome = await harness.coordinator.power.onResume();
    expect(outcome.holdWelcomeBack).toBe(true);
    expect(outcome.message).toBe(
      "Paused while laptop slept (1m) · Repository changed — Review before resume",
    );
  });

  it("flushes checkpoints, PASSIVE then TRUNCATE, and leaves zero orphaned processes on shutdown", async () => {
    const harness = createHarness(building());
    harness.jobs.setChildren([41, 42]);
    const flushed = await harness.coordinator.power.onShutdown();
    expect(harness.checkpoints.reasons).toContain("os-shutdown");
    expect(harness.sqlite.modes).toEqual(["PASSIVE", "TRUNCATE"]);
    expect(flushed.walModes).toEqual(["PASSIVE", "TRUNCATE"]);
    expect(flushed.orphanedProcesses).toBe(0);
    expect(flushed.stateDbIntact).toBe(true);
    expect(flushed.checkpointsFlushed).toBe(true);
    expect(harness.jobs.activeChildPids()).toEqual([]);
    expect(harness.jobs.terminations).toEqual(["os-shutdown"]);
    expect(harness.daemon.power.at(-1)).toMatchObject({ type: "shutdown" });
  });

  it("records lock without pausing stuck clocks and emits eco battery telemetry", async () => {
    const harness = createHarness(building());
    harness.clocks.register("worker-a", 1_000);
    await harness.coordinator.power.onLock();
    expect(harness.coordinator.power.isLocked).toBe(true);
    expect(harness.clocks.paused).toBe(false);
    expect(harness.daemon.power.at(-1)).toMatchObject({ type: "lock-screen" });
    await harness.coordinator.power.onUnlock();
    expect(harness.coordinator.power.isLocked).toBe(false);

    harness.coordinator.setEcoOnBattery(true);
    await harness.coordinator.power.onBattery(42);
    expect(harness.governor.events.at(-1)).toEqual({
      source: "battery",
      batteryPercent: 42,
      ecoOnBattery: true,
      ecoCap: "eco",
    });
    await harness.coordinator.power.onAc();
    expect(harness.governor.events.at(-1)).toMatchObject({ source: "ac", ecoOnBattery: false });
  });
});
