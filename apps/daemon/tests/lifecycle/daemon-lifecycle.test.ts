import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DaemonShutdownCoordinator,
  LifecycleRouter,
  LocalClaimGate,
  LocalHardwareGovernor,
  LocalRetryLedger,
  LocalSleepSkewGuard,
  LocalStuckClockGuard,
  ManualClock,
  NodeSqliteCheckpoint,
  RecordingCheckpoints,
  RecordingJobObjects,
  RecordingSqlite,
  PowerLifecycleHandler,
} from "../../src/lifecycle/index.js";

function coordinatorWith(clock: ManualClock, jobs: RecordingJobObjects, sqlite: RecordingSqlite) {
  return new DaemonShutdownCoordinator({
    clock,
    claims: new LocalClaimGate(),
    checkpoints: new RecordingCheckpoints(),
    jobs,
    sqlite,
  });
}

describe("daemon lifecycle shutdown", () => {
  it("drains for at most 10s, truncates the WAL, and leaves zero orphaned processes", async () => {
    const clock = new ManualClock(0);
    const jobs = new RecordingJobObjects();
    jobs.setChildren([10, 11]);
    const sqlite = new RecordingSqlite();
    const coordinator = coordinatorWith(clock, jobs, sqlite);
    const result = await coordinator.shutdown({
      mode: "drain_and_exit",
      reason: "pause-safely-and-quit",
      deadlineMs: 999_999,
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("drain_and_exit");
    expect(result.exited).toBe(true);
    expect(result.daemonKeptRunning).toBe(false);
    expect(result.orphanedProcesses).toBe(0);
    expect(result.elapsedMs).toBeLessThanOrEqual(10_000);
    expect(result.walModes).toEqual(["PASSIVE", "TRUNCATE"]);
    expect(result.stateDbIntact).toBe(true);
    expect(sqlite.modes).toEqual(["PASSIVE", "TRUNCATE"]);
    expect(jobs.activeChildPids()).toEqual([]);
    expect(jobs.terminations).toEqual(["drain-timeout"]);
    expect(coordinator.isRunning()).toBe(false);
  });

  it("detaches the UI without killing a live build", async () => {
    const jobs = new RecordingJobObjects();
    jobs.setChildren([7]);
    const sqlite = new RecordingSqlite();
    const coordinator = coordinatorWith(new ManualClock(0), jobs, sqlite);
    const result = await coordinator.shutdown({
      mode: "detach_ui_keep_running",
      reason: "keep-building-in-background",
    });
    expect(result.daemonKeptRunning).toBe(true);
    expect(result.exited).toBe(false);
    expect(result.buildsInterrupted).toBe(false);
    expect(result.uiDetached).toBe(true);
    expect(result.walModes).toEqual([]);
    expect(jobs.activeChildPids()).toEqual([7]);
    expect(sqlite.modes).toEqual([]);
    expect(coordinator.isRunning()).toBe(true);
    expect(coordinator.isUiAttached()).toBe(false);
  });

  it("terminates an idle daemon in under a second unless children must be reaped immediately", async () => {
    const clock = new ManualClock(5);
    const jobs = new RecordingJobObjects();
    jobs.setChildren([9]);
    const coordinator = coordinatorWith(clock, jobs, new RecordingSqlite());
    const result = await coordinator.shutdown({
      mode: "drain_and_exit",
      reason: "idle-quit",
      deadlineMs: 1_000,
      idle: true,
    });
    expect(result.elapsedMs).toBeLessThan(1_000);
    expect(result.orphanedProcesses).toBe(0);
    expect(jobs.terminations).toEqual(["idle-quit"]);
    expect(result.walModes).toEqual(["PASSIVE", "TRUNCATE"]);
  });

  it("checkpoints a real SQLite WAL and keeps state.db readable", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ef-lifecycle-"));
    const db = new DatabaseSync(path.join(dir, "state.db"));
    try {
      db.exec("PRAGMA journal_mode=WAL");
      db.exec("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)");
      db.exec("INSERT INTO meta VALUES ('stream_epoch', '3')");
      const sqlite = new NodeSqliteCheckpoint(db);
      const coordinator = new DaemonShutdownCoordinator({
        clock: new ManualClock(0),
        claims: new LocalClaimGate(),
        checkpoints: new RecordingCheckpoints(),
        jobs: new RecordingJobObjects(),
        sqlite,
      });
      const result = await coordinator.shutdown({
        mode: "drain_and_exit",
        reason: "os-shutdown",
        deadlineMs: 10_000,
      });
      expect(result.stateDbIntact).toBe(true);
      expect(sqlite.modes).toEqual(["PASSIVE", "TRUNCATE"]);
      const row = db.prepare("SELECT v FROM meta WHERE k = 'stream_epoch'").get() as { v: string } | undefined;
      expect(row?.v).toBe("3");
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("daemon power lifecycle", () => {
  it("pauses clocks on suspend and compensates them on resume", async () => {
    const clocks = new LocalStuckClockGuard();
    clocks.register("worker-a", 60_000);
    const claims = new LocalClaimGate();
    const checkpoints = new RecordingCheckpoints();
    const leases = new LocalSleepSkewGuard();
    const retries = new LocalRetryLedger();
    const jobs = new RecordingJobObjects();
    const sqlite = new RecordingSqlite();
    const shutdown = new DaemonShutdownCoordinator({
      clock: new ManualClock(0),
      claims,
      checkpoints,
      jobs,
      sqlite,
    });
    const handler = new PowerLifecycleHandler({
      now: () => 0,
      claims,
      clocks,
      leases,
      retries,
      governor: new LocalHardwareGovernor(),
      shutdown,
      checkpoints,
    });
    await handler.handle({ type: "suspend", at: 1_000 });
    expect(claims.paused).toBe(true);
    expect(clocks.paused).toBe(true);
    expect(checkpoints.reasons).toContain("suspend");
    await handler.handle({
      type: "resume",
      at: 1_000 + 4 * 60 * 60 * 1000,
      sleepDurationMs: 4 * 60 * 60 * 1000,
      resumeClaiming: false,
    });
    expect(clocks.lastIgnoredSleepMs).toBe(4 * 60 * 60 * 1000);
    expect(clocks.activeMs("worker-a")).toBe(60_000);
    expect(clocks.stuckLabel("worker-a", 30 * 60 * 1000)).toBeNull();
    expect(leases.spuriousLeaseExpiries).toBe(0);
    expect(retries.burned()).toBe(0);
    expect(claims.reason).toBe("welcome-back");
  });

  it("runs the fast shutdown path and reports battery telemetry", async () => {
    const claims = new LocalClaimGate();
    const checkpoints = new RecordingCheckpoints();
    const jobs = new RecordingJobObjects();
    jobs.setChildren([3]);
    const sqlite = new RecordingSqlite();
    const governor = new LocalHardwareGovernor();
    const shutdown = new DaemonShutdownCoordinator({
      clock: new ManualClock(0),
      claims,
      checkpoints,
      jobs,
      sqlite,
    });
    const handler = new PowerLifecycleHandler({
      now: () => 0,
      claims,
      clocks: new LocalStuckClockGuard(),
      leases: new LocalSleepSkewGuard(),
      retries: new LocalRetryLedger(),
      governor,
      shutdown,
      checkpoints,
    });
    await handler.handle({ type: "lock-screen", at: 2 });
    expect(handler.isLocked()).toBe(true);
    await handler.handle({ type: "on-battery", batteryPercent: 18, ecoOnBattery: true });
    expect(governor.events[0]).toEqual({
      source: "battery",
      batteryPercent: 18,
      ecoOnBattery: true,
      ecoCap: "eco",
    });
    await handler.handle({ type: "on-ac", ecoOnBattery: true });
    expect(governor.events[1]).toMatchObject({ source: "ac", ecoOnBattery: false });
    await handler.handle({ type: "shutdown", at: 9 });
    expect(sqlite.modes).toEqual(["PASSIVE", "TRUNCATE"]);
    expect(jobs.activeChildPids()).toEqual([]);
    expect(shutdown.isRunning()).toBe(false);
    expect(checkpoints.reasons).toContain("os-shutdown");
  });
});

describe("daemon.shutdown and run.pause", () => {
  it("routes drain and detach over named-pipe methods without listening on localhost", async () => {
    const source = readFileSync(new URL("../../src/lifecycle/lifecycle-router.ts", import.meta.url), "utf8");
    expect(source.includes("createServer")).toBe(false);
    expect(source.includes("127.0.0.1")).toBe(false);
    expect(source.includes("/lifecycle/shutdown")).toBe(false);
    expect(source.includes("daemon.shutdown")).toBe(true);
    expect(source.includes("run.pause")).toBe(true);
    const claims = new LocalClaimGate();
    const jobs = new RecordingJobObjects();
    const sqlite = new RecordingSqlite();
    const checkpoints = new RecordingCheckpoints();
    const shutdown = new DaemonShutdownCoordinator({
      clock: new ManualClock(0),
      claims,
      checkpoints,
      jobs,
      sqlite,
    });
    const power = new PowerLifecycleHandler({
      now: () => 0,
      claims,
      clocks: new LocalStuckClockGuard(),
      leases: new LocalSleepSkewGuard(),
      retries: new LocalRetryLedger(),
      governor: new LocalHardwareGovernor(),
      shutdown,
      checkpoints,
    });
    const router = new LifecycleRouter(shutdown, power);
    expect(router.listensOnLocalhost).toBe(false);

    const detached = await router.handle({
      method: "daemon.shutdown",
      params: { mode: "detach_ui_keep_running", reason: "keep-building-in-background" },
    });
    expect(detached.status).toBe(200);
    if (detached.status !== 200 || !("mode" in detached.body)) return;
    expect(detached.body.daemonKeptRunning).toBe(true);

    const paused = await router.handle({ method: "run.pause", params: { reason: "user" } });
    expect(paused.status).toBe(200);
    if (paused.status === 200 && "daemonKeptRunning" in paused.body) {
      expect(paused.body.daemonKeptRunning).toBe(true);
    }

    const missing = await router.handle({ method: "lifecycle.missing", params: {} });
    expect(missing.status).toBe(404);
    const bad = await router.handle({ method: "daemon.shutdown", params: { mode: "kill" } });
    expect(bad.status).toBe(400);

    const suspended = await router.handle({
      method: "lifecycle.power",
      params: { type: "suspend", at: 4 },
    });
    expect(suspended.status).toBe(200);
    expect(claims.paused).toBe(true);

    const drained = await router.handle({
      method: "daemon.shutdown",
      params: { mode: "drain_and_exit", reason: "pause-safely-and-quit", deadlineMs: 10_000, idle: false },
    });
    expect(drained.status).toBe(200);
    if (drained.status === 200 && "walModes" in drained.body) {
      expect(drained.body.walModes).toEqual(["PASSIVE", "TRUNCATE"]);
      expect(drained.body.orphanedProcesses).toBe(0);
    }
  });
});
