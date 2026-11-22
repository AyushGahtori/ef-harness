import { describe, expect, it } from "vitest";
import {
  AGING_WINDOW_MS,
  MAX_WAIT_BOOST,
  THINKING_RAM_MB,
  executionPriorityScore,
  ramClassDefaults,
  workerAgingBoost,
} from "../../src/capacity-pools/index.js";
import { admit, createHarness, runRequest } from "./support.js";

describe("capacity defaults and thinking pool", () => {
  it("sizes the three pools from RAM class", () => {
    expect(ramClassDefaults(16)).toMatchObject({
      thinkingCap: 12,
      executionCap: 2,
      sessionProcessCap: 4,
    });
    expect(ramClassDefaults(24)).toMatchObject({
      thinkingCap: 16,
      executionCap: 2,
      sessionProcessCap: 4,
    });
    expect(ramClassDefaults(32)).toMatchObject({
      thinkingCap: 20,
      executionCap: 3,
      sessionProcessCap: 8,
    });
    expect(ramClassDefaults(64)).toMatchObject({
      thinkingCap: 20,
      executionCap: 4,
      sessionProcessCap: 8,
    });
  });

  it("caps worker aging at 60s and only then outranks a fresh verifier", () => {
    expect(workerAgingBoost(0)).toBe(0);
    expect(workerAgingBoost(AGING_WINDOW_MS)).toBe(MAX_WAIT_BOOST);
    expect(workerAgingBoost(75_000)).toBe(MAX_WAIT_BOOST);
    const verifier = executionPriorityScore({ role: "verifier", waitedMs: 0, criticalPath: false });
    const before = executionPriorityScore({ role: "worker", waitedMs: 59_999, criticalPath: false });
    const atCap = executionPriorityScore({ role: "worker", waitedMs: 60_000, criticalPath: false });
    const later = executionPriorityScore({ role: "worker", waitedMs: 75_000, criticalPath: false });
    expect(before).toBe(verifier);
    expect(atCap).toBeGreaterThan(verifier);
    expect(later).toBe(atCap);
    expect(later).toBeGreaterThan(before);
  });

  it("admits a wide thinking pool without provisioning one sandbox per agent", async () => {
    const { scheduler, backend } = await createHarness({ totalRamGb: 32 });
    expect(scheduler.hardwarePoolCap()).toBe(3);
    expect(scheduler.thinkingCap()).toBe(20);
    expect(backend.provisionCount).toBe(3);
    const ids = Array.from({ length: 12 }, (_, index) => `think-${index + 1}`);
    await admit(scheduler, ids);
    const snapshot = scheduler.snapshot();
    expect(snapshot.thinkingCount).toBe(12);
    expect(snapshot.runningSlotCount).toBe(0);
    expect(snapshot.waitingForRunSlotCount).toBe(0);
    expect(backend.provisionCount).toBe(3);
    expect(scheduler.thinking.profile(ids[0] ?? "think-1").ramMb).toBe(THINKING_RAM_MB);
    expect(THINKING_RAM_MB).toBeLessThan(10);
    expect(scheduler.thinking.profile(ids[0] ?? "think-1").cpuWhileWaiting).toBe(0);
    expect(scheduler.thinking.estimatedRamMb()).toBe(12 * THINKING_RAM_MB);
  });

  it("bounds thinking by provider pacing and DAG width, not by the execution pool", async () => {
    const paced = await createHarness({
      totalRamGb: 32,
      providerPacingCap: 8,
      dagDisjointWidth: 20,
    });
    expect(paced.scheduler.thinkingCap()).toBe(8);
    expect(paced.scheduler.hardwarePoolCap()).toBe(3);

    const chain = await createHarness({ totalRamGb: 32, dagDisjointWidth: 1 });
    expect(chain.scheduler.thinkingCap()).toBe(1);
    expect(chain.scheduler.executionTarget()).toBe(3);
  });

  it("queues a thinking admission past the cap and frees it on abort", async () => {
    const { scheduler } = await createHarness({ totalRamGb: 16, providerPacingCap: 1 });
    expect(scheduler.thinkingCap()).toBe(1);
    await scheduler.admitThinking("only");
    const controller = new AbortController();
    const waiting = scheduler.admitThinking("extra", controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(scheduler.thinking.has("extra")).toBe(false);
    expect(scheduler.thinking.occupancy()).toBe(1);
    scheduler.releaseThinking("only");
    await scheduler.admitThinking("next");
    expect(scheduler.thinking.has("next")).toBe(true);
  });

  it("shrinks the live execution target with pressure and disk headroom without changing warm inventory", async () => {
    const laptop = await createHarness({ totalRamGb: 16 });
    expect(laptop.scheduler.executionTarget()).toBe(2);
    laptop.scheduler.setPressure("Yellow");
    expect(laptop.scheduler.executionTarget()).toBe(1);
    laptop.scheduler.setPressure("Orange");
    expect(laptop.scheduler.executionTarget()).toBe(1);
    laptop.scheduler.setPressure("Red");
    expect(laptop.scheduler.executionTarget()).toBe(0);
    laptop.scheduler.setPressure("Green");
    laptop.scheduler.setDiskFreeGb(1.5);
    expect(laptop.scheduler.executionTarget()).toBe(0);
    laptop.scheduler.setDiskFreeGb(2);
    laptop.scheduler.setPressure("Orange");
    expect(laptop.scheduler.executionTarget()).toBe(1);

    const desktop = await createHarness({ totalRamGb: 64 });
    expect(desktop.scheduler.snapshot().warmExecutionSlots).toBe(4);
    expect(desktop.scheduler.executionTarget()).toBe(4);
    desktop.scheduler.setPressure("Yellow");
    expect(desktop.scheduler.executionTarget()).toBe(3);
    desktop.scheduler.setPressure("Orange");
    expect(desktop.scheduler.executionTarget()).toBe(1);
    expect(desktop.scheduler.snapshot().warmExecutionSlots).toBe(4);
  });

  it("reports the board fields for a thinking agent that is not yet running", async () => {
    const { scheduler } = await createHarness();
    await admit(scheduler, ["board"]);
    const snapshot = scheduler.snapshot();
    expect(snapshot.thinkingCount).toBe(1);
    expect(snapshot.waitingForRunSlotCount).toBe(0);
    expect(snapshot.runningSlotCount).toBe(0);
    expect(snapshot.slotOwnerTaskIds).toEqual([]);
    expect(runRequest({ taskId: "board" }).command).toBe("pnpm test");
  });
});
