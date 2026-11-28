import { describe, expect, it } from "vitest";
import { ManualClock } from "../../src/capacity-pools/clock.js";
import {
  CapacityError,
  FOREIGN_RUNTIMES,
  SecretTransferRefusedError,
  SessionCapExceededError,
  SessionProcessCapGuard,
  SingleDiskWriteLane,
  THINKING_RAM_MB,
  ThreePoolCapacityScheduler,
  TierERemoteExecutionInterface,
} from "../../src/capacity-pools/index.js";
import type {
  CostEstimate,
  ExecCommandRequest,
  ExecCommandResult,
  ExecutionSlotBackend,
  OutputChunk,
  ProvisionSlotRequest,
  ProvisionedSlot,
  SyncDiffRequest,
} from "../../src/capacity-pools/index.js";
import { admit, createHarness, deferred, runRequest, until } from "./support.js";

describe("session cap, disk lane, tier E, and contention", () => {
  it("parks the two longest-idle foreign sessions before the resident count can stay over the cap", () => {
    const clock = new ManualClock(10_000);
    const guard = new SessionProcessCapGuard(clock, 4, {
      checkpointAndPark: (request) => ({ parked: true, reclaimedRamMb: request.residentRamMb }),
    });
    for (let index = 1; index <= 6; index += 1) {
      guard.observeResident({
        sessionId: `s${index}`,
        runtime: index % 2 === 0 ? "codex-app-server" : "claude",
        residentRamMb: 300,
        lastActiveAt: index * 100,
      });
    }
    expect(guard.activeCount()).toBe(6);
    const parked = guard.enforceCeiling();
    expect(parked.map((session) => session.sessionId)).toEqual(["s1", "s2"]);
    expect(guard.activeCount()).toBe(4);
    expect(guard.parkedCount()).toBe(2);
    expect(guard.reclaimedRamMb()).toBe(600);
    expect(guard.activeCount()).toBeLessThanOrEqual(guard.cap);
  });

  it("checkpoints the longest-idle session before spawning session 5", () => {
    const clock = new ManualClock(5_000);
    const events: string[] = [];
    let guard: SessionProcessCapGuard | null = null;
    guard = new SessionProcessCapGuard(clock, 4, {
      checkpointAndPark: (request) => {
        events.push(`park:${request.sessionId}`);
        events.push(`spawned:${guard?.has("s5") === true}`);
        return { parked: true, reclaimedRamMb: request.residentRamMb };
      },
    });
    for (let index = 1; index <= 4; index += 1) {
      guard.observeResident({
        sessionId: `s${index}`,
        runtime: "cursor",
        residentRamMb: 300,
        lastActiveAt: index * 10,
      });
    }
    const spawned = guard.spawn({
      sessionId: "s5",
      runtime: "copilot",
      residentRamMb: 300,
    });
    expect(events).toEqual(["park:s1", "spawned:false"]);
    expect(spawned.state).toBe("active");
    expect(guard.activeCount()).toBe(4);
    expect(guard.reclaimedRamMb()).toBe(300);
    expect(guard.get("s1").state).toBe("parked");
  });

  it("refuses to exceed the cap when every resident session is busy", () => {
    const guard = new SessionProcessCapGuard(new ManualClock(), 4, {
      checkpointAndPark: () => {
        throw new Error("busy sessions must not be parked");
      },
    });
    for (const runtime of FOREIGN_RUNTIMES) {
      if (guard.activeCount() >= 4) break;
      guard.spawn({ sessionId: runtime, runtime, residentRamMb: 150, busy: true });
    }
    expect(guard.activeCount()).toBe(4);
    expect(() => guard.spawn({ sessionId: "gemini-extra", runtime: "gemini", residentRamMb: 400 })).toThrow(
      SessionCapExceededError,
    );
    expect(guard.activeCount()).toBe(4);
  });

  it("serializes unpack and worktree creation with zero overlap", async () => {
    const lane = new SingleDiskWriteLane();
    const gate = deferred<void>();
    let current = 0;
    let peak = 0;
    const unpack = lane.run("pnpm_hardlink_unpack", async () => {
      current += 1;
      peak = Math.max(peak, current);
      await gate.promise;
      current -= 1;
      return "unpacked";
    });
    const worktree = lane.run("git_worktree_add", async () => {
      current += 1;
      peak = Math.max(peak, current);
      current -= 1;
      return "cloned";
    });
    await until(() => lane.activeCount === 1);
    expect(peak).toBe(1);
    gate.resolve();
    await expect(Promise.all([unpack, worktree])).resolves.toEqual(["unpacked", "cloned"]);
    expect(peak).toBe(1);
    expect(lane.peakConcurrent).toBe(1);
    expect(current).toBe(0);
  });

  it("pauses new disk work after active time stays at or above 80 percent for 10 seconds", async () => {
    const lane = new SingleDiskWriteLane();
    lane.reportDiskActivity(90, 0);
    lane.reportDiskActivity(90, 9_999);
    expect(lane.isPaused).toBe(false);
    lane.reportDiskActivity(90, 10_000);
    expect(lane.isPaused).toBe(true);
    let started = false;
    const pending = lane.run("sqlite_vacuum", async () => {
      started = true;
      return "vacuumed";
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toBe(false);
    expect(lane.activeCount).toBe(0);
    lane.reportDiskActivity(10, 11_000);
    await expect(pending).resolves.toBe("vacuumed");
    expect(started).toBe(true);
  });

  it("serializes disk bodies that already hold separate run slots", async () => {
    const { scheduler } = await createHarness({ totalRamGb: 16, executionCap: 2 });
    await admit(scheduler, ["unpack", "clone"]);
    const gate = deferred<void>();
    let current = 0;
    let peak = 0;
    const unpack = scheduler.runDiskExecution(
      "pnpm_install",
      runRequest({ taskId: "unpack" }),
      async () => {
        current += 1;
        peak = Math.max(peak, current);
        await gate.promise;
        current -= 1;
      },
    );
    const clone = scheduler.runDiskExecution(
      "git_worktree_reset",
      runRequest({ taskId: "clone" }),
      async () => {
        current += 1;
        peak = Math.max(peak, current);
        current -= 1;
      },
    );
    await until(() => scheduler.disk.activeCount === 1 && scheduler.snapshot().runningSlotCount === 2);
    expect(peak).toBe(1);
    gate.resolve();
    await Promise.all([unpack, clone]);
    expect(peak).toBe(1);
    expect(scheduler.disk.peakConcurrent).toBe(1);
  });

  it("keeps v1 local and satisfies the Tier E contract on a mock remote backend", async () => {
    const local = await createHarness({ totalRamGb: 16 });
    expect(local.backend.locality).toBe("local");
    expect(local.backend.provisionCount).toBe(2);
    expect(local.scheduler.tierE.locality).toBe("local");
    await expect(
      ThreePoolCapacityScheduler.create({
        totalRamGb: 16,
        backend: new MockRemoteBackend(),
      }),
    ).rejects.toBeInstanceOf(CapacityError);

    const backend = new MockRemoteBackend();
    const remote = new TierERemoteExecutionInterface(backend);
    const cycle = await remote.runCycle({
      slotId: "remote-slot-1",
      baseCommit: "abc123",
      patch: "diff --git a/src/app.ts b/src/app.ts",
      command: "pnpm test",
      timeoutMs: 1_000,
      secretsApproved: false,
      secretMaterialPresent: false,
    });
    expect(backend.calls).toEqual([
      "provisionSlot",
      "syncDiff",
      "execCommand",
      "streamOutput",
      "collectArtifacts",
      "costEstimate",
      "releaseSlot",
    ]);
    expect(cycle.cost).toEqual({ currency: "usd", amount: 0.42 });
    expect(cycle.exec.exitCode).toBe(0);

    backend.calls.length = 0;
    await expect(
      remote.runCycle({
        slotId: "remote-slot-2",
        baseCommit: "abc123",
        patch: "diff --git a/secret b/secret",
        command: "pnpm test",
        timeoutMs: 1_000,
        secretsApproved: false,
        secretMaterialPresent: true,
      }),
    ).rejects.toBeInstanceOf(SecretTransferRefusedError);
    expect(backend.calls).toEqual(["provisionSlot", "releaseSlot"]);

    const allowed = await ThreePoolCapacityScheduler.create({
      totalRamGb: 16,
      allowRemoteBackend: true,
      backend: new MockRemoteBackend(),
    });
    expect(allowed.tierE.locality).toBe("remote");
    expect(allowed.warmExecutionCap).toBe(2);
  });

  it("shares two warm slots across 16 thinking workers", async () => {
    const { scheduler, backend } = await createHarness({
      totalRamGb: 16,
      thinkingCap: 20,
      executionCap: 2,
    });
    const ids = Array.from({ length: 16 }, (_, index) => `agent-${index + 1}`);
    await admit(scheduler, ids);
    expect(scheduler.snapshot().thinkingCount).toBe(16);
    expect(scheduler.thinking.estimatedRamMb()).toBe(16 * THINKING_RAM_MB);
    expect(backend.provisionCount).toBe(2);
    let peak = 0;
    await Promise.all(
      ids.map((taskId) =>
        scheduler.runExecution(runRequest({ taskId, timeoutMs: 5_000 }), async () => {
          peak = Math.max(peak, scheduler.snapshot().runningSlotCount);
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(backend.provisionCount).toBe(2);
    expect(scheduler.snapshot().runningSlotCount).toBe(0);
    expect(scheduler.snapshot().thinkingCount).toBe(16);
  });

  it("drains Green to Orange to Red and back without killing in-flight runs", async () => {
    const { scheduler } = await createHarness({ totalRamGb: 32 });
    expect(scheduler.executionTarget()).toBe(3);
    const ids = ["run-1", "run-2", "run-3", "run-4", "run-5"];
    await admit(scheduler, ids);
    const first = await scheduler.acquireExecution(runRequest({ taskId: "run-1" }));
    const second = await scheduler.acquireExecution(runRequest({ taskId: "run-2" }));
    const third = await scheduler.acquireExecution(runRequest({ taskId: "run-3" }));
    const fourth = scheduler.acquireExecution(runRequest({ taskId: "run-4" }));
    expect(scheduler.snapshot().runningSlotCount).toBe(3);
    expect(scheduler.snapshot().waitingForRunSlotCount).toBe(1);

    scheduler.setPressure("Orange");
    expect(scheduler.executionTarget()).toBe(1);
    expect(scheduler.snapshot().runningSlotCount).toBe(3);
    expect(scheduler.snapshot().slotOwnerTaskIds).toEqual(["run-1", "run-2", "run-3"]);
    expect(scheduler.snapshot().waitingForRunSlotCount).toBe(1);

    scheduler.releaseExecution(first.leaseId, "finish");
    expect(scheduler.snapshot().runningSlotCount).toBe(2);
    expect(scheduler.snapshot().waitingForRunSlotCount).toBe(1);
    scheduler.releaseExecution(second.leaseId, "finish");
    expect(scheduler.snapshot().runningSlotCount).toBe(1);
    expect(scheduler.snapshot().slotOwnerTaskIds).toEqual(["run-3"]);
    expect(scheduler.snapshot().waitingForRunSlotCount).toBe(1);

    scheduler.releaseExecution(third.leaseId, "finish");
    const promoted = await fourth;
    expect(promoted.taskId).toBe("run-4");
    expect(scheduler.snapshot().runningSlotCount).toBe(1);

    scheduler.setPressure("Red");
    expect(scheduler.executionTarget()).toBe(0);
    const fifth = scheduler.acquireExecution(runRequest({ taskId: "run-5" }));
    expect(scheduler.snapshot().runningSlotCount).toBe(1);
    expect(scheduler.snapshot().slotOwnerTaskIds).toEqual(["run-4"]);
    scheduler.releaseExecution(promoted.leaseId, "finish");
    expect(scheduler.snapshot().runningSlotCount).toBe(0);
    expect(scheduler.snapshot().waitingForRunSlotCount).toBe(1);

    scheduler.setPressure("Green");
    const resumed = await fifth;
    expect(resumed.taskId).toBe("run-5");
    expect(scheduler.executionTarget()).toBe(3);
    scheduler.releaseExecution(resumed.leaseId, "finish");
    expect(scheduler.snapshot().runningSlotCount).toBe(0);
    expect(scheduler.snapshot().thinkingCount).toBe(5);
  });
});

class MockRemoteBackend implements ExecutionSlotBackend {
  readonly locality = "remote" as const;
  readonly calls: string[] = [];
  private released = new Set<string>();

  async provisionSlot(request: ProvisionSlotRequest): Promise<ProvisionedSlot> {
    this.calls.push("provisionSlot");
    return { slotId: request.slotId, backendSlotId: `remote-${request.slotId}`, locality: "remote" };
  }

  async syncDiff(request: SyncDiffRequest): Promise<{ synced: true; bytes: number }> {
    this.calls.push("syncDiff");
    if (this.released.has(request.slot.backendSlotId)) {
      throw new CapacityError("tier_e", "slot released");
    }
    return { synced: true, bytes: request.patch.length };
  }

  async execCommand(request: ExecCommandRequest): Promise<ExecCommandResult> {
    this.calls.push("execCommand");
    return { execId: "remote-exec-1", exitCode: 0, output: request.command };
  }

  async *streamOutput(result: ExecCommandResult): AsyncIterable<OutputChunk> {
    this.calls.push("streamOutput");
    yield { execId: result.execId, stream: "stdout", text: result.output };
  }

  async collectArtifacts(result: ExecCommandResult): Promise<{ execId: string; paths: readonly string[] }> {
    this.calls.push("collectArtifacts");
    return { execId: result.execId, paths: ["artifacts/report.json"] };
  }

  async releaseSlot(slot: ProvisionedSlot): Promise<void> {
    this.calls.push("releaseSlot");
    this.released.add(slot.backendSlotId);
  }

  async costEstimate(): Promise<CostEstimate> {
    this.calls.push("costEstimate");
    return { currency: "usd", amount: 0.42 };
  }
}
