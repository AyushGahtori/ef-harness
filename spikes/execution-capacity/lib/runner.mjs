import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { measureAcl } from "./acl.mjs";
import { createCleanup } from "./cleanup.mjs";
import {
  BASELINE_IDLE_CPU_WARN_PERCENT,
  HARD_PAGE_READS_PER_SEC_MAX,
  PROVISIONAL_POOLS,
  SAFETY_FREE_BYTES,
  SESSION_PROCESS_TARGET_BYTES,
} from "./constants.mjs";
import { measureHeavyLane } from "./heavy.mjs";
import { startJobProcess } from "./job.mjs";
import { mixedSchedule } from "./load.mjs";
import { createExecutionQueue } from "./queue.mjs";
import { buildCollectors, COLLECTOR_NAMES } from "./metrics.mjs";
import { judgeCell } from "./passfail.mjs";
import { buildPlan } from "./plan.mjs";
import { hostTotalMb, measurementMode, scaledSessionBytes } from "./pressure.mjs";
import { recommendPools } from "./report.mjs";
import { measureSlotReset } from "./slots.mjs";
import { pidAlive, sleep, spawnCaptured } from "./spawn.mjs";
import { createSharedStore, materializeSlot } from "./template.mjs";
import { probeTiers } from "./tiers.mjs";
import { startUiProbe } from "./ui-probe.mjs";
import { holdJob, startSampler } from "./win32.mjs";
import { percentile } from "./stats.mjs";

const workerMain = path.join(path.dirname(fileURLToPath(import.meta.url)), "worker-main.mjs");

/**
 * @param {{ quick?: boolean, workerCounts: number[], loads: string[], modes: string[], samples: number, poolWidth: number, heavyWidths: number[], aclFiles: number, uiSamples: number, activeMax?: number, holdForSignal?: boolean }} options
 */
