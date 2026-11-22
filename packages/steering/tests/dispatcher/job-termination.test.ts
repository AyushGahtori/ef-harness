import { describe, expect, it } from "vitest";
import { createFourRouteSteeringDispatcher } from "../../src/dispatcher/index.js";

describe("ImmediateKernelStopController job termination", () => {
  it("kills a child that ignores the interrupt and resets the rehearsal worktree", async () => {
    const harness = createFourRouteSteeringDispatcher({
      integrationHead: "refs/harness/integration",
      productionStamp: "prod-v1",
      demoStamp: "demo-v1",
      workers: [
        {
          id: "W-migrate",
          featureId: "F-Orders",
          taskId: "T-Migrate",
          kind: "rehearsal",
          checkpointRef: "refs/harness/checkpoints/T-Migrate/4",
          worktreePath: "wt/merge-rehearsal",
        },
      ],
      features: [{ featureId: "F-Orders", title: "Orders", status: "building" }],
    });
    const job = harness.jobs.createJob("migration-rehearsal");
    const spawned = harness.jobs.spawnInJob(job.id);
    harness.runtime.attachWorkerProcess("W-migrate", spawned.pid, job.id);
    await new Promise((resolve) => {
      setTimeout(resolve, 30);
    });
    expect(harness.jobs.pidAlive(spawned.pid)).toBe(true);

    const started = performance.now();
    const outcome = await harness.stopController.stop(40);
    const elapsed = performance.now() - started;

    expect(outcome.llmCalls).toBe(0);
    expect(outcome.stateFlipMs).toBeLessThan(100);
    expect(elapsed).toBeLessThan(500);
    expect(outcome.runtime.state).toBe("STOPPED");
    expect(harness.jobs.pidAlive(spawned.pid)).toBe(false);
    expect(harness.jobs.escalatedHistory).toContain(spawned.pid);
    expect(outcome.jobTerminations.every((item) => item.survivingPids.length === 0)).toBe(true);
    expect(outcome.rehearsalsReset).toEqual(["wt/merge-rehearsal"]);
    expect(harness.runtime.workers.get("W-migrate")?.worktreeStatus).toBe("reset");
    expect(harness.runtime.workers.get("W-migrate")?.checkpointRef).toBe("refs/harness/checkpoints/T-Migrate/4");
    expect(harness.runtime.productionStamp).toBe("prod-v1");
    expect(harness.runtime.demoStamp).toBe("demo-v1");
    expect(harness.runtime.integrationHead).toBe("refs/harness/integration");
    expect(harness.runtime.featureHeads.get("F-Orders")).toBe("refs/harness/f/F-Orders");
  });
});
