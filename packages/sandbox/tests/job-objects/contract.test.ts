import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CapturingLogger,
  MAX_SETTIMEOUT_MS,
  PosixProcessGroupSupervisor,
  ProcessIdentityVerifier,
  SqliteProjectStateDb,
  assertJobLimits,
  clampNestedLimits,
  delayFor,
  killPosixProcessGroup,
  quoteWindowsArgument,
  reconcileOrphanedProcesses,
  type EnvProcessRow,
  type JobLimits,
  type PosixChild,
  type PosixHost,
  type ProcessInspection,
} from "../../src/job-objects/index.js";

const limits: JobLimits = { memoryBytes: 64 * 1024 * 1024, activeProcessLimit: 8 };

describe("job object contracts", () => {
  it("clamps nested limits to the stricter parent cap", () => {
    const parent: JobLimits = { memoryBytes: 64, activeProcessLimit: 8, cpuRatePercent: 20 };
    const child: JobLimits = { memoryBytes: 256, activeProcessLimit: 32, cpuRatePercent: 80 };
    const clamped = clampNestedLimits(child, parent);
    expect(clamped.clamped).toBe(true);
    expect(clamped.effective).toEqual({
      memoryBytes: 64,
      activeProcessLimit: 8,
      cpuRatePercent: 20,
    });
    expect(
      clampNestedLimits(
        { memoryBytes: 32, activeProcessLimit: 4, cpuRatePercent: 10 },
        parent,
      ).clamped,
    ).toBe(false);
    expect(() => assertJobLimits({ memoryBytes: 0, activeProcessLimit: 1 }, "command")).toThrow(
      /memoryBytes/,
    );
  });

  it("quotes Windows arguments without dropping spaces", () => {
    expect(quoteWindowsArgument("plain")).toBe("plain");
    expect(quoteWindowsArgument("C:\\Program Files\\node.exe")).toBe('"C:\\Program Files\\node.exe"');
    expect(quoteWindowsArgument('say "hi"')).toBe('"say \\"hi\\""');
  });

  it("records env_processes atomically and rolls back a failed batch", () => {
    const db = new SqliteProjectStateDb(tempDb());
    try {
      const first: EnvProcessRow = row(10, 1000);
      db.insertEnvProcess(first);
      expect(() => db.insertEnvProcesses([row(11, 1001), first])).toThrow();
      expect(db.listEnvProcesses()).toEqual([first]);
      db.insertEnvProcess(row(10, 1002));
      expect(db.listEnvProcesses()).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it("kills only a positive pid and start_time match", async () => {
    const db = new SqliteProjectStateDb(tempDb());
    const logger = new CapturingLogger();
    const killed: number[] = [];
    const processes = new Map<number, ProcessInspection>([
      [4812, { status: "alive", pid: 4812, startTime: 1_700_009_000_000, imagePath: "C:\\Windows\\explorer.exe", commandLine: "explorer.exe" }],
      [50, { status: "alive", pid: 50, startTime: 1_700_000_100_000, imagePath: "node.exe", commandLine: "node sleeper.js" }],
      [77, { status: "unverified", pid: 77, detail: "access denied" }],
    ]);
    db.insertEnvProcess(row(4812, 1_700_000_100_000, "stale"));
    db.insertEnvProcess(row(50, 1_700_000_100_000, "orphan"));
    db.insertEnvProcess(row(77, 1, "hidden"));
    db.insertEnvProcess(row(999999, 1, "gone"));
    try {
      const report = await reconcileOrphanedProcesses({
        registry: db,
        logger,
        inspect: (pid) => processes.get(pid) ?? { status: "not_found", pid },
        terminate: (pid, startTime) => {
          const live = processes.get(pid);
          if (!live || live.status !== "alive" || live.startTime !== startTime) {
            return live ?? { status: "not_found", pid };
          }
          killed.push(pid);
          return "terminated";
        },
      });
      expect(killed).toEqual([50]);
      expect(report.terminated.map((entry) => entry.pid)).toEqual([50]);
      expect(report.skipped.map((entry) => entry.pid)).toEqual([4812]);
      expect(report.leftIntact.map((entry) => entry.pid)).toEqual([77]);
      expect(report.alreadyExited.map((entry) => entry.pid)).toEqual([999999]);
      expect(db.listEnvProcesses().map((entry) => entry.pid)).toEqual([77]);
      expect(logger.entries.some((entry) => entry.level === "warn" && entry.message.includes("start_time"))).toBe(
        true,
      );
    } finally {
      db.close();
    }
  });

  it("uses a detached process group and kills by negative pgid", async () => {
    const kills: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    killPosixProcessGroup(4242, "SIGKILL", (pid, signal) => {
      kills.push({ pid, signal });
    });
    expect(kills).toEqual([{ pid: -4242, signal: "SIGKILL" }]);

    const db = new SqliteProjectStateDb(tempDb());
    const spawned: Array<{ detached: boolean }> = [];
    let nextPid = 4242;
    const host: PosixHost = {
      spawn: (spec) => {
        spawned.push({ detached: spec.detached });
        const pid = nextPid;
        nextPid += 1;
        const child: PosixChild = {
          pid,
          wait: () => Promise.resolve({ exited: false, exitCode: null, stdout: "partial", stderr: "" }),
        };
        return child;
      },
      killGroup: (pid, signal) => {
        kills.push({ pid, signal });
      },
      inspect: (pid) => ({ status: "not_found", pid }),
      terminate: (pid) => ({ status: "not_found", pid }),
    };
    const supervisor = new PosixProcessGroupSupervisor(db, host);
    try {
      const job = await supervisor.createJob({
        name: "posix-cap",
        kind: "command",
        limits: { memoryBytes: 1024, activeProcessLimit: 1 },
        timeoutMs: 50,
      });
      await supervisor.spawnInJob(job, {
        file: "node",
        args: ["sleeper"],
        environment: "posix",
        role: "command",
      });
      await expect(
        supervisor.spawnInJob(job, {
          file: "node",
          args: ["another"],
          environment: "posix",
          role: "command",
        }),
      ).rejects.toThrow(/process cap/);
      const result = await supervisor.runCommand(null, {
        file: "node",
        args: ["hung"],
        timeoutMs: 20,
        limits,
        environment: "posix",
        role: "command",
      });
      expect(spawned.every((entry) => entry.detached)).toBe(true);
      expect(result.reason).toBe("timeout");
      expect(result.stdout).toBe("partial");
      expect(kills.some((entry) => entry.signal === "SIGKILL")).toBe(true);
    } finally {
      await supervisor.dispose();
      db.close();
    }
  });

  it("caps attempt timers at the 32-bit ceiling and requires command timeouts", async () => {
    expect(delayFor(3_000_000_000)).toBe(MAX_SETTIMEOUT_MS);
    expect(delayFor(40)).toBe(40);
    const kills: number[] = [];
    const db = new SqliteProjectStateDb(tempDb());
    const host: PosixHost = {
      spawn: () => {
        const child: PosixChild = {
          pid: 77,
          wait: () => Promise.resolve({ exited: false, exitCode: null, stdout: "", stderr: "" }),
        };
        return child;
      },
      killGroup: (pid) => {
        kills.push(pid);
      },
      inspect: (pid) => ({ status: "not_found", pid }),
      terminate: (pid) => ({ status: "not_found", pid }),
    };
    const supervisor = new PosixProcessGroupSupervisor(db, host);
    try {
      await expect(
        supervisor.createJob({ name: "missing-timeout", kind: "command", limits }),
      ).rejects.toThrow(/timeoutMs/);
      const job = await supervisor.createJob({
        name: "long-attempt",
        kind: "attempt",
        limits,
        timeoutMs: 3_000_000_000,
      });
      await supervisor.spawnInJob(job, {
        file: "node",
        args: ["sleep"],
        environment: "long",
        role: "attempt",
      });
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      expect(kills).toEqual([]);
    } finally {
      await supervisor.dispose();
      db.close();
    }
  });

  it("treats the documented pid 4812 reboot as reuse and refuses an unverified process", async () => {
    const verifier = new ProcessIdentityVerifier((pid) => {
      if (pid === 4812) {
        return {
          status: "alive",
          pid,
          startTime: 1_700_009_000_000,
          imagePath: "C:\\Windows\\explorer.exe",
          commandLine: "explorer.exe",
        };
      }
      return { status: "unverified", pid, detail: "access denied" };
    });
    const reused = await verifier.verify(4812, 1_700_000_100_000);
    expect(reused.verdict).toBe("pid_reused");
    if (reused.verdict === "pid_reused") {
      expect(reused.live.imagePath).toContain("explorer.exe");
    }
    expect((await verifier.verify(77, 1)).verdict).toBe("unverified");
    expect((await verifier.verify(12, 1)).verdict).toBe("unverified");
  });
});

function row(pid: number, startTime: number, environment = "env"): EnvProcessRow {
  return {
    pid,
    startTime,
    environment,
    role: "command",
    port: null,
    jobName: "job",
  };
}

function tempDb(): string {
  return path.join(os.tmpdir(), `ef-job-contract-${process.pid}-${Math.random().toString(16).slice(2)}.db`);
}