export async function runBenchmark(options) {
  if (options.holdForSignal) return holdForSignal();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ef-capacity-"));
  const stateFile = path.join(os.tmpdir(), `ef-capacity-state-${process.pid}.json`);
  const cleanup = createCleanup(scratch, stateFile);
  cleanup.installSignals();
  try {
    const storeFile = createSharedStore(scratch);
    const slot = path.join(scratch, "slot");
    const linked = materializeSlot(slot, storeFile);
    const linkCount = fs.statSync(linked.linked).nlink;
    const sampler = startSampler(scratch);
    cleanup.trackResource(sampler);
    if (sampler.pid) cleanup.track(sampler.pid);
    const baseline = await sampler.sample();
    const warnings = [];
    if (Number(baseline.cpuPercent) > BASELINE_IDLE_CPU_WARN_PERCENT) {
      warnings.push(
        `Baseline idle CPU is ${baseline.cpuPercent}%, above ${BASELINE_IDLE_CPU_WARN_PERCENT}%. Repeated samples are still taken; treat a single noisy cell cautiously.`,
      );
    }
    let ui = await startUiProbe({ startupMs: options.quick === true ? 12000 : 20000 });
    cleanup.trackResource(ui);
    if (ui.pid) cleanup.track(ui.pid);
    if (!ui.available && ui.error) warnings.push(`UI probe unavailable: ${ui.error}`);
    const reviveUi = async () => {
      try {
        await ui.dispose();
      } catch {
        // The previous window may already be gone.
      }
      ui = await startUiProbe({ startupMs: options.quick === true ? 12000 : 20000 });
      cleanup.trackResource(ui);
      if (ui.pid) cleanup.track(ui.pid);
      if (!ui.available && ui.error) warnings.push(`UI probe restart failed: ${ui.error}`);
      else warnings.push("UI probe was restarted after a sample returned no frames.");
    };
    const tiers = await probeTiers(baseline, { freeBytes: Number(baseline.availPhys ?? 0) });
    const plan = buildPlan({
      modes: options.modes,
      workerCounts: options.workerCounts,
      loads: options.loads,
      poolWidth: options.poolWidth,
    });
    const cells = [];
    for (const planned of plan) {
      const activeMax = options.activeMax ?? Number.POSITIVE_INFINITY;
      const tier = tiers[planned.isolationMode];
      if (planned.isolationMode === "session_process" && planned.workerCount > (options.sessionMax ?? Number.POSITIVE_INFINITY)) {
        cells.push({
          ...planned,
          availability: "not_available_on_host",
          reason: "session_width_not_run_in_this_invocation",
          verdict: "not_available_on_host",
          samples: [],
        });
        continue;
      }
      if ((planned.load === "active" || planned.load === "mixed") && planned.workerCount > activeMax) {
        cells.push({
          ...planned,
          availability: "not_available_on_host",
          reason: "active_width_not_run_in_this_invocation",
          verdict: "not_available_on_host",
          samples: [],
        });
        continue;
      }
      if (tier && tier.available === false) {
        cells.push({
          ...planned,
          availability: "not_available_on_host",
          reason: tier.reason,
          verdict: "not_available_on_host",
          samples: [],
        });
        continue;
      }
      const samples = [];
      for (let index = 0; index < options.samples; index += 1) {
        let taken;
        try {
          taken = await runSample({
            planned,
            slot,
            sampler,
            ui,
            uiSamples: options.uiSamples,
            freeBytes: Number(baseline.availPhys ?? 0),
            quick: options.quick === true,
          });
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : String(error));
          taken = {
            launchMs: [],
            uiP95: null,
            pageReads: HARD_PAGE_READS_PER_SEC_MAX,
            commitRatio: 0,
            oomGuardTripped: false,
            sample: {},
          };
        }
        samples.push(taken);
        if (taken.uiP95 === null && options.quick !== true) await reviveUi();
        if (taken.oomGuardTripped) break;
      }
      cells.push(finishCell(planned, samples));
    }
    const acl = await measureAcl(scratch, options.aclFiles, () => sampler.sample());
    const slotReset = await measureSlotReset(scratch);
    if (!ui.available && options.quick !== true) await reviveUi();
    const heavy = await measureHeavyLane({
      widths: options.heavyWidths,
      slotDir: slot,
      sample: () => sampler.sample(),
      measureUi: ui.available ? (count) => ui.measure(count) : null,
      uiSamples: options.uiSamples,
    });
    const service = await measureService(cleanup);
    const hostMb = hostTotalMb();
    const pools = recommendPools({
      hostMb,
      cells,
      heavy,
    });
    const launchMs = cells.flatMap((cell) => cell.launchMs ?? []);
    const uiValues = cells
      .map((cell) => cell.metrics?.uiInputLatencyP95Ms)
      .filter((value) => typeof value === "number");
    const collectors = buildCollectors(baseline, {
      launchMs,
      slot: { coldCreateMs: slotReset.coldCreateMs, reuseResetMs: slotReset.reuseResetMs },
      uiP95Ms: uiValues.length > 0 ? percentile(uiValues, 95) : null,
    });
    return {
      generatedAt: Date.now(),
      quick: options.quick === true,
      host: {
        totalMb: hostMb,
        cores: Number(baseline.cores ?? os.cpus().length),
        gpu: String(baseline.gpu ?? "unknown"),
        fileSystem: String(baseline.fileSystem ?? "unknown"),
        devDrive: String(baseline.devDrive ?? "not_available_on_host"),
        osBuild: `${baseline.osBuild}.${baseline.osUbr}`,
        osProduct: String(baseline.osProduct ?? ""),
        commitChargeRatio: Number(baseline.commitRatio ?? 0),
        availPhys: Number(baseline.availPhys ?? 0),
      },
      warnings,
      tiers,
      linkCount,
      cells,
      acl,
      slotReset,
      heavy,
      service,
      pools,
      collectors,
      collectorNames: COLLECTOR_NAMES,
      modes: {
        defenderExclusionsMutated: false,
        wslConfigMutated: false,
        networkCalls: false,
      },
      measurementModes: {
        "16gb": measurementMode(hostMb, 16),
        "32gb": measurementMode(hostMb, 32),
      },
      provisional: PROVISIONAL_POOLS,
    };
  } finally {
    await cleanup.cleanup("normal");
  }
}

