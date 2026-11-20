import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HARD_CODED_PORT,
  HardCodedPortFallbackManager,
  JobAlreadyTerminatedError,
  LeaseTimeoutError,
  PORT_3000_LEASE_KEY,
  PORT_FALLBACK_PRECEDENCE,
  SqliteGlobalResourceLeaseStore,
  type DockerCli,
  type JobTerminationHandle,
} from "../../src/auth-payment-mocks/index.js";
import { closeServer, listenLoopback } from "../../src/auth-payment-mocks/http-util.js";

const closers: Array<() => void> = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
});

describe("HardCodedPortFallbackManager", () => {
  it("recommends configurability first and selects Tier D when Docker is available", async () => {
    const networks: string[] = [];
    const docker = fakeDocker(true, networks);
    const { manager, store } = openManager(docker);
    const started = Date.now();
    const [first, second] = await Promise.all([
      manager.resolve({ projectId: "proj", envId: "env1", flaggedBy: "task-049" }),
      manager.resolve({ projectId: "proj", envId: "env2", flaggedBy: "task-166" }),
    ]);
    expect(Date.now() - started).toBeLessThan(500);
    expect(first.precedence).toEqual(PORT_FALLBACK_PRECEDENCE);
    expect(first.recommendation.option).toBe(1);
    expect(first.recommendation.phase).toBe("phase0_or_brownfield");
    expect(first.recommendation.message).toContain("Phase 0");
    expect(first.recommendation.message).toContain("brownfield");
    expect(first.selectedOption).toBe(2);
    expect(second.selectedOption).toBe(2);
    expect(first.mode).toBe("tier_d");
    expect(first.tierD?.portInsideNamespace).toBe(3000);
    expect(first.tierD?.network).not.toBe(second.tierD?.network);
    expect(first.flaggedBy).toBe("task-049");
    expect(second.flaggedBy).toBe("task-166");
    expect(networks).toHaveLength(2);
    expect(store.current(PORT_3000_LEASE_KEY)).toBeUndefined();
    await manager.finish(first);
    expect(networks).toEqual([second.tierD?.network]);
    await manager.releaseEnvironment("proj", "env2");
    expect(networks).toEqual([]);
  });

  it("serializes exclusive port 3000 leases across projects without overlapping binds", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ef-port-3000-"));
    const dbPath = join(directory, "global.db");
    const storeA = new SqliteGlobalResourceLeaseStore(dbPath);
    const storeB = new SqliteGlobalResourceLeaseStore(dbPath);
    closers.push(() => {
      storeA.close();
      storeB.close();
      rmSync(directory, { recursive: true, force: true });
    });
    const docker = fakeDocker(false, []);
    const projectA = new HardCodedPortFallbackManager({ store: storeA, docker, pollMs: 15 });
    const projectB = new HardCodedPortFallbackManager({ store: storeB, docker, pollMs: 15 });
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];

    async function hold(manager: HardCodedPortFallbackManager, projectId: string, envId: string): Promise<void> {
      await manager.withHardCodedPort({ projectId, envId, waitMs: 5_000, pollMs: 15 }, async (resolution) => {
        expect(resolution.selectedOption).toBe(3);
        expect(resolution.mode).toBe("exclusive_port_lease");
        expect(resolution.lease?.resourceKey).toBe(PORT_3000_LEASE_KEY);
        expect(resolution.hardCodedPort).toBe(HARD_CODED_PORT);
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(`enter:${projectId}`);
        const server = createServer();
        await listenLoopback(server, HARD_CODED_PORT);
        try {
          await delay(40);
        } finally {
          await closeServer(server);
          active -= 1;
          order.push(`exit:${projectId}`);
        }
      });
    }

    await Promise.all([hold(projectA, "project-a", "env1"), hold(projectB, "project-b", "env2")]);
    expect(maxActive).toBe(1);
    expect(order).toEqual(
      order[0] === "enter:project-a"
        ? ["enter:project-a", "exit:project-a", "enter:project-b", "exit:project-b"]
        : ["enter:project-b", "exit:project-b", "enter:project-a", "exit:project-a"],
    );
    expect(storeA.current(PORT_3000_LEASE_KEY)).toBeUndefined();
    expect(storeB.current(PORT_3000_LEASE_KEY)).toBeUndefined();
  });

  it("releases the port lease on job termination and env.destroy without deadlocking", async () => {
    const { manager } = openManager(fakeDocker(false, []));
    const job = fakeJob("job-1");
    const held = manager.resolve({ projectId: "proj", envId: "holder", job, waitMs: 1_000 });
    const resolution = await held;
    expect(resolution.lease?.envId).toBe("holder");
    const waiter = manager.resolve({ projectId: "other", envId: "waiter", waitMs: 2_000, pollMs: 10 });
    let settled = false;
    const finished = waiter.then((value) => {
      settled = true;
      return value;
    });
    await delay(40);
    expect(settled).toBe(false);
    job.terminate();
    const acquired = await finished;
    expect(acquired.lease?.envId).toBe("waiter");
    await manager.releaseEnvironment("other", "waiter");

    const stuck = await manager.resolve({ projectId: "proj", envId: "stuck", leaseTtlMs: 60_000, waitMs: 1_000 });
    await expect(
      manager.resolve({ projectId: "proj", envId: "late", waitMs: 150, pollMs: 20 }),
    ).rejects.toBeInstanceOf(LeaseTimeoutError);
    await manager.releaseEnvironment("proj", "stuck");
    await manager.resolve({ projectId: "proj", envId: "expiring", leaseTtlMs: 40, waitMs: 1_000 });
    await delay(70);
    const stolen = await manager.resolve({ projectId: "proj", envId: "next", waitMs: 1_000, pollMs: 15 });
    expect(stolen.lease?.envId).toBe("next");
    expect(stuck.lease?.envId).toBe("stuck");
    await manager.releaseEnvironment("proj", "next");

    const dead = fakeJob("job-dead");
    dead.terminate();
    await expect(manager.resolve({ projectId: "proj", envId: "dead", job: dead })).rejects.toBeInstanceOf(
      JobAlreadyTerminatedError,
    );
  });

  it("does not take a port lease when Tier D network allocation fails", async () => {
    const docker: DockerCli = {
      isAvailable: () => true,
      async createNetwork() {
        throw new Error("docker network create failed");
      },
      async removeNetwork() {
        return undefined;
      },
    };
    const { manager, store } = openManager(docker);
    await expect(manager.resolve({ projectId: "proj", envId: "env1" })).rejects.toThrow(/docker network create failed/);
    expect(store.current(PORT_3000_LEASE_KEY)).toBeUndefined();
  });

  it("leases one external sandbox account exclusively and leaves other accounts parallel", async () => {
    const { manager } = openManager(fakeDocker(false, []));
    const first = await manager.acquireExternalSandboxAccount({
      accountKey: "stripe-sandbox",
      projectId: "proj",
      envId: "env1",
    });
    expect(first.resourceKey).toBe("external-sandbox:stripe-sandbox");
    const otherAccount = manager.acquireExternalSandboxAccount({
      accountKey: "mail-sandbox",
      projectId: "proj",
      envId: "env2",
      waitMs: 500,
    });
    await expect(otherAccount).resolves.toMatchObject({ envId: "env2" });
    const started = Date.now();
    const blocked = manager.acquireExternalSandboxAccount({
      accountKey: "stripe-sandbox",
      projectId: "proj",
      envId: "env3",
      waitMs: 2_000,
      pollMs: 10,
    });
    await delay(30);
    expect(manager.releaseExternalSandboxAccount("stripe-sandbox", { projectId: "proj", envId: "env1" })).toBe(true);
    const acquired = await blocked;
    expect(acquired.envId).toBe("env3");
    expect(Date.now() - started).toBeLessThan(1_500);
    await manager.releaseEnvironment("proj", "env2");
    await manager.releaseEnvironment("proj", "env3");
  });
});

function openManager(docker: DockerCli): {
  manager: HardCodedPortFallbackManager;
  store: SqliteGlobalResourceLeaseStore;
} {
  const directory = mkdtempSync(join(tmpdir(), "ef-lease-"));
  const store = new SqliteGlobalResourceLeaseStore(join(directory, "global.db"));
  const manager = new HardCodedPortFallbackManager({ store, docker, pollMs: 10 });
  closers.push(() => {
    manager.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { manager, store };
}

function fakeDocker(available: boolean, networks: string[]): DockerCli {
  return {
    isAvailable: () => available,
    async createNetwork(name: string) {
      if (name.includes("boom")) throw new Error("docker network create failed");
      networks.push(name);
    },
    async removeNetwork(name: string) {
      const index = networks.indexOf(name);
      if (index >= 0) networks.splice(index, 1);
    },
  };
}

function fakeJob(jobId: string): JobTerminationHandle & { terminate(): void; terminated: boolean } {
  const listeners = new Set<() => void>();
  const job = {
    jobId,
    terminated: false,
    onTerminate(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    terminate() {
      job.terminated = true;
      for (const listener of [...listeners]) listener();
    },
  };
  return job;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
