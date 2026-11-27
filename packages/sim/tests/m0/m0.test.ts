import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FakeDualClock } from "../../src/m0/clock.js";
import { SimEventLoop } from "../../src/m0/event-loop.js";
import { FakeModelAdapter, MODEL_OUTCOMES, scriptedCompletion } from "../../src/m0/fake-model.js";
import { CrashFaultInjector, CrashSignal, FAULT_POINTS } from "../../src/m0/faults.js";
import { measureM0Performance } from "../../src/m0/perf.js";
import { renderM0ExitReport } from "../../src/m0/report.js";
import { runReplayCli } from "../../src/m0/replay-cli.js";
import { DeterministicSeededRng } from "../../src/m0/rng.js";
import { M0KernelSimulator, runSimulation } from "../../src/m0/simulator.js";
import { runSweep } from "../../src/m0/sweep.js";
import { SimTrace } from "../../src/m0/trace.js";
import type { SweepReport } from "../../src/m0/sweep.js";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(here, "../../src/m0");
const repoRoot = path.resolve(here, "../../../..");

describe("deterministic core", () => {
  it("reproduces one SplitMix stream from a seed", () => {
    const left = new DeterministicSeededRng(42);
    const right = new DeterministicSeededRng(42n);
    const values = [left.nextUint32(), left.nextInt(1, 50), left.nextDouble(), left.pick(["a", "b", "c"])];
    expect([right.nextUint32(), right.nextInt(1, 50), right.nextDouble(), right.pick(["a", "b", "c"])]).toEqual(values);
    expect(new DeterministicSeededRng(7).nextUint32()).not.toBe(values[0]);
    const forkA = new DeterministicSeededRng(9).fork("model");
    const forkB = new DeterministicSeededRng(9).fork("model");
    expect(forkA.nextUint64()).toBe(forkB.nextUint64());
  });

  it("keeps monotonic time still across a wall-clock sleep", () => {
    const clock = new FakeDualClock(1_700_000_000_000);
    clock.advance(25);
    clock.sleepJump(3_600_000);
    expect(clock.monoMs()).toBe(25);
    expect(clock.wallMs()).toBe(1_700_000_000_000 + 25 + 3_600_000);
  });

  it("orders events by monotonic time and then sequence", () => {
    const clock = new FakeDualClock();
    const trace = new SimTrace();
    const loop = new SimEventLoop(clock, trace, undefined);
    const seen: string[] = [];
    loop.schedule(10, "timer", () => seen.push("timer"));
    loop.schedule(0, "worker_tick", () => seen.push("worker"));
    loop.schedule(0, "grant_message", () => seen.push("grant"));
    loop.schedule(5, "sleep_jump", () => {
      clock.sleepJump(3_600_000);
      seen.push("sleep");
    });
    loop.run(() => undefined);
    expect(seen).toEqual(["worker", "grant", "sleep", "timer"]);
    expect(clock.monoMs()).toBe(10);
    expect(clock.wallMs()).toBeGreaterThan(clock.monoMs());
  });

  it("covers every scripted model outcome without leaving the process", () => {
    const script = MODEL_OUTCOMES.map((kind, index) => scriptedCompletion(kind, index % 2 === 0));
    const adapter = new FakeModelAdapter(new DeterministicSeededRng(1), new FakeDualClock(), script);
    const kinds = MODEL_OUTCOMES.map((_, index) => adapter.complete({ attempt: "A", step: index }).kind);
    expect(kinds).toEqual([...MODEL_OUTCOMES]);
    const seededA = new FakeModelAdapter(new DeterministicSeededRng(99), new FakeDualClock());
    const seededB = new FakeModelAdapter(new DeterministicSeededRng(99), new FakeDualClock());
    const first = seededA.complete({ attempt: "A", step: 1 });
    const second = seededB.complete({ attempt: "A", step: 1 });
    expect(second).toEqual(first);
    expect(first.raw.includes("sk_")).toBe(false);
  });

  it("fires each armed fault once", () => {
    expect(FAULT_POINTS).toHaveLength(8);
    for (const point of FAULT_POINTS) {
      const injector = new CrashFaultInjector(point);
      expect(() => injector.hit(point)).toThrow(CrashSignal);
      expect(injector.fired()).toBe(point);
      expect(() => injector.hit(point)).not.toThrow();
    }
  });

  it("does not read the wall clock or the process random source", () => {
    const banned = [/Date\.now\(/, /Math\.random\(/, /crypto\.randomUUID\(/];
    const files = fs.readdirSync(sourceDir).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(10);
    for (const name of files) {
      const text = fs.readFileSync(path.join(sourceDir, name), "utf8");
      for (const pattern of banned) expect(text).not.toMatch(pattern);
    }
  });
});

describe("kernel simulation", () => {
  it("repeats seed 42 and seed 1337 with the same trace hash and all 9 invariants", async () => {
    const simulator = new M0KernelSimulator();
    const first42 = await simulator.run(42);
    const second42 = await runSimulation({ seed: 42 });
    const first1337 = await simulator.run(1337);
    const second1337 = await runSimulation({ seed: 1337 });
    expect(first42.passed).toBe(true);
    expect(second42.passed).toBe(true);
    expect(first42.traceHash).toBe(second42.traceHash);
    expect(first42.traceHash).toHaveLength(64);
    expect(first1337.passed).toBe(true);
    expect(first1337.traceHash).toBe(second1337.traceHash);
    expect(first42.traceHash).not.toBe(first1337.traceHash);
    expect(first42.clientEpochBumped).toBe(true);
  });

  it("rolls a half-closed transaction back and keeps the prior commit", async () => {
    const run = await runSimulation({
      seed: 3,
      plan: { fault: "after_write_before_commit", projects: 1, workers: 4, tasks: 2 },
    });
    expect(run.passed).toBe(true);
    expect(run.halfCloseRolledBack).toBe(true);
    expect(run.postCommitDurable).toBe(true);
    expect(run.faultFired).toBe("after_write_before_commit");
  });

  it("drops the IPC receipt after commit and resyncs the client", async () => {
    const run = await runSimulation({
      seed: 4,
      plan: { fault: "after_commit_before_ipc_receipt", projects: 1, workers: 4, tasks: 2 },
    });
    expect(run.passed).toBe(true);
    expect(run.receiptLostBeforeResync).toBe(true);
    expect(run.postCommitDurable).toBe(true);
    expect(run.clientEpochBumped).toBe(true);
  });

  it("keeps an irreconcilable unknown reservation reserved across restart", async () => {
    const run = await runSimulation({
      seed: 8,
      plan: {
        fault: "during_sleep_jump",
        unknown: "irreconcilable",
        expireBeforeDeposit: false,
        projects: 1,
        workers: 6,
        tasks: 3,
      },
    });
    expect(run.passed).toBe(true);
    expect(run.unknownHeldAcrossRestart).toBe(true);
  });

  it("expires an unreported grant conservatively and refuses the late deposit", async () => {
    const run = await runSimulation({
      seed: 11,
      plan: {
        fault: "after_issue_grant_before_deposit",
        expireBeforeDeposit: true,
        projects: 2,
        workers: 8,
        tasks: 4,
        unknown: "reconcilable",
      },
    });
    expect(run.passed).toBe(true);
    expect(run.grantExpiredConservatively).toBe(true);
    expect(run.lateDepositRefused).toBe(true);
  });

  it("lets 50 workers compete for 10 tasks while R17 breaks", async () => {
    const run = await runSimulation({
      seed: 17,
      plan: {
        workers: 50,
        tasks: 10,
        projects: 1,
        fault: "during_cas_temp_rename",
        unknown: "reconcilable",
        expireBeforeDeposit: false,
      },
    });
    expect(run.passed).toBe(true);
    expect(run.stats.tasks).toBe(10);
    expect(run.stats.workers).toBe(50);
    expect(run.stats.running).toBe(0);
    expect(run.faultFired).toBe("during_cas_temp_rename");
  });

  it(
    "survives a real WAL file, lock, CAS rename, and named-pipe restart",
    async () => {
      const run = await runSimulation({ seed: 9901, mode: "disk" });
      expect(run.passed).toBe(true);
      expect(run.walIsolated).toBe(true);
      expect(run.fileLocked).toBe(true);
      expect(run.traceHash).toHaveLength(64);
    },
    120_000,
  );
});

describe("performance and certification helpers", () => {
  it("keeps 50-writer p99 under 50 ms and the board query under 10 ms", () => {
    const perf = measureM0Performance();
    expect(perf.writeSamples).toBe(50);
    expect(perf.tasks).toBe(500);
    expect(perf.requirements).toBe(5_000);
    expect(perf.writeP99Ms).toBeLessThan(50);
    expect(perf.boardQueryMs).toBeLessThan(10);
  });

  it("renders a blocked report and a passing report shape", () => {
    const empty = emptyReport();
    const blocked = renderM0ExitReport(empty, { seed42: "a".repeat(64), seed1337: "b".repeat(64) });
    expect(blocked).toContain("M1 BLOCKED");
    expect(blocked).toContain("p50");
    expect(blocked).toContain("before_begin_immediate");
    const passed = renderM0ExitReport(
      {
        ...empty,
        passed: 10_000,
        failed: 0,
        total: 10_000,
        faultCounts: Object.fromEntries(FAULT_POINTS.map((point) => [point, 1250])) as SweepReport["faultCounts"],
      },
      { seed42: "a".repeat(64), seed1337: "b".repeat(64) },
    );
    expect(passed).toContain("10,000/10,000");
    expect(passed).toContain("M1 UNLOCKED");
  });

  it("replays a seed from the CLI entry point", async () => {
    const logs: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      logs.push(String(line));
    };
    try {
      const code = await runReplayCli(["--seed", "1337"]);
      expect(code).toBe(0);
      expect(logs.join("\n")).toContain("PASS");
      expect(logs.join("\n")).toContain("sha256=");
    } finally {
      console.log = original;
    }
  });
});

describe("fast M0 sweep", () => {
  it("passes 500 memory runs and 10 on-disk crash runs", async () => {
    const started = Date.now();
    const report = await runSweep({
      memoryRuns: 500,
      diskRuns: 10,
      memorySeedStart: 50_000,
      diskSeedStart: 80_000,
    });
    const elapsed = Date.now() - started;
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(510);
    expect(report.lostWork).toBe(0);
    expect(report.duplicatedWork).toBe(0);
    expect(report.doubleSpent).toBe(0);
    expect(report.drift).toBe(0);
    expect(elapsed).toBeLessThan(15_000);
  }, 60_000);
});

describe("replay command", () => {
  it("runs the replay CLI for seed 1337", async () => {
    const tsx = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const script = path.join(repoRoot, "packages", "sim", "src", "m0", "replay-cli.ts");
    const result = await execFileAsync(process.execPath, [tsx, script, "--seed", "1337"], {
      cwd: repoRoot,
      windowsHide: true,
    });
    expect(result.stdout).toContain("PASS");
    expect(result.stdout).toContain("sha256=");
  });
});

function emptyReport(): SweepReport {
  return {
    runs: [],
    passed: 0,
    failed: 1,
    total: 1,
    violations: [{ seed: 1, violations: ["sample"] }],
    faultCounts: Object.fromEntries(FAULT_POINTS.map((point) => [point, 0])) as SweepReport["faultCounts"],
    p50Ms: 0.1,
    p95Ms: 0.2,
    p99Ms: 0.3,
    lostWork: 0,
    duplicatedWork: 0,
    doubleSpent: 0,
    drift: 0,
  };
}
