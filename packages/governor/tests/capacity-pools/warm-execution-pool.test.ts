import { describe, expect, it } from "vitest";
import {
  AbortError,
  ExecutionTimeoutError,
  SandboxHoldError,
  WAITING_FOR_RUN_SLOT,
} from "../../src/capacity-pools/index.js";
import type { ExecutionLease } from "../../src/capacity-pools/index.js";
import { admit, createHarness, deferred, runRequest, until } from "./support.js";

describe("warm execution pool", () => {
  it("runs exactly two of twelve simultaneous pnpm test calls on a 16 GB laptop", async () => {
    const { scheduler, clock, backend } = await createHarness({ totalRamGb: 16 });
    const ids = Array.from({ length: 12 }, (_, index) => `worker-${index + 1}`);
    await admit(scheduler, ids);
    const controllers = ids.map(() => new AbortController());
    const pending = ids.map((taskId, index) => {
      const controller = controllers[index];
      if (!controller) throw new Error("missing controller");
      return scheduler.acquireExecution(
        runRequest({ taskId, timeoutMs: 1_000, signal: controller.signal }),
      );
    });

    const queued = scheduler.snapshot();
    expect(queued.runningSlotCount).toBe(2);
    expect(queued.waitingForRunSlotCount).toBe(10);
    expect(queued.slotOwnerTaskIds).toEqual(["worker-1", "worker-2"]);
    expect(queued.waiterStatuses).toHaveLength(10);
    expect(queued.waiterStatuses.every((waiter) => waiter.status === WAITING_FOR_RUN_SLOT)).toBe(true);
    expect(backend.provisionCount).toBe(2);

    clock.advance(5_000);
    expect(scheduler.snapshot().waitingForRunSlotCount).toBe(10);
    expect(scheduler.snapshot().runningSlotCount).toBe(2);

    const first = await pending[0];
    const second = await pending[1];
    if (!first || !second) throw new Error("the first two leases did not grant");
    scheduler.releaseExecution(first.leaseId, "finish");
    const third = await pending[2];
    if (!third) throw new Error("the third lease did not grant");
    expect(third.taskId).toBe("worker-3");
    expect(third.queuedMs).toBe(5_000);
    expect(third.timeoutMs).toBe(1_000);
    expect(third.deadlineAt - third.acquiredAt).toBe(1_000);

    for (let index = 3; index < controllers.length; index += 1) controllers[index]?.abort();
    scheduler.releaseExecution(second.leaseId, "finish");
    scheduler.releaseExecution(third.leaseId, "finish");
    await Promise.allSettled(pending);
    expect(scheduler.snapshot().runningSlotCount).toBe(0);
    expect(scheduler.snapshot().slotOwnerTaskIds).toEqual([]);
  });

  it("puts verifiers ahead of six queued workers", async () => {
    const { scheduler } = await createHarness({ totalRamGb: 16 });
    const workers = ["w1", "w2", "w3", "w4", "w5", "w6"];
    const blockers = ["b1", "b2"];
    const verifiers = ["v1", "v2"];
    await admit(scheduler, [...blockers, ...workers, ...verifiers]);
    const held: ExecutionLease[] = [];
    for (const taskId of blockers) {
      held.push(await scheduler.acquireExecution(runRequest({ taskId })));
    }
    const workerLeases = workers.map((taskId) => scheduler.acquireExecution(runRequest({ taskId })));
    const verifierLeases = verifiers.map((taskId) =>
      scheduler.acquireExecution(runRequest({ taskId, role: "verifier", command: "pnpm test" })),
    );
    expect(scheduler.snapshot().waitingForRunSlotCount).toBe(8);

    const firstHeld = held[0];
    const secondHeld = held[1];
    if (!firstHeld || !secondHeld) throw new Error("blockers were not leased");
    scheduler.releaseExecution(firstHeld.leaseId, "finish");
    scheduler.releaseExecution(secondHeld.leaseId, "finish");
    const granted = await Promise.all(verifierLeases);
    expect(granted.map((lease) => lease.taskId)).toEqual(["v1", "v2"]);
    expect(scheduler.snapshot().slotOwnerTaskIds).toEqual(["v1", "v2"]);
    expect(scheduler.snapshot().waitingForRunSlotCount).toBe(6);

    for (const lease of granted) scheduler.releaseExecution(lease.leaseId, "stop");
    await Promise.allSettled(workerLeases.map((lease) => lease.then((value) => {
      scheduler.releaseExecution(value.leaseId, "stop");
    })));
  });

  it("gives a worker the next slot after 75s of verifier bursts", async () => {
    const { scheduler, clock } = await createHarness({ totalRamGb: 16, pressure: "Orange" });
    expect(scheduler.executionTarget()).toBe(1);
    await admit(scheduler, ["blocker", "worker", "v1", "v2", "v3", "v4", "v5"]);
    const blocker = await scheduler.acquireExecution(runRequest({ taskId: "blocker", role: "verifier" }));
    const worker = scheduler.acquireExecution(runRequest({ taskId: "worker" }));
    clock.advance(70_000);
    const verifiers = ["v1", "v2", "v3", "v4", "v5"].map((taskId) =>
      scheduler.acquireExecution(runRequest({ taskId, role: "verifier" })),
    );
    clock.advance(5_000);
    expect(scheduler.snapshot().waitingForRunSlotCount).toBe(6);
    scheduler.releaseExecution(blocker.leaseId, "finish");
    const next = await worker;
    expect(next.taskId).toBe("worker");
    expect(next.queuedMs).toBe(75_000);
    scheduler.releaseExecution(next.leaseId, "finish");
    for (const pending of verifiers) {
      const lease = await pending;
      scheduler.releaseExecution(lease.leaseId, "finish");
    }
  });

  it("still prefers a verifier when the worker has waited just under 60s", async () => {
    const { scheduler, clock } = await createHarness({ totalRamGb: 16, pressure: "Orange" });
    await admit(scheduler, ["blocker", "worker", "verifier"]);
    const blocker = await scheduler.acquireExecution(runRequest({ taskId: "blocker", role: "verifier" }));
    const worker = scheduler.acquireExecution(runRequest({ taskId: "worker" }));
    clock.advance(59_999);
    const verifier = scheduler.acquireExecution(runRequest({ taskId: "verifier", role: "verifier" }));
    scheduler.releaseExecution(blocker.leaseId, "finish");
    const next = await verifier;
    expect(next.taskId).toBe("verifier");
    scheduler.releaseExecution(next.leaseId, "finish");
    const aged = await worker;
    expect(aged.taskId).toBe("worker");
    scheduler.releaseExecution(aged.leaseId, "finish");
  });

  it("prefers a critical-path worker over an older ordinary worker", async () => {
    const { scheduler } = await createHarness({ totalRamGb: 16, pressure: "Orange" });
    await admit(scheduler, ["blocker", "ordinary", "critical"]);
    const blocker = await scheduler.acquireExecution(runRequest({ taskId: "blocker" }));
    const ordinary = scheduler.acquireExecution(runRequest({ taskId: "ordinary" }));
    const critical = scheduler.acquireExecution(runRequest({ taskId: "critical", criticalPath: true }));
    scheduler.releaseExecution(blocker.leaseId, "finish");
    const next = await critical;
    expect(next.taskId).toBe("critical");
    expect(next.criticalPath).toBe(true);
    scheduler.releaseExecution(next.leaseId, "finish");
    const rest = await ordinary;
    scheduler.releaseExecution(rest.leaseId, "finish");
  });

  it("orders verifier ahead of worker ahead of background", async () => {
    const { scheduler } = await createHarness({ totalRamGb: 16, pressure: "Orange" });
    await admit(scheduler, ["blocker", "background", "worker", "verifier"]);
    const blocker = await scheduler.acquireExecution(runRequest({ taskId: "blocker" }));
    const background = scheduler.acquireExecution(
      runRequest({ taskId: "background", role: "background", commandClass: "lint", command: "eslint ." }),
    );
    const worker = scheduler.acquireExecution(runRequest({ taskId: "worker" }));
    const verifier = scheduler.acquireExecution(runRequest({ taskId: "verifier", role: "verifier" }));
    scheduler.releaseExecution(blocker.leaseId, "finish");
    expect((await verifier).taskId).toBe("verifier");
    scheduler.releaseExecution((await verifier).leaseId, "finish");
    expect((await worker).taskId).toBe("worker");
    scheduler.releaseExecution((await worker).leaseId, "finish");
    expect((await background).taskId).toBe("background");
    scheduler.releaseExecution((await background).leaseId, "finish");
  });

  it("dequeues a STOP while the task is still waiting and frees the thinking slot", async () => {
    const { scheduler } = await createHarness({ totalRamGb: 16, pressure: "Orange" });
    await admit(scheduler, ["blocker", "waiting"]);
    const blocker = await scheduler.acquireExecution(runRequest({ taskId: "blocker" }));
    const controller = new AbortController();
    const waiting = scheduler.acquireExecution(
      runRequest({ taskId: "waiting", signal: controller.signal }),
    );
    expect(scheduler.snapshot().waitingForRunSlotCount).toBe(1);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(AbortError);
    expect(scheduler.thinking.has("waiting")).toBe(false);
    expect(scheduler.snapshot().waitingForRunSlotCount).toBe(0);
    expect(scheduler.snapshot().slotOwnerTaskIds).toEqual(["blocker"]);
    scheduler.releaseExecution(blocker.leaseId, "finish");
    expect(scheduler.snapshot().slotOwnerTaskIds).toEqual([]);
  });

  it("starts the timeout only after the lease and audits the job on timeout", async () => {
    const { scheduler, clock } = await createHarness({ totalRamGb: 16 });
    await admit(scheduler, ["timed"]);
    const running = scheduler.runExecution(runRequest({ taskId: "timed", timeoutMs: 1_000 }), async (lease) => {
      expect(lease.deadlineAt - lease.acquiredAt).toBe(1_000);
      expect(lease.queuedMs).toBe(0);
      clock.advance(1_001);
      return "late";
    });
    await expect(running).rejects.toBeInstanceOf(ExecutionTimeoutError);
    expect(scheduler.snapshot().runningSlotCount).toBe(0);
    expect(scheduler.execution.inspect().dirtySlotIds).toEqual([]);
    expect(scheduler.thinking.phase("timed")).toBe("thinking");
  });

  it("quarantines a slot whose job object still has child processes", async () => {
    const { scheduler, jobs, worktrees } = await createHarness({ totalRamGb: 16 });
    await admit(scheduler, ["leaky", "next"]);
    jobs.retainChildrenOnClose = true;
    const leaky = await scheduler.acquireExecution(runRequest({ taskId: "leaky" }));
    const report = scheduler.releaseExecution(leaky.leaseId, "finish");
    expect(report.clean).toBe(false);
    expect(report.activeChildProcesses).toBe(2);
    expect(scheduler.execution.inspect().dirtySlotIds).toEqual([leaky.slotId]);
    expect(worktrees.unbindCount).toBe(0);

    jobs.retainChildrenOnClose = false;
    const next = await scheduler.acquireExecution(runRequest({ taskId: "next" }));
    expect(next.slotId).not.toBe(leaky.slotId);
    scheduler.releaseExecution(next.leaseId, "finish");

    jobs.clearChildren(leaky.jobId);
    expect(scheduler.auditExecutionSlots()).toBe(1);
    expect(scheduler.execution.inspect().dirtySlotIds).toEqual([]);
    expect(worktrees.unbindCount).toBeGreaterThan(0);

    const reused = await scheduler.acquireExecution(runRequest({ taskId: "leaky" }));
    expect(reused.slotId).toBe(leaky.slotId);
    scheduler.releaseExecution(reused.leaseId, "finish");
  });

  it("holds the task when the sandbox tier selector refuses the command", async () => {
    const { scheduler, tiers } = await createHarness({ totalRamGb: 16 });
    tiers.holdCommands.add("migrate");
    await admit(scheduler, ["install"]);
    await expect(
      scheduler.acquireExecution(
        runRequest({ taskId: "install", commandClass: "migrate", command: "pnpm migrate" }),
      ),
    ).rejects.toBeInstanceOf(SandboxHoldError);
    expect(scheduler.snapshot().runningSlotCount).toBe(0);
    expect(scheduler.thinking.has("install")).toBe(true);
    expect(scheduler.thinking.phase("install")).toBe("thinking");
  });

  it("lets a heavy command hold a pool slot while it waits for the heavy lane", async () => {
    const { scheduler } = await createHarness({ totalRamGb: 16, executionCap: 2 });
    await admit(scheduler, ["build-a", "build-b"]);
    const gate = deferred<void>();
    let started = 0;
    const first = scheduler.runExecution(
      runRequest({ taskId: "build-a", commandClass: "build", command: "pnpm build" }),
      async () => {
        started += 1;
        await gate.promise;
      },
    );
    await until(() => started === 1);
    const second = scheduler.runExecution(
      runRequest({ taskId: "build-b", commandClass: "playwright", command: "playwright test" }),
      async () => {
        started += 1;
      },
    );
    await until(() => scheduler.snapshot().runningSlotCount === 2);
    expect(started).toBe(1);
    gate.resolve();
    await first;
    await second;
    expect(started).toBe(2);
    expect(scheduler.snapshot().runningSlotCount).toBe(0);
  });
});
