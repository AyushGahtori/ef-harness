import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CapturingLogger,
  SqliteProjectStateDb,
  WindowsJobManager,
  type JobAccounting,
  type JobLimits,
} from "../../src/job-objects/index.js";

const describeWindows = process.platform === "win32" ? describe : describe.skip;
const GIB = 1024 * 1024 * 1024;

describeWindows("Windows job objects", () => {
  it("sets kill-on-close, UI handle restrictions, CPU rate, and clamps weaker nested limits", async () => {
    await withManager(async (manager) => {
      const parent = await manager.createJob({
        name: "project",
        kind: "project",
        limits: { memoryBytes: 64 * 1024 * 1024, activeProcessLimit: 8, cpuRatePercent: 30 },
      });
      const accounting = await manager.queryJobAccounting(parent);
      expect(accounting.killOnJobClose).toBe(true);
      expect(accounting.uiHandlesRestricted).toBe(true);
      expect(accounting.limitFlags & 0x2000).not.toBe(0);
      expect(accounting.uiRestrictions & 0x1).not.toBe(0);
      expect(accounting.cpuRatePercent).toBe(30);
      expect(accounting.jobMemoryLimitBytes).toBe(64 * 1024 * 1024);
      expectIntegers(accounting);

      const weaker = await manager.createJob({
        name: "environment",
        kind: "environment",
        parent,
        limits: { memoryBytes: 256 * 1024 * 1024, activeProcessLimit: 64 },
      });
      expect(weaker.limitsClamped).toBe(true);
      expect(weaker.limits.memoryBytes).toBe(64 * 1024 * 1024);
      expect(weaker.limits.activeProcessLimit).toBe(8);
      expect(weaker.limits.cpuRatePercent).toBe(30);
      const weakerAccounting = await manager.queryJobAccounting(weaker);
      expect(weakerAccounting.jobMemoryLimitBytes).toBe(64 * 1024 * 1024);
      expect(weakerAccounting.activeProcessLimit).toBe(8);

      const stricter = await manager.createJob({
        name: "attempt",
        kind: "attempt",
        parent: weaker,
        timeoutMs: 30_000,
        limits: { memoryBytes: 32 * 1024 * 1024, activeProcessLimit: 4, cpuRatePercent: 15 },
      });
      expect(stricter.limitsClamped).toBe(false);
      expect((await manager.queryJobAccounting(stricter)).cpuRatePercent).toBe(15);
      expect((await manager.queryJobAccounting(stricter)).activeProcessLimit).toBe(4);
    });
  }, 30_000);

  it("assigns a suspended process before it can run", async () => {
    const marker = tempFile("marker");
    const script = writeScript(
      "suspend",
      `import fs from "node:fs";
fs.writeFileSync(process.argv[2], "ran");
setInterval(() => {}, 100000);`,
    );
    await withManager(async (manager, db) => {
      const job = await manager.createJob(project("suspend"));
      const spawned = await manager.spawnInJob(job, {
        file: process.execPath,
        args: [script, marker],
        environment: "suspend",
        role: "command",
        port: 41234,
        resume: false,
      });
      await delay(400);
      expect(fs.existsSync(marker)).toBe(false);
      expect(db.listEnvProcesses()).toEqual([
        {
          pid: spawned.pid,
          startTime: spawned.startTime,
          environment: "suspend",
          role: "command",
          port: 41234,
          jobName: "suspend",
        },
      ]);
      expect((await manager.listJobProcesses(job)).some((entry) => entry.pid === spawned.pid)).toBe(true);
      await manager.resume(spawned);
      expect(await waitUntil(() => fs.existsSync(marker), 4000)).toBe(true);
    });
  }, 20_000);

  it("kills a detached grandchild and a start /b grandchild when the command job closes", async () => {
    const sleeper = writeScript(
      "sleeper",
      `import fs from "node:fs";
fs.writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);`,
    );
    const detached = writeScript(
      "detached",
      `import { spawn } from "node:child_process";
import fs from "node:fs";
const pidFile = process.argv[2];
const sleeper = process.argv[3];
const child = spawn(process.execPath, [sleeper, pidFile], { detached: true, stdio: "ignore", windowsHide: true });
child.unref();
const deadline = Date.now() + 8000;
while (!fs.existsSync(pidFile)) {
  if (Date.now() > deadline) process.exit(2);
  await new Promise((resolve) => setTimeout(resolve, 30));
}
process.exit(0);`,
    );
    const started = writeScript(
      "startb",
      `import { spawn } from "node:child_process";
import fs from "node:fs";
const pidFile = process.argv[2];
const sleeper = process.argv[3];
const shell = process.env.ComSpec ?? "cmd.exe";
const child = spawn(shell, ["/d", "/c", "start", "/b", "", process.execPath, sleeper, pidFile], {
  detached: true,
  stdio: "ignore",
  windowsHide: true,
});
child.unref();
const deadline = Date.now() + 8000;
while (!fs.existsSync(pidFile)) {
  if (Date.now() > deadline) process.exit(2);
  await new Promise((resolve) => setTimeout(resolve, 30));
}
process.exit(0);`,
    );
    await withManager(async (manager) => {
      await expectTreeDead(manager, detached, sleeper);
      await expectTreeDead(manager, started, sleeper);
    });
  }, 30_000);

  it("keeps an environment service alive when a nested command job closes", async () => {
    const sleeper = writeScript(
      "svc",
      `import fs from "node:fs";
fs.writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);`,
    );
    const command = writeScript(
      "cmd-tree",
      `import { spawn } from "node:child_process";
import fs from "node:fs";
const pidFile = process.argv[2];
const sleeper = process.argv[3];
const child = spawn(process.execPath, [sleeper, pidFile], { detached: true, stdio: "ignore", windowsHide: true });
child.unref();
const deadline = Date.now() + 8000;
while (!fs.existsSync(pidFile)) {
  if (Date.now() > deadline) process.exit(2);
  await new Promise((resolve) => setTimeout(resolve, 30));
}
process.exit(0);`,
    );
    const servicePidFile = tempFile("service");
    const grandchildPidFile = tempFile("grand");
    await withManager(async (manager) => {
      const project = await manager.createJob({
        name: "project-svc",
        kind: "project",
        limits: { memoryBytes: GIB, activeProcessLimit: 32 },
      });
      const environment = await manager.createJob({
        name: "env-svc",
        kind: "environment",
        parent: project,
        limits: { memoryBytes: 512 * 1024 * 1024, activeProcessLimit: 16 },
      });
      await manager.spawnInJob(environment, {
        file: process.execPath,
        args: [sleeper, servicePidFile],
        environment: "env-svc",
        role: "service",
      });
      expect(await waitUntil(() => fs.existsSync(servicePidFile), 4000)).toBe(true);
      const servicePid = Number(fs.readFileSync(servicePidFile, "utf8"));
      const result = await manager.runCommand(environment, {
        file: process.execPath,
        args: [command, grandchildPidFile, sleeper],
        timeoutMs: 10_000,
        limits: { memoryBytes: 256 * 1024 * 1024, activeProcessLimit: 8 },
        environment: "env-svc",
        role: "command",
      });
      expect(result.reason).toBe("exited");
      expect(result.exitCode).toBe(0);
      const grandchildPid = Number(fs.readFileSync(grandchildPidFile, "utf8"));
      expect(await waitUntil(() => !isAlive(grandchildPid), 2000)).toBe(true);
      expect(isAlive(servicePid)).toBe(true);
      await manager.terminateJob(environment);
      expect(await waitUntil(() => !isAlive(servicePid), 2000)).toBe(true);
    });
  }, 30_000);

  it("stops a fork bomb at the active process limit", async () => {
    const out = tempFile("bomb");
    const script = writeScript(
      "bomb",
      `import { spawn } from "node:child_process";
import fs from "node:fs";
const out = process.argv[2];
let ok = 0;
let fail = 0;
for (let i = 0; i < 16; i += 1) {
  let child;
  try {
    child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    fail += 1;
    continue;
  }
  const failed = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 50);
    child.once("error", () => { clearTimeout(timer); resolve(true); });
    child.once("exit", () => { clearTimeout(timer); resolve(true); });
  });
  if (failed || !child.pid) fail += 1;
  else ok += 1;
}
fs.writeFileSync(out, JSON.stringify({ ok, fail }));
setInterval(() => {}, 1000000);`,
    );
    await withManager(async (manager) => {
      const job = await manager.createJob({
        name: "bomb",
        kind: "attempt",
        timeoutMs: 60_000,
        limits: { memoryBytes: GIB, activeProcessLimit: 8 },
      });
      await manager.spawnInJob(job, {
        file: process.execPath,
        args: [script, out],
        environment: "bomb",
        role: "attempt",
      });
      expect(await waitUntil(() => fs.existsSync(out), 45_000)).toBe(true);
      const result = JSON.parse(fs.readFileSync(out, "utf8")) as { ok: number; fail: number };
      const nodes = (await manager.listJobProcesses(job)).filter((entry) =>
        (entry.imagePath ?? "").toLowerCase().endsWith("node.exe"),
      );
      expect(result.fail).toBeGreaterThan(0);
      expect(result.ok).toBeLessThanOrEqual(7);
      expect(nodes.length).toBeLessThanOrEqual(8);
      expect(nodes.length).toBeGreaterThan(0);
      const probe = spawn(process.execPath, ["-e", "process.exit(0)"], { windowsHide: true });
      const code = await new Promise<number | null>((resolve) => {
        probe.once("exit", (exitCode) => resolve(exitCode));
      });
      expect(code).toBe(0);
    });
  }, 70_000);

  it("reports memory_limit_exceeded and timeout with integer accounting", async () => {
    const memoryScript = writeScript(
      "memory",
      `const chunks = [];
try {
  for (let i = 0; i < 40; i += 1) chunks.push(Buffer.alloc(8 * 1024 * 1024, 1));
} catch {
  process.stdout.write("alloc-failed\\n");
}
process.stdout.write("mem-done\\n");
process.exit(0);`,
    );
    const hangScript = writeScript(
      "hang",
      `process.stdout.write("partial-line\\n");
const end = Date.now() + 250;
while (Date.now() < end) {}
setInterval(() => {}, 100000);`,
    );
    await withManager(async (manager) => {
      const memory = await manager.runCommand(null, {
        file: process.execPath,
        args: [memoryScript],
        timeoutMs: 20_000,
        limits: { memoryBytes: 96 * 1024 * 1024, activeProcessLimit: 8 },
        environment: "mem",
        role: "command",
      });
      expect(memory.reason).toBe("memory_limit_exceeded");
      expect(memory.accounting.memoryLimitHit).toBe(true);
      expect(memory.accounting.peakJobMemoryBytes).toBeGreaterThan(8 * 1024 * 1024);
      expectIntegers(memory.accounting);

      const timed = await manager.runCommand(null, {
        file: process.execPath,
        args: [hangScript],
        timeoutMs: 800,
        limits: { memoryBytes: GIB, activeProcessLimit: 8 },
        environment: "time",
        role: "command",
      });
      expect(timed.reason).toBe("timeout");
      expect(timed.stdout).toContain("partial-line");
      expect(timed.durationMs).toBeGreaterThanOrEqual(700);
      expect(timed.accounting.userCpuMs + timed.accounting.kernelCpuMs).toBeGreaterThan(0);
      expect(timed.accounting.activeProcesses).toBe(0);
      expectIntegers(timed.accounting);
    });
  }, 40_000);

  it("reaps a matching orphan and refuses a reused pid", async () => {
    const sleeper = writeScript(
      "orphan",
      `setInterval(() => {}, 1000);`,
    );
    await withManager(async (manager, db, logger) => {
      const job = await manager.createJob(project("orphan"));
      const spawned = await manager.spawnInJob(job, {
        file: process.execPath,
        args: [sleeper],
        environment: "orphan",
        role: "service",
      });
      expect(isAlive(spawned.pid)).toBe(true);
      const killed = await manager.reconcileOrphanedProcesses();
      expect(killed.terminated.map((entry) => entry.pid)).toContain(spawned.pid);
      expect(await waitUntil(() => !isAlive(spawned.pid), 2000)).toBe(true);
      expect(db.listEnvProcesses().some((entry) => entry.pid === spawned.pid)).toBe(false);

      const self = await manager.inspectProcess(process.pid);
      expect(self.status).toBe("alive");
      if (self.status !== "alive") return;
      db.insertEnvProcess({
        pid: process.pid,
        startTime: 1,
        environment: "stale",
        role: "orphan",
        port: null,
        jobName: null,
      });
      const skipped = await manager.reconcileOrphanedProcesses();
      expect(isAlive(process.pid)).toBe(true);
      expect(skipped.skipped.some((entry) => entry.pid === process.pid)).toBe(true);
      expect(db.listEnvProcesses().some((entry) => entry.pid === process.pid)).toBe(false);
      expect(
        logger.entries.some(
          (entry) => entry.level === "warn" && entry.message.includes("start_time"),
        ),
      ).toBe(true);

      const finished = await manager.spawnInJob(job, {
        file: commandShell(),
        args: ["/d", "/c", "exit"],
        environment: "done",
        role: "command",
      });
      expect(await manager.waitForExit(finished, 5000)).not.toBeNull();
      const swept = await manager.reconcileOrphanedProcesses();
      expect(swept.alreadyExited.some((entry) => entry.pid === finished.pid)).toBe(true);
    });
  }, 30_000);

  it("keeps the native handle count flat across 200 spawn and close cycles", async () => {
    await withManager(async (manager, db) => {
      await cycle(manager);
      const before = await manager.nativeHandleCount();
      for (let index = 0; index < 200; index += 1) await cycle(manager);
      const after = await manager.nativeHandleCount();
      expect(after).toBeLessThanOrEqual(before + 2);
      expect(db.listEnvProcesses()).toEqual([]);
    });
  }, 60_000);

  it("kills the job tree when the owning helper is destroyed", async () => {
    const pidFile = tempFile("abandon");
    const sleeper = writeScript(
      "abandon",
      `import fs from "node:fs";
fs.writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);`,
    );
    const db = new SqliteProjectStateDb(tempDb());
    const manager = new WindowsJobManager({ registry: db, logger: new CapturingLogger() });
    try {
      const job = await manager.createJob(project("abandon"));
      await manager.spawnInJob(job, {
        file: process.execPath,
        args: [sleeper, pidFile],
        environment: "abandon",
        role: "service",
      });
      expect(await waitUntil(() => fs.existsSync(pidFile), 4000)).toBe(true);
      const pid = Number(fs.readFileSync(pidFile, "utf8"));
      expect(isAlive(pid)).toBe(true);
      await manager.abandon();
      expect(await waitUntil(() => !isAlive(pid), 2000)).toBe(true);
    } finally {
      db.close();
    }
  }, 20_000);

  it("kills the job tree when the parent process exits", async () => {
    const pidFile = tempFile("parent");
    const dbFile = tempFile("parent.db");
    const sleeper = writeScript(
      "parent-sleeper",
      `import fs from "node:fs";
fs.writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);`,
    );
    const fixture = fileURLToPath(new URL("./parent-exit.ts", import.meta.url));
    const tsxLoader = fileURLToPath(
      new URL("../../../../node_modules/tsx/dist/esm/index.mjs", import.meta.url),
    );
    let childOutput = "";
    const child = spawn(
      process.execPath,
      ["--import", pathToFileURL(tsxLoader).href, fixture, pidFile, dbFile, sleeper],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      childOutput += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      childOutput += chunk;
    });
    const exitCode = await new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code));
    });
    expect(exitCode, childOutput).toBe(0);
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    expect(await waitUntil(() => !isAlive(pid), 3000)).toBe(true);
  }, 20_000);
});

