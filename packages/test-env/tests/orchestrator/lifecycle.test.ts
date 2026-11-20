import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AppIgnoresPortError,
  ChildExitedBeforeReadyError,
  ENV_DIRECTORY_NAME,
  EnvironmentAdmissionDeniedError,
  PORT_RANGE_MAX,
  PORT_RANGE_MIN,
  ReadinessTimeoutError,
} from "../../src/orchestrator/index.js";
import type { EnvironmentHandle, HardwareAdmissionGate } from "../../src/orchestrator/index.js";
import { appManifest, createHarness, holdPort, yamlCommand } from "./support.js";

function bindWouldSucceed(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function health(port: number, route = "/api/health"): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}${route}`);
  return response.status;
}

describe("test environment lifecycle", () => {
  it("runs create, start_app, start_service, reset_data, and destroy for two isolated environments", async () => {
    const harness = await createHarness({ projectJobName: "project-services" });
    const handles: EnvironmentHandle[] = [];
    try {
      const [first, second] = await Promise.all([
        harness.orchestrator.create(
          "attempt",
          appManifest("health-server.mjs"),
          "base-commit",
          harness.worktree,
        ),
        harness.orchestrator.create(
          "verifier",
          appManifest("health-server.mjs"),
          "base-commit",
          harness.worktree,
        ),
      ]);
      handles.push(first, second);

      expect(first.host).toMatch(/^env-[0-9a-f]+\.localhost$/);
      expect(second.host).not.toBe(first.host);
      expect(first.dbName).not.toBe(second.dbName);
      expect(first.recipientDomain).not.toBe(second.recipientDomain);
      expect(first.ports.app).not.toBe(second.ports.app);
      expect(first.ports.pg).not.toBe(second.ports.pg);
      expect(first.ports.redis).not.toBe(second.ports.redis);
      for (const port of Object.values(first.ports).concat(Object.values(second.ports))) {
        expect(port).toBeGreaterThanOrEqual(PORT_RANGE_MIN);
        expect(port).toBeLessThanOrEqual(PORT_RANGE_MAX);
      }
      expect(new Set(Object.values(first.ports)).size).toBe(Object.values(first.ports).length);

      const job = harness.jobs.created[0];
      expect(job?.limitsKillOnClose).toBe(true);
      expect(job?.handle.kind).toBe("environment");
      expect(job?.parentName).toBe("project-services");
      expect(job?.activeProcessLimit).toBe(64);

      await first.start_app();
      await second.start_app();
      const firstUrl = await first.start_service("worker");
      const secondUrl = await second.start_service("worker");
      expect(firstUrl).toBe(`http://${first.host}:${first.ports.worker}`);
      expect(secondUrl).not.toBe(firstUrl);
      expect(await first.start_service("worker")).toBe(firstUrl);

      expect(await health(first.ports.app ?? 0)).toBe(200);
      expect(await health(second.ports.app ?? 0)).toBe(200);
      expect(await health(first.ports.worker ?? 0, "/ready")).toBe(200);

      const appBefore = harness.envProcesses
        .listByEnvironment(first.id)
        .find((row) => row.role === "app");
      await first.reset_data();
      await second.reset_data();
      const appAfter = harness.envProcesses
        .listByEnvironment(first.id)
        .find((row) => row.role === "app");
      expect(appAfter?.pid).toBe(appBefore?.pid);
      expect(harness.providers.get("postgres")?.resets).toBe(2);
      expect(await health(first.ports.app ?? 0)).toBe(200);
      expect(await health(second.ports.app ?? 0)).toBe(200);

      const secondPorts = harness.portLeases.list().filter((row) => row.environment === second.id);
      await first.destroy();
      expect(await health(second.ports.app ?? 0)).toBe(200);
      expect(await health(second.ports.worker ?? 0, "/ready")).toBe(200);
      await expect(fetch(`http://127.0.0.1:${first.ports.app}/api/health`)).rejects.toThrow();
      const remaining = harness.portLeases.list();
      expect(remaining.map((row) => row.environment)).not.toContain(first.id);
      expect(remaining).toEqual(expect.arrayContaining(secondPorts));
      expect(harness.envProcesses.listByEnvironment(first.id)).toEqual([]);
      await expect(
        fs.access(path.join(harness.worktree, ENV_DIRECTORY_NAME, first.id)),
      ).rejects.toThrow();
      await expect(
        fs.access(path.join(harness.worktree, ENV_DIRECTORY_NAME, second.id)),
      ).resolves.toBeUndefined();

      await second.destroy();
      expect(harness.portLeases.list()).toEqual([]);
    } finally {
      await Promise.all(
        handles.map(async (handle) => {
          try {
            await handle.destroy();
          } catch (error) {
            if (!(error instanceof Error)) throw error;
          }
        }),
      );
      await harness.cleanup();
    }
  }, 30_000);

  it("skips a port held by an unrelated process and keeps leases inside the reserved range", async () => {
    const held = await holdPort();
    const harness = await createHarness({
      portProbe: async (port) => {
        if (port === held.port) {
          expect(await bindWouldSucceed(port)).toBe(false);
          return false;
        }
        return port > held.port;
      },
    });
    try {
      const handle = await harness.orchestrator.create(
        "attempt",
        "services: [postgres]\nenv: {}\n",
        "base",
        harness.worktree,
      );
      expect(Object.values(handle.ports)).not.toContain(held.port);
      expect(Object.values(handle.ports).every((port) => port > held.port)).toBe(true);
      expect(harness.portLeases.list().some((row) => row.port === held.port)).toBe(false);
      for (const row of harness.portLeases.list()) {
        expect(row.port).toBeGreaterThanOrEqual(PORT_RANGE_MIN);
        expect(row.port).toBeLessThanOrEqual(PORT_RANGE_MAX);
      }
      await handle.destroy();
    } finally {
      await held.close();
      await harness.cleanup();
    }
  });

  it("fails an early app crash in under 500ms with stderr, and reports an app that binds port 3000", async () => {
    const harness = await createHarness({ readinessTimeoutMs: 2_000 });
    try {
      const crashing = await harness.orchestrator.create(
        "attempt",
        `
services: []
tier: 1
app:
  start: ${yamlCommand("early-crash.mjs")}
  ready: http GET /api/health == 200
`,
        "base",
        harness.worktree,
      );
      const started = performance.now();
      const crashed = await crashing.start_app().then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(performance.now() - started).toBeLessThan(500);
      expect(crashed).toBeInstanceOf(ChildExitedBeforeReadyError);
      expect(String(crashed)).toContain("boom-early");
      await crashing.destroy();

      const ignoring = await harness.orchestrator.create(
        "attempt",
        `
services: []
tier: 1
app:
  start: ${yamlCommand("ignore-port.mjs")}
  ready: http GET /api/health == 200
`,
        "base",
        harness.worktree,
      );
      const ignoreStarted = performance.now();
      const error = await ignoring.start_app().then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(performance.now() - ignoreStarted).toBeLessThan(1_000);
      expect(error).toBeInstanceOf(AppIgnoresPortError);
      if (error instanceof AppIgnoresPortError) {
        expect(error.expectedPort).toBe(ignoring.ports.app);
        expect(error.observedPort).toBe(3000);
      }
      await ignoring.destroy();
    } finally {
      await harness.cleanup();
    }
  }, 20_000);

  it("returns captured logs when a readiness probe times out", async () => {
    const harness = await createHarness({ readinessTimeoutMs: 250 });
    try {
      const handle = await harness.orchestrator.create(
        "attempt",
        `
services: []
tier: 1
app:
  start: ${yamlCommand("hang.mjs")}
  ready: tcp
`,
        "base",
        harness.worktree,
      );
      await expect(handle.start_app()).rejects.toBeInstanceOf(ReadinessTimeoutError);
      await handle.destroy();
    } finally {
      await harness.cleanup();
    }
  });

  it("rolls back every leased port, provider, and job when a later service fails", async () => {
    const harness = await createHarness();
    const redis = harness.providers.get("redis");
    if (!redis) throw new Error("missing redis provider");
    redis.failProvision = true;
    try {
      await expect(
        harness.orchestrator.create(
          "attempt",
          appManifest("health-server.mjs"),
          "base",
          harness.worktree,
        ),
      ).rejects.toThrow(/provision failed for redis/);
      expect(harness.portLeases.list()).toEqual([]);
      expect(harness.envProcesses.list()).toEqual([]);
      expect(harness.providers.get("postgres")?.destroys).toBe(1);
      expect(redis.destroys).toBe(0);
      expect(harness.jobs.created.every((job) => job.terminated)).toBe(true);
      const leftovers = await fs
        .readdir(path.join(harness.worktree, ENV_DIRECTORY_NAME))
        .catch(() => []);
      expect(leftovers).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });

  it("is idempotent when destroy runs twice and does not release another environment's port", async () => {
    const harness = await createHarness();
    try {
      const first = await harness.orchestrator.create(
        "attempt",
        "services: [postgres]\nenv: {}\n",
        "base",
        harness.worktree,
      );
      await Promise.all([first.destroy(), first.destroy()]);
      await first.destroy();
      const second = await harness.orchestrator.create(
        "attempt",
        "services: [postgres]\nenv: {}\n",
        "base",
        harness.worktree,
      );
      const leased = harness.portLeases.list().filter((row) => row.environment === second.id);
      expect(leased.length).toBeGreaterThan(0);
      await first.destroy();
      expect(harness.portLeases.list().filter((row) => row.environment === second.id)).toEqual(
        leased,
      );
      await second.destroy();
    } finally {
      await harness.cleanup();
    }
  });

  it("pauses a stateful environment when the hardware governor denies admission", async () => {
    let calls = 0;
    const admission: HardwareAdmissionGate = {
      admitEnvironment(request) {
        calls += 1;
        expect(request.stateful).toBe(true);
        expect(request.tier).toBe(2);
        return { admitted: false, reason: "RAM low (1.8 GB free)" };
      },
    };
    const harness = await createHarness({ admission });
    try {
      await expect(
        harness.orchestrator.create("attempt", "services: [postgres]\n", "base", harness.worktree),
      ).rejects.toBeInstanceOf(EnvironmentAdmissionDeniedError);
      expect(calls).toBe(1);
      expect(harness.portLeases.list()).toEqual([]);
      expect(harness.jobs.created).toHaveLength(0);

      const stateless = await harness.orchestrator.create(
        "attempt",
        "tier: 0\nservices: [postgres, mail]\n",
        "base",
        harness.worktree,
      );
      expect(stateless.tier).toBe(0);
      expect(stateless.ports).toEqual({});
      expect(calls).toBe(1);
      expect(harness.providers.get("postgres")?.provisions).toHaveLength(0);
      await stateless.destroy();
    } finally {
      await harness.cleanup();
    }
  });

  it("restarts only a preview dev server that exceeds its memory ceiling", async () => {
    let restarts = 0;
    const harness = await createHarness({
      watchdogIntervalMs: 40,
      onPreviewRestart: () => {
        restarts += 1;
        harness.jobs.forceMemoryBytes = 0;
      },
    });
    try {
      const preview = await harness.orchestrator.create(
        "preview",
        `
services: []
tier: 1
app:
  start: ${yamlCommand("health-server.mjs")}
  ready: http GET /api/health == 200
  memoryCeilingMb: 32
`,
        "base",
        harness.worktree,
      );
      harness.jobs.forceMemoryBytes = 64 * 1024 * 1024;
      await preview.start_app();
      const firstPid = harness.envProcesses
        .listByEnvironment(preview.id)
        .find((row) => row.role === "app")?.pid;
      const deadline = Date.now() + 4_000;
      while (restarts < 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      expect(restarts).toBeGreaterThanOrEqual(1);
      const secondPid = harness.envProcesses
        .listByEnvironment(preview.id)
        .find((row) => row.role === "app")?.pid;
      expect(secondPid).not.toBe(firstPid);
      expect(await health(preview.ports.app ?? 0)).toBe(200);
      await preview.destroy();

      restarts = 0;
      harness.jobs.forceMemoryBytes = 64 * 1024 * 1024;
      const attempt = await harness.orchestrator.create(
        "attempt",
        `
services: []
tier: 1
app:
  start: ${yamlCommand("health-server.mjs")}
  ready: http GET /api/health == 200
  memoryCeilingMb: 32
`,
        "base",
        harness.worktree,
      );
      await attempt.start_app();
      const attemptPid = harness.envProcesses
        .listByEnvironment(attempt.id)
        .find((row) => row.role === "app")?.pid;
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(restarts).toBe(0);
      expect(
        harness.envProcesses.listByEnvironment(attempt.id).find((row) => row.role === "app")?.pid,
      ).toBe(attemptPid);
      await attempt.destroy();
    } finally {
      await harness.cleanup();
    }
  }, 20_000);
});