/**
 * @param {{ planned: { isolationMode: string, thinkingWidth: number, executingWidth: number, load: string }, slot: string, sampler: { sample: () => Promise<Record<string, unknown>> }, ui: { available: boolean, measure: (samples: number) => Promise<{ p95Ms: number } | null> }, uiSamples: number, freeBytes: number, quick: boolean }} input
 */
async function runSample(input) {
  const executing = input.planned.executingWidth;
  const holdBytes =
    input.planned.isolationMode === "session_process"
      ? scaledSessionBytes(input.freeBytes, executing, input.quick ? 1024 * 1024 : SESSION_PROCESS_TARGET_BYTES, SAFETY_FREE_BYTES)
      : 0;
  const workers = [];
  const launchMs = [];
  try {
    for (let index = 0; index < executing; index += 1) {
      const client = createClient();
      const started = performance.now();
      const job = await startJobProcess({
        args: [workerMain],
        cwd: input.slot,
        memoryLimitBytes: 2 * 1024 * 1024 * 1024,
        onLine: client.onLine,
      });
      launchMs.push(performance.now() - started);
      workers.push({ job, client });
      const ready = await client.next();
      if (ready.ready !== true) {
        throw new Error(`worker ${index} was not ready`);
      }
    }
    if (input.planned.load === "idle") {
      await Promise.all(
        Array.from({ length: input.planned.thinkingWidth }, async (_, index) => {
          await sleep(20 + (index % 4) * 5);
        }),
      );
      await Promise.all(
        workers.map((worker) =>
          request(worker, { op: "idle", ms: input.quick ? 30 : 80, holdBytes }),
        ),
      );
    } else if (input.planned.load === "active") {
      const queue = createExecutionQueue();
      await Promise.all(
        Array.from({ length: input.planned.thinkingWidth }, async (_, index) => {
          await sleep(15);
          queue.enqueue(index === 0 ? "verifier" : "worker", `attempt-${index}`, {
            op: "active",
            cwd: input.slot,
          });
        }),
      );
      await drain(queue, workers);
    } else {
      const queue = createExecutionQueue();
      const steps = mixedSchedule(input.planned.thinkingWidth);
      await Promise.all(
        steps.map(async (step) => {
          await sleep(Math.min(step.thinkMs, input.quick ? 25 : step.thinkMs));
          queue.enqueue(step.priority, `attempt-${step.worker}`, step.runActive
            ? { op: "active", cwd: input.slot }
            : { op: "idle", ms: 25, holdBytes: 0 });
        }),
      );
      await drain(queue, workers);
    }
    const sample = await input.sampler.sample();
    let uiP95 = null;
    if (input.ui.available) {
      try {
        const measured = await input.ui.measure(input.uiSamples);
        uiP95 = measured ? measured.p95Ms : null;
      } catch {
        uiP95 = null;
      }
    }
    const oom = Number(sample.commitRatio) > 0.9;
    return {
      launchMs,
      uiP95,
      pageReads: Number(sample.pageReadsPerSec ?? 0),
      commitRatio: Number(sample.commitRatio ?? 0),
      oomGuardTripped: oom,
      rss: workers.length > 0 ? null : null,
      sample,
    };
  } finally {
    for (const worker of workers) {
      await worker.job.dispose();
    }
  }
}

/**
 * @param {{ isolationMode: string, workerCount: number, load: string, thinkingWidth: number, executingWidth: number }} planned
 * @param {readonly { launchMs: number[], uiP95: number | null, pageReads: number, commitRatio: number, oomGuardTripped: boolean }[]} samples
 */
