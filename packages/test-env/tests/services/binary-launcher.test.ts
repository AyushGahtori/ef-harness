import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EmbeddedPostgresBinaryLauncher,
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME,
  MailpitBinaryLauncher,
  NodeBinaryLauncher,
  RedisBinaryLauncher,
  TrackingWindowsJobManager,
  existingComponent,
  pidIsAlive,
  renderRedisIsolationConfig,
  reserveLoopbackPort,
  type RedisServerKind,
} from "../../src/services/index.js";

describe("project service job ownership", () => {
  it("assigns a native child to a kill-on-close job and terminates it", async () => {
    const jobs = new TrackingWindowsJobManager();
    const launcher = new NodeBinaryLauncher();
    const job = await jobs.createJob("project-service:probe", { killOnJobClose: true });
    expect(job.killOnCloseFlag).toBe(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME);
    expect(job.nativeLimit).toBe(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE);
    const proc = await launcher.spawn({
      binary: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      job,
      jobManager: jobs,
    });
    expect(jobs.assignments).toContainEqual({ jobId: job.id, pid: proc.pid });
    expect(pidIsAlive(proc.pid)).toBe(true);
    const accounting = await jobs.queryJobAccounting(job);
    expect(accounting.native).toBe(true);
    try {
      await jobs.terminateJob(job);
      const exitCode = await Promise.race([
        proc.waitForExit(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
      ]);
      expect(exitCode === null && pidIsAlive(proc.pid)).toBe(false);
    } finally {
      if (pidIsAlive(proc.pid)) {
        try {
          process.kill(proc.pid);
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? error.code : "";
          if (code !== "ESRCH") throw error;
        }
      }
    }
  }, 20_000);
});

describe("real backing binaries", () => {
  const postgres = existingComponent("postgres");
  const mailpit = existingComponent("mailpit");
  const garnet = existingComponent("garnet");
  const memurai = existingComponent("memurai");

  it.skipIf(!postgres)("starts embedded postgres under the project job and answers SQL", async () => {
    const root = await mkdirTemp("pg-real-");
    const jobs = new TrackingWindowsJobManager();
    const job = await jobs.createJob("project-service:pg-real", { killOnJobClose: true });
    const port = await reserveLoopbackPort();
    const dataDir = path.join(root, "pg");
    await mkdir(dataDir, { recursive: true });
    const runtime = await new EmbeddedPostgresBinaryLauncher().launch({
      projectId: "real",
      dataDir,
      port,
      job,
      jobManager: jobs,
    });
    try {
      const session = await runtime.connect();
      const rows = await session.query(LIVE_EXTENSION_PROBE);
      expect(rows.length).toBeGreaterThan(0);
      await session.close();
    } finally {
      await runtime.stop();
      await jobs.terminateJob(job);
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it.skipIf(!mailpit)("starts Mailpit on loopback under the project job", async () => {
    const jobs = new TrackingWindowsJobManager();
    const job = await jobs.createJob("project-service:mail-real", { killOnJobClose: true });
    const smtpPort = await reserveLoopbackPort();
    const httpPort = await reserveLoopbackPort();
    const runtime = await new MailpitBinaryLauncher().launch({
      projectId: "real",
      smtpPort,
      httpPort,
      job,
      jobManager: jobs,
    });
    try {
      const response = await fetch(`http://127.0.0.1:${runtime.httpPort}/api/v1/messages`);
      expect(response.ok).toBe(true);
    } finally {
      await runtime.stop();
      await jobs.terminateJob(job);
    }
  }, 30_000);

  it.skipIf(!garnet && !memurai)("starts the chosen Redis binary behind the command guard", async () => {
    const server: RedisServerKind = garnet ? "garnet" : "memurai";
    const jobs = new TrackingWindowsJobManager();
    const job = await jobs.createJob("project-service:redis-real", { killOnJobClose: true });
    const root = await mkdirTemp("redis-real-");
    const dataDir = path.join(root, "redis");
    await mkdir(dataDir, { recursive: true });
    const backendPort = await reserveLoopbackPort();
    const configPath = path.join(dataDir, "redis.conf");
    const configText = renderRedisIsolationConfig({ server, port: backendPort, dataDir });
    await writeFile(configPath, configText, "utf8");
    const runtime = await new RedisBinaryLauncher().launch({
      projectId: "real",
      serverKey: "redis-0",
      dataDir,
      backendPort,
      job,
      jobManager: jobs,
      server,
      configText,
      configPath,
    });
    try {
      expect(pidIsAlive(runtime.pid)).toBe(true);
    } finally {
      await runtime.stop();
      await jobs.terminateJob(job);
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

const LIVE_EXTENSION_PROBE = "SELECT name FROM pg_available_extensions WHERE name = 'plpgsql'";

function mkdirTemp(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
