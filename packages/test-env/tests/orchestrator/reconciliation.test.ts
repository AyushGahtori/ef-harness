import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import {
  ChildExitedBeforeReadyError,
  DEFAULT_READINESS_TIMEOUT_MS,
  ENV_DIRECTORY_NAME,
  parseListeningPid,
  parseReadinessProbe,
  ReadinessProbeError,
  removeDirectoryWithBusyRetry,
  resolveTemplate,
  runtimeVaultInjection,
  MapSecretVault,
  waitForReady,
} from "../../src/orchestrator/index.js";
import { createHarness, spawnSleeper, yamlCommand } from "./support.js";

describe("readiness, secrets, and startup reconciliation", () => {
  it("parses http, tcp, and stdout probes and fails a closed port within the timeout", async () => {
    expect(parseReadinessProbe("http GET /api/health == 200")).toEqual({
      type: "http",
      method: "GET",
      path: "/api/health",
      status: 200,
    });
    expect(parseReadinessProbe("tcp")).toEqual({ type: "tcp" });
    expect(parseReadinessProbe("stdout /service-ready/").pattern.test("service-ready")).toBe(true);
    expect(() => parseReadinessProbe("sleep 1")).toThrow(ReadinessProbeError);
    expect(DEFAULT_READINESS_TIMEOUT_MS).toBe(30_000);

    const logs = "boot log";
    await expect(
      waitForReady({
        timeoutMs: 80,
        intervalMs: 20,
        logs: () => logs,
        exit: new Promise(() => undefined),
        probe: () => false,
      }),
    ).rejects.toThrow(/boot log/);
  });

  it("aborts as soon as the child exits", async () => {
    let code: number | null = null;
    const exit = new Promise<{ code: number | null }>((resolve) => {
      setTimeout(() => {
        code = 1;
        resolve({ code: 1 });
      }, 20);
    });
    const started = performance.now();
    await expect(
      waitForReady({
        timeoutMs: 5_000,
        intervalMs: 50,
        logs: () => "stderr boom",
        exit,
        probe: () => false,
      }),
    ).rejects.toBeInstanceOf(ChildExitedBeforeReadyError);
    expect(performance.now() - started).toBeLessThan(500);
    expect(code).toBe(1);
  });

  it("keeps vault secrets in the child environment only and out of databases and temp files", async () => {
    const secret = "vault-secret-pg-value";
    const extra = "vault-secret-extra-only";
    const harness = await createHarness({ secrets: { pg: secret, EXTRA_ONLY: extra } });
    try {
      const manifest = `
services: [postgres]
app:
  start: ${yamlCommand("health-server.mjs")}
  ready: http GET /api/health == 200
env:
  DATABASE_URL: "postgres://app:{secret.pg}@127.0.0.1:{port.pg}/{db.name}"
  APP_URL: "http://{host}:{port.app}"
`;
      const attempt = await harness.orchestrator.create(
        "attempt",
        manifest,
        "base",
        harness.worktree,
      );
      expect(attempt.vars().DATABASE_URL).toContain(secret);
      expect(attempt.vars().APP_URL).toContain(attempt.host);
      expect(attempt.vars().DATABASE_URL).toContain(attempt.dbName);
      await attempt.start_app();
      const attemptBody = (await (
        await fetch(`http://127.0.0.1:${attempt.ports.app}/env`)
      ).json()) as {
        database: string | null;
        extra: string | null;
      };
      expect(attemptBody.database).toContain(secret);
      expect(attemptBody.extra).toBeNull();

      const preview = await harness.orchestrator.create(
        "preview",
        manifest,
        "base",
        harness.worktree,
      );
      await preview.start_app();
      const previewBody = (await (
        await fetch(`http://127.0.0.1:${preview.ports.app}/env`)
      ).json()) as {
        extra: string | null;
      };
      expect(previewBody.extra).toBe(extra);
      expect(
        runtimeVaultInjection("verifier", new MapSecretVault({ EXTRA_ONLY: extra })).EXTRA_ONLY,
      ).toBe(extra);
      expect(
        runtimeVaultInjection("attempt", new MapSecretVault({ EXTRA_ONLY: extra })).EXTRA_ONLY,
      ).toBeUndefined();

      const persisted = `${harness.globalText()}\n${harness.stateText()}\n${await readTree(harness.worktree)}`;
      expect(persisted).not.toContain(secret);
      expect(persisted).not.toContain(extra);

      const leaking = await harness.orchestrator.create(
        "attempt",
        `
services: [postgres]
tier: 2
app:
  start: ${yamlCommand("leak-secret.mjs")}
  ready: tcp
env:
  DATABASE_URL: "postgres://app:{secret.pg}@127.0.0.1:{port.pg}/{db.name}"
`,
        "base",
        harness.worktree,
      );
      const error = await leaking.start_app().then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ChildExitedBeforeReadyError);
      expect(String(error)).not.toContain(secret);
      expect(String(error)).toContain("[redacted]");
      await attempt.destroy();
      await preview.destroy();
      await leaking.destroy();
    } finally {
      await harness.cleanup();
    }
  }, 20_000);

  it("resolves documented placeholders and rejects an unknown one before launch", () => {
    const vault = new MapSecretVault({ pg: "vault-secret-pg-value" });
    const resolved = resolveTemplate(
      "postgres://app:{secret.pg}@{host}/{db.name}",
      {
        host: "env-abc.localhost",
        "db.name": "env_abc",
      },
      vault,
    );
    expect(resolved).toBe("postgres://app:vault-secret-pg-value@env-abc.localhost/env_abc");
    expect(() => resolveTemplate("{port.missing}", {}, vault)).toThrow(/port\.missing/);
  });

  it("releases dead-environment leases, reconciles orphaned processes, and deletes only stale temp folders", async () => {
    const harness = await createHarness();
    const sleeper = spawnSleeper();
    const mismatched = spawnSleeper();
    await Promise.all([once(sleeper, "spawn"), once(mismatched, "spawn")]);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ef-reconcile-"));
    try {
      const pid = sleeper.pid;
      const mismatchedPid = mismatched.pid;
      if (pid === undefined || mismatchedPid === undefined)
        throw new Error("sleeper did not start");
      harness.jobs.liveIdentities.set(pid, 1_700_000_100_000);
      harness.jobs.liveIdentities.set(mismatchedPid, 1_700_009_000_000);
      harness.envProcesses.insert({
        pid,
        startTime: 1_700_000_100_000,
        environment: "env_dead",
        role: "app",
        port: 41010,
        jobName: "environment:env_dead",
      });
      harness.envProcesses.insert({
        pid: mismatchedPid,
        startTime: 1_700_000_100_000,
        environment: "env_dead",
        role: "worker",
        port: null,
        jobName: null,
      });
      harness.envProcesses.insert({
        pid: process.pid,
        startTime: 1,
        environment: "env_unknown",
        role: "app",
        port: null,
        jobName: null,
      });
      harness.portLeases.leaseNext({
        projectId: "project-1",
        environmentId: "env_dead",
        leasedAt: 10,
        expiresAt: 20,
        skip: new Set(),
      });
      const livePort = harness.portLeases.leaseNext({
        projectId: "project-1",
        environmentId: "env_live",
        leasedAt: 10,
        expiresAt: 20,
        skip: new Set([41000]),
      });
      await writeOwned(root, "env_dead");
      await writeOwned(root, "env_live");

      const report = await harness.orchestrator.reconcileOnStartup({
        liveEnvironmentIds: ["env_live"],
        workspaceRoots: [root],
      });

      expect(report.orphanReport.terminated.map((record) => record.pid)).toContain(pid);
      expect(
        report.orphanReport.skipped.some((skip) => skip.reason === "start_time mismatch"),
      ).toBe(true);
      expect(harness.jobs.warnings.some((warning) => warning.includes("start_time mismatch"))).toBe(
        true,
      );
      expect(
        harness.jobs.warnings.some((warning) => warning.includes("ownership not established")),
      ).toBe(true);
      expect(isAlive(mismatchedPid)).toBe(true);
      expect(isAlive(process.pid)).toBe(true);
      const remaining = harness.envProcesses.list();
      expect(remaining.some((record) => record.pid === pid)).toBe(false);
      expect(remaining.some((record) => record.pid === mismatchedPid)).toBe(false);
      expect(remaining.some((record) => record.pid === process.pid)).toBe(true);
      const ports = harness.portLeases.list();
      expect(ports.map((row) => row.environment)).toEqual(["env_live"]);
      expect(ports[0]?.port).toBe(livePort);
      await expect(fs.access(path.join(root, ENV_DIRECTORY_NAME, "env_dead"))).rejects.toThrow();
      await expect(
        fs.access(path.join(root, ENV_DIRECTORY_NAME, "env_live", "owned.json")),
      ).resolves.toBeUndefined();
    } finally {
      sleeper.kill();
      mismatched.kill();
      await harness.cleanup();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("retries directory deletion when Windows reports EBUSY", async () => {
    let attempts = 0;
    const target = path.join(os.tmpdir(), `ef-busy-${Date.now()}`);
    await removeDirectoryWithBusyRetry(target, {
      attempts: 4,
      delayMs: 0,
      remove: async () => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error("busy") as NodeJS.ErrnoException;
          error.code = "EBUSY";
          throw error;
        }
      },
    });
    expect(attempts).toBe(3);
  });

  it("reads a Windows netstat listening line without confusing a longer port", () => {
    const output = [
      "  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       4812",
      "  TCP    0.0.0.0:30001          0.0.0.0:0              LISTENING       99",
      "  TCP    [::]:3000              [::]:0                 LISTENING       4812",
    ].join("\n");
    expect(parseListeningPid(output, 3000)).toBe(4812);
    expect(parseListeningPid(output, 30001)).toBe(99);
  });

  it("starts a stdout-probed service and a tier 1 sqlite namespace without a TCP port", async () => {
    const harness = await createHarness();
    try {
      const handle = await harness.orchestrator.create(
        "attempt",
        `
tier: 1
services: [sqlite, postgres]
extraServices:
  watcher:
    start: ${yamlCommand("stdout-ready.mjs")}
    ready: stdout /service-ready/
env: {}
`,
        "base",
        harness.worktree,
      );
      expect(handle.tier).toBe(1);
      expect(handle.ports.pg).toBeUndefined();
      expect(harness.providers.get("postgres")?.provisions).toHaveLength(0);
      expect(harness.providers.get("sqlite")?.provisions).toHaveLength(1);
      const sqliteUrl = handle.urls.sqlite ?? "";
      expect(sqliteUrl.startsWith("file://")).toBe(true);
      await expect(fs.access(sqliteUrl.slice("file://".length))).resolves.toBeUndefined();
      const url = await handle.start_service("watcher");
      expect(url).toContain(handle.host);
      await handle.destroy();

      const migration = await harness.orchestrator.create(
        "migration",
        "services: [postgres]\nenv: {}\n",
        "base",
        harness.worktree,
      );
      expect(migration.tier).toBe(3);
      await migration.reset_data();
      expect(harness.providers.get("postgres")?.resets).toBe(1);
      await migration.destroy();
    } finally {
      await harness.cleanup();
    }
  });
});

async function readTree(directory: string): Promise<string> {
  const chunks: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        chunks.push(await fs.readFile(full, "utf8"));
      }
    }
  }
  await walk(directory);
  return chunks.join("\n");
}

async function writeOwned(root: string, environmentId: string): Promise<void> {
  const directory = path.join(root, ENV_DIRECTORY_NAME, environmentId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "owned.json"),
    `${JSON.stringify({ environmentId, projectId: "project-1", createdAt: 1 })}\n`,
    "utf8",
  );
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error) return false;
    return false;
  }
}
