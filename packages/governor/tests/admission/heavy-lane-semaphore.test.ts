import { describe, expect, it } from "vitest";
import { HeavyLaneSemaphore } from "../../src/admission/heavy-lane-semaphore.js";
import { GB16_MB, GB32_MB, maxHeavyPermits } from "../../src/admission/thresholds.js";

async function flush(): Promise<void> {
  await Promise.resolve();
}

describe("heavy lane semaphore", () => {
  it("runs the verifier before the worker on a 16 GB laptop and stays under 12 GB", async () => {
    expect(maxHeavyPermits(GB16_MB, "GREEN")).toBe(1);
    const semaphore = new HeavyLaneSemaphore(GB16_MB, "GREEN");
    const worker = semaphore.enqueue({
      id: "worker-build",
      role: "worker",
      commandClass: "build",
      projectId: "proj",
    });
    const verifier = semaphore.enqueue({
      id: "verifier-playwright",
      role: "verifier",
      commandClass: "playwright",
      projectId: "proj",
    });
    await flush();
    expect(verifier.state).toBe("granted");
    expect(worker.state).toBe("queued");
    expect(semaphore.heldCount).toBe(1);
    const playwrightMb = 7_000;
    const buildMb = 6_000;
    expect(playwrightMb).toBeLessThan(12 * 1024);
    expect(playwrightMb + buildMb).toBeGreaterThan(12 * 1024);
    const next = semaphore.release(verifier.id);
    expect(next?.id).toBe(worker.id);
    expect(worker.state).toBe("granted");
    expect(semaphore.heldCount).toBe(1);
    expect(buildMb).toBeLessThan(12 * 1024);
  });

  it("orders verifier, then worker, then background, FIFO inside a role", async () => {
    const semaphore = new HeavyLaneSemaphore(GB16_MB, "GREEN");
    const background = semaphore.enqueue({
      id: "bg",
      role: "background",
      commandClass: "db_migrate",
      projectId: "proj",
    });
    const firstWorker = semaphore.enqueue({
      id: "worker-a",
      role: "worker",
      commandClass: "typecheck",
      projectId: "proj",
    });
    const secondWorker = semaphore.enqueue({
      id: "worker-b",
      role: "worker",
      commandClass: "pnpm_install",
      projectId: "proj",
    });
    const verifier = semaphore.enqueue({
      id: "verifier",
      role: "verifier",
      commandClass: "playwright",
      projectId: "proj",
    });
    await flush();
    expect(semaphore.heldIds()).toEqual(["verifier"]);
    expect(semaphore.queuedIds()).toEqual(["worker-a", "worker-b", "bg"]);
    semaphore.release(verifier.id);
    expect(firstWorker.state).toBe("granted");
    semaphore.release(firstWorker.id);
    expect(secondWorker.state).toBe("granted");
    semaphore.release(secondWorker.id);
    expect(background.state).toBe("granted");
  });

  it("allows two permits on a 32 GB green machine and shrinks without revoking holders", async () => {
    expect(maxHeavyPermits(GB32_MB, "GREEN")).toBe(2);
    expect(maxHeavyPermits(GB32_MB, "YELLOW")).toBe(1);
    expect(maxHeavyPermits(GB32_MB, "ORANGE")).toBe(1);
    expect(maxHeavyPermits(GB32_MB, "RED")).toBe(0);
    const semaphore = new HeavyLaneSemaphore(GB32_MB, "GREEN");
    const first = semaphore.enqueue({
      id: "a",
      role: "worker",
      commandClass: "build",
      projectId: "proj",
    });
    const second = semaphore.enqueue({
      id: "b",
      role: "worker",
      commandClass: "typecheck",
      projectId: "proj",
    });
    const third = semaphore.enqueue({
      id: "c",
      role: "background",
      commandClass: "playwright",
      projectId: "proj",
    });
    await flush();
    expect(semaphore.heldCount).toBe(2);
    expect(first.state).toBe("granted");
    expect(second.state).toBe("granted");
    expect(third.state).toBe("queued");
    semaphore.setPressure("YELLOW");
    expect(semaphore.permitCap).toBe(1);
    expect(semaphore.heldCount).toBe(2);
    expect(third.state).toBe("queued");
    semaphore.release(first.id);
    expect(semaphore.heldCount).toBe(1);
    expect(third.state).toBe("queued");
    semaphore.release(second.id);
    expect(third.state).toBe("granted");
  });

  it("grants nothing while the machine is RED", async () => {
    const semaphore = new HeavyLaneSemaphore(GB32_MB, "RED");
    const ticket = semaphore.enqueue({
      id: "blocked",
      role: "verifier",
      commandClass: "playwright",
      projectId: "proj",
    });
    await flush();
    expect(ticket.state).toBe("queued");
    expect(semaphore.heldCount).toBe(0);
    semaphore.setPressure("GREEN");
    expect(ticket.state).toBe("granted");
  });
});