function finishCell(planned, samples) {
  const ui = samples.map((sample) => sample.uiP95).filter((value) => typeof value === "number");
  const faults = samples.map((sample) => sample.pageReads);
  const metrics = {
    uiInputLatencyP95Ms: ui.length > 0 ? percentile(ui, 95) : null,
    hardPageReadsPerSecMedian: faults.length > 0 ? percentile(faults, 50) : null,
    commitChargeRatio: samples.length > 0 ? Math.max(...samples.map((sample) => sample.commitRatio)) : null,
    oomGuardTripped: samples.some((sample) => sample.oomGuardTripped),
  };
  return {
    ...planned,
    verdict: judgeCell(metrics),
    metrics,
    launchMs: samples.flatMap((sample) => sample.launchMs),
    sampleCount: samples.length,
  };
}

function createClient() {
  /** @type {((message: Record<string, unknown>) => void)[]} */
  const waiters = [];
  /** @type {Record<string, unknown>[]} */
  const backlog = [];
  return {
    /**
     * @param {string} line
     */
    onLine(line) {
      const message = JSON.parse(line);
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else backlog.push(message);
    },
    next() {
      const existing = backlog.shift();
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
  };
}

/**
 * @param {{ job: { stdin: import("node:stream").Writable }, client: { next: () => Promise<Record<string, unknown>> } }} worker
 * @param {Record<string, unknown>} message
 */
function request(worker, message) {
  worker.job.stdin.write(`${JSON.stringify(message)}\n`);
  return Promise.race([
    worker.client.next(),
    sleep(120000).then(() => {
      throw new Error("worker command exceeded 120 s");
    }),
  ]);
}

/**
 * @param {{ dequeue: () => { command: Record<string, unknown> } | null }} queue
 * @param {readonly { job: { stdin: import("node:stream").Writable }, client: { next: () => Promise<Record<string, unknown>> } }[]} workers
 */
async function drain(queue, workers) {
  await Promise.all(
    workers.map(async (worker) => {
      for (;;) {
        const item = queue.dequeue();
        if (!item) return;
        await request(worker, item.command);
      }
    }),
  );
}

/**
 * @param {{ track: (pid: number) => void, trackResource: (resource: { dispose: () => Promise<void>, pid?: number | null }) => void }} cleanup
 */
async function measureService(cleanup) {
  const child = spawn(
    process.execPath,
    ["-e", "require('http').createServer((req,res)=>res.end('ok')).listen(0,'127.0.0.1')"],
    { shell: false, windowsHide: true, stdio: "ignore" },
  );
  if (child.pid) cleanup.track(child.pid);
  const holder = child.pid ? holdJob(child.pid, 256 * 1024 * 1024) : null;
  try {
    if (holder) await holder.ready;
    await sleep(150);
    const query = child.pid
      ? await spawnCaptured(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${child.pid}).WorkingSet64`],
          { timeoutMs: 8000 },
        )
      : { stdout: "0", code: 1 };
    const bytes = Number(query.stdout.trim() || 0);
    return {
      bind: "127.0.0.1",
      workingSetBytes: Number.isFinite(bytes) ? bytes : 0,
      note: "Standby loopback listener. Embedded Postgres and browsers are later tasks.",
    };
  } finally {
    if (holder) await holder.dispose();
    else if (child.pid && pidAlive(child.pid)) child.kill();
  }
}

async function holdForSignal() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ef-capacity-hold-"));
  const stateFile = path.join(os.tmpdir(), `ef-capacity-hold-${process.pid}.json`);
  const cleanup = createCleanup(scratch, stateFile);
  cleanup.installSignals();
  fs.writeFileSync(path.join(scratch, "marker.txt"), "scratch");
  const sleeper = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    shell: false,
    windowsHide: true,
    stdio: "ignore",
  });
  if (!sleeper.pid) throw new Error("sleeper did not start");
  cleanup.track(sleeper.pid);
  const holder = holdJob(sleeper.pid, 0);
  cleanup.trackResource(holder);
  await holder.ready;
  process.stdout.write(`${JSON.stringify({ ready: true, scratch, sleeper: sleeper.pid })}\n`);
  await new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      if (String(chunk).includes("SIGINT")) resolve(undefined);
    });
  });
  await cleanup.cleanup("SIGINT");
  process.exit(0);
}
