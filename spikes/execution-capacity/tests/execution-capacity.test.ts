import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COLLECTOR_NAMES } from "../lib/metrics.mjs";
import { buildPlan } from "../lib/plan.mjs";
import { judgeCell, largestPassingWidth, recommendWidth, UI_INPUT_LATENCY_PASS_MS } from "../lib/passfail.mjs";
import { allocateCommitted, fitsRamBudget, measurementMode } from "../lib/pressure.mjs";
import { createPrng } from "../lib/prng.mjs";
import { createExecutionQueue } from "../lib/queue.mjs";
import { assertFootprints, assertMachineProfile, footprintRow, machineProfileRow } from "../lib/schema.mjs";
import { mixedSchedule } from "../lib/load.mjs";
import { holdJob } from "../lib/win32.mjs";
import { pidAlive, sleep } from "../lib/spawn.mjs";

const spikeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bench = path.join(spikeRoot, "bench.mjs");

describe("execution capacity pass rule", () => {
  it("passes only when UI p95 is under 50 ms and hard page reads are under the threshold", () => {
    expect(UI_INPUT_LATENCY_PASS_MS).toBe(50);
    expect(
      judgeCell({ uiInputLatencyP95Ms: 49.9, hardPageReadsPerSecMedian: 49.9, commitChargeRatio: 0.5 }),
    ).toBe("PASS");
    expect(
      judgeCell({ uiInputLatencyP95Ms: 50, hardPageReadsPerSecMedian: 1, commitChargeRatio: 0.5 }),
    ).toBe("FAIL");
    expect(
      judgeCell({ uiInputLatencyP95Ms: 10, hardPageReadsPerSecMedian: 50, commitChargeRatio: 0.5 }),
    ).toBe("FAIL");
    expect(
      judgeCell({ uiInputLatencyP95Ms: 10, hardPageReadsPerSecMedian: 1, commitChargeRatio: 0.91 }),
    ).toBe("FAIL_OOM_GUARD");
    expect(
      judgeCell({
        uiInputLatencyP95Ms: null,
        hardPageReadsPerSecMedian: null,
        commitChargeRatio: null,
        availability: "not_available_on_host",
      }),
    ).toBe("not_available_on_host");
  });

  it("keeps the largest passing width below the first failure", () => {
    expect(
      largestPassingWidth([
        { width: 1, verdict: "PASS" },
        { width: 5, verdict: "PASS" },
        { width: 10, verdict: "FAIL" },
        { width: 20, verdict: "PASS" },
      ]),
    ).toBe(5);
    expect(
      recommendWidth("16gb", "thinking", [{ width: 5, verdict: "PASS" }], "direct").recommended,
    ).toBe(12);
    expect(
      recommendWidth("32gb", "execution", [], "not_measured_on_host"),
    ).toMatchObject({ recommended: 4, basis: "provisional_not_measured_on_host" });
  });
});

describe("execution capacity plan", () => {
  it("does not collapse thinking width into executing width", () => {
    const cells = buildPlan({ modes: ["own_loop", "session_process"], workerCounts: [1, 5, 10, 20], loads: ["idle", "active", "mixed"], poolWidth: 2 });
    const wide = cells.find((cell) => cell.isolationMode === "own_loop" && cell.workerCount === 20 && cell.load === "active");
    expect(wide?.thinkingWidth).toBe(20);
    expect(wide?.executingWidth).toBe(2);
    const session = cells.find((cell) => cell.isolationMode === "session_process" && cell.workerCount === 5);
    expect(session?.thinkingWidth).toBe(5);
    expect(session?.executingWidth).toBe(5);
    expect(session?.thinkingWidth).not.toBe(session?.executingWidth - 1);
  });

  it("repeats a seeded mixed schedule", () => {
    const first = mixedSchedule(8, 0x004ec001);
    const second = mixedSchedule(8, 0x004ec001);
    expect(second).toEqual(first);
    expect(createPrng(0x004ec001).int(1, 3)).toBe(createPrng(0x004ec001).int(1, 3));
  });

  it("serves verifiers before workers and rotates attempts", () => {
    const queue = createExecutionQueue();
    queue.enqueue("background", "a", "bg");
    queue.enqueue("worker", "a", "wa1");
    queue.enqueue("worker", "a", "wa2");
    queue.enqueue("worker", "b", "wb");
    queue.enqueue("verifier", "a", "va");
    expect(queue.dequeue()?.command).toBe("va");
    expect(queue.dequeue()?.command).toBe("wa1");
    expect(queue.dequeue()?.command).toBe("wb");
    expect(queue.dequeue()?.command).toBe("wa2");
    expect(queue.dequeue()?.command).toBe("bg");
  });
});