async function expectTreeDead(manager: WindowsJobManager, script: string, sleeper: string): Promise<void> {
  const pidFile = tempFile("tree");
  const result = await manager.runCommand(null, {
    file: process.execPath,
    args: [script, pidFile, sleeper],
    timeoutMs: 12_000,
    limits: { memoryBytes: 512 * 1024 * 1024, activeProcessLimit: 16 },
    environment: "tree",
    role: "command",
  });
  expect(result.exitCode).toBe(0);
  expect(result.reason).toBe("exited");
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  expect(await waitUntil(() => !isAlive(pid), 2000)).toBe(true);
}

async function cycle(manager: WindowsJobManager): Promise<void> {
  const job = await manager.createJob(project(`cycle-${Date.now()}`));
  const spawned = await manager.spawnInJob(job, {
    file: commandShell(),
    args: ["/d", "/c", "exit"],
    environment: "cycle",
    role: "command",
  });
  expect(await manager.waitForExit(spawned, 5000)).not.toBeNull();
  await manager.closeJob(job);
}

async function withManager(
  fn: (manager: WindowsJobManager, db: SqliteProjectStateDb, logger: CapturingLogger) => Promise<void>,
): Promise<void> {
  const db = new SqliteProjectStateDb(tempDb());
  const logger = new CapturingLogger();
  const manager = new WindowsJobManager({ registry: db, logger });
  try {
    await fn(manager, db, logger);
  } finally {
    await manager.dispose();
    db.close();
  }
}

function project(name: string): {
  name: string;
  kind: "project";
  limits: JobLimits;
} {
  return {
    name,
    kind: "project",
    limits: { memoryBytes: GIB, activeProcessLimit: 32 },
  };
}

function expectIntegers(accounting: JobAccounting): void {
  for (const [key, value] of Object.entries(accounting)) {
    if (typeof value === "number") expect(Number.isInteger(value), key).toBe(true);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return false;
    await delay(30);
  }
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function commandShell(): string {
  return process.env["ComSpec"] ?? "C:\\Windows\\System32\\cmd.exe";
}

function tempDb(): string {
  return path.join(os.tmpdir(), `ef-job-${process.pid}-${Math.random().toString(16).slice(2)}.db`);
}

function tempFile(name: string): string {
  return path.join(os.tmpdir(), `ef-job-${name}-${process.pid}-${Math.random().toString(16).slice(2)}`);
}

function writeScript(name: string, source: string): string {
  const file = `${tempFile(name)}.mjs`;
  fs.writeFileSync(file, source);
  return file;
}