describe("execution capacity schema and pressure", () => {
  it("matches machine_profile and footprints columns", () => {
    const now = 1_700_000_000_000;
    const profile = [
      machineProfileRow("ram_total_mb", "16085", now),
      machineProfileRow("cores", "12", now),
      machineProfileRow("gpu", "test", now),
      machineProfileRow("dev_drive", "not_available_on_host", now),
      machineProfileRow("calibration_run", "{}", now),
    ];
    assertMachineProfile(profile);
    const footprints = [
      footprintRow({ consumer: "worker_cli", p50Mb: 40.2, p95Mb: 55.8, samples: 3, updatedAt: now }),
    ];
    assertFootprints(footprints);
    expect(footprints[0]?.p50_mb).toBe(40);
    expect(footprints[0]?.p95_mb).toBe(56);
  });

  it("does not treat a 64 GB host as a 16 GB budget", () => {
    expect(measurementMode(65536, 16)).toBe("scale_annotation");
    expect(measurementMode(16000, 16)).toBe("direct");
    expect(measurementMode(16000, 32)).toBe("not_measured_on_host");
    expect(fitsRamBudget({ baselineCommitMb: 12000, perWorkerMb: 800, workers: 8, targetGb: 16 }).fits).toBe(false);
  });

  it("commits and releases a synthetic block", () => {
    const block = allocateCommitted(1024 * 1024);
    expect(block.touch()).toBe(14);
    expect(block.release()).toBe(true);
  });

  it("names the seven collectors", () => {
    expect(COLLECTOR_NAMES).toEqual([
      "committedMemoryAndWorkingSet",
      "cpuUtilization",
      "diskActiveTimeAndQueue",
      "sandboxLaunchLatency",
      "slotResetTime",
      "defenderCpu",
      "uiInputLatency",
    ]);
  });
});

describe("execution capacity host safety", () => {
  it("does not mutate Defender or WSL configuration", () => {
    const files = fs.readdirSync(path.join(spikeRoot, "lib"));
    const text = files
      .filter((name) => name.endsWith(".mjs") || name.endsWith(".ps1"))
      .map((name) => fs.readFileSync(path.join(spikeRoot, "lib", name), "utf8"))
      .join("\n");
    expect(text.includes("Set-MpPreference")).toBe(false);
    expect(text.includes("Add-MpPreference")).toBe(false);
    expect(text.includes(".wslconfig")).toBe(false);
  });

  it("kills a grandchild when the job handle closes", async () => {
    const pidFile = path.join(os.tmpdir(), `ef-capacity-grand-${process.pid}.txt`);
    const goFile = path.join(os.tmpdir(), `ef-capacity-go-${process.pid}.txt`);
    fs.rmSync(pidFile, { force: true });
    fs.rmSync(goFile, { force: true });
    const child = spawn(
      process.execPath,
      [
        "-e",
        "const {spawn}=require('child_process'); const fs=require('fs'); const started=Date.now(); while(!fs.existsSync(process.argv[2])){ if(Date.now()-started>8000) process.exit(2); } const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true,shell:false}); fs.writeFileSync(process.argv[1], String(g.pid)); setInterval(()=>{},1000);",
        pidFile,
        goFile,
      ],
      { shell: false, windowsHide: true, stdio: "ignore" },
    );
    expect(child.pid).toBeTruthy();
    const holder = holdJob(child.pid ?? 0, 0);
    try {
      await holder.ready;
      fs.writeFileSync(goFile, "go");
      let grandPid = 0;
      for (let attempt = 0; attempt < 50 && grandPid === 0; attempt += 1) {
        if (fs.existsSync(pidFile)) grandPid = Number(fs.readFileSync(pidFile, "utf8"));
        else await sleep(20);
      }
      expect(grandPid).toBeGreaterThan(0);
      const started = Date.now();
      await holder.dispose();
      const deadline = started + 1000;
      while (Date.now() < deadline && (pidAlive(child.pid ?? 0) || pidAlive(grandPid))) {
        await sleep(30);
      }
      expect(pidAlive(child.pid ?? 0)).toBe(false);
      expect(pidAlive(grandPid)).toBe(false);
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      if (child.pid && pidAlive(child.pid)) child.kill();
      fs.rmSync(pidFile, { force: true });
      fs.rmSync(goFile, { force: true });
    }
  }, 20_000);
});

describe("execution capacity quick harness", () => {
  it("runs collectors, threshold output, and cleanup", async () => {
    const child = spawn(process.execPath, [bench, "--quick"], {
      cwd: spikeRoot,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const code = await new Promise((resolve) => {
      child.on("close", (status) => resolve(status));
    });
    expect(code, stderr).toBe(0);
    const summary = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "{}");
    expect(summary.verdicts.length).toBeGreaterThan(0);
    expect(summary.devDrive).toBeTypeOf("string");
  }, 180_000);

  it("cleans scratch and the sleeper after simulated SIGINT", async () => {
    const child = spawn(process.execPath, [bench, "--hold-for-signal"], {
      cwd: spikeRoot,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ready line: ${stdout}`)), 15000);
      const poll = setInterval(() => {
        const line = stdout.split(/\r?\n/).find((item) => item.includes("\"ready\":true"));
        if (!line) return;
        clearInterval(poll);
        clearTimeout(timer);
        resolve(JSON.parse(line));
      }, 50);
    });
    child.stdin.write("SIGINT\n");
    const code = await new Promise((resolve) => {
      child.on("close", (status) => resolve(status));
    });
    expect(code).toBe(0);
    expect(fs.existsSync(ready.scratch)).toBe(false);
    expect(pidAlive(ready.sleeper)).toBe(false);
  }, 30_000);
});
