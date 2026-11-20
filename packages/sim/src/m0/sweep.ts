import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { FAULT_POINTS, type FaultPoint } from "./faults.js";
import { repoRoot } from "./schema-cache.js";
import { percentile } from "./stats.js";
import { runSimulation, type SimRunResult } from "./simulator.js";

export interface SweepOptions {
  memoryRuns: number;
  diskRuns: number;
  memorySeedStart: number;
  diskSeedStart: number;
  realPipe?: boolean;
}

export interface SweepReport {
  runs: readonly SimRunResult[];
  passed: number;
  failed: number;
  total: number;
  violations: { seed: number; violations: readonly string[] }[];
  faultCounts: Record<FaultPoint, number>;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  lostWork: number;
  duplicatedWork: number;
  doubleSpent: number;
  drift: number;
}

interface ChunkResult {
  passed: number;
  failed: number;
  violations: { seed: number; violations: string[] }[];
  faultCounts: Record<FaultPoint, number>;
  latencies: number[];
  lostWork: number;
  duplicatedWork: number;
  doubleSpent: number;
  drift: number;
}

export async function runSweep(options: SweepOptions): Promise<SweepReport> {
  const total = options.memoryRuns + options.diskRuns;
  if (total >= 64) return runSweepParallel(options);
  const runs: SimRunResult[] = [];
  for (let index = 0; index < options.memoryRuns; index += 1) {
    runs.push(await runSimulation({ seed: options.memorySeedStart + index, mode: "memory" }));
  }
  for (let index = 0; index < options.diskRuns; index += 1) {
    runs.push(
      await runSimulation({
        seed: options.diskSeedStart + index,
        mode: "disk",
        realPipe: options.realPipe !== false,
      }),
    );
  }
  return summarize(runs);
}

async function runSweepParallel(options: SweepOptions): Promise<SweepReport> {
  const workers = Math.max(1, Math.min(4, availableParallelism()));
  const jobs: Promise<ChunkResult>[] = [];
  const memoryChunk = Math.ceil(options.memoryRuns / workers);
  for (let index = 0; index < workers; index += 1) {
    const start = options.memorySeedStart + index * memoryChunk;
    const count = Math.min(memoryChunk, options.memoryRuns - index * memoryChunk);
    if (count > 0) jobs.push(runChunk(start, count, "memory", options.realPipe !== false));
  }
  const diskWorkers = Math.max(1, Math.min(2, workers));
  const diskChunk = Math.ceil(options.diskRuns / diskWorkers);
  for (let index = 0; index < diskWorkers; index += 1) {
    const start = options.diskSeedStart + index * diskChunk;
    const count = Math.min(diskChunk, options.diskRuns - index * diskChunk);
    if (count > 0) jobs.push(runChunk(start, count, "disk", options.realPipe !== false));
  }
  const parts = await Promise.all(jobs);
  return mergeChunks(parts);
}

function runChunk(start: number, count: number, mode: "memory" | "disk", realPipe: boolean): Promise<ChunkResult> {
  const script = fileURLToPath(new URL("./chunk-cli.ts", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", script, String(start), String(count), mode, realPipe ? "pipe" : "nopipe"], {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const line = stdout.trim().split(/\r?\n/).findLast((item) => item.startsWith("{"));
      if (code !== 0 || !line) {
        reject(new Error(`sweep chunk ${mode} ${start}+${count} failed (${code ?? "none"}): ${stderr || stdout}`));
        return;
      }
      resolve(JSON.parse(line) as ChunkResult);
    });
  });
}

function mergeChunks(parts: readonly ChunkResult[]): SweepReport {
  const faultCounts = Object.fromEntries(FAULT_POINTS.map((point) => [point, 0])) as Record<FaultPoint, number>;
  const violations: SweepReport["violations"] = [];
  const latencies: number[] = [];
  let passed = 0;
  let failed = 0;
  let lostWork = 0;
  let duplicatedWork = 0;
  let doubleSpent = 0;
  let drift = 0;
  for (const part of parts) {
    passed += part.passed;
    failed += part.failed;
    lostWork += part.lostWork;
    duplicatedWork += part.duplicatedWork;
    doubleSpent += part.doubleSpent;
    drift += part.drift;
    violations.push(...part.violations);
    latencies.push(...part.latencies);
    for (const point of FAULT_POINTS) faultCounts[point] += part.faultCounts[point] ?? 0;
  }
  return {
    runs: [],
    passed,
    failed,
    total: passed + failed,
    violations,
    faultCounts,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    lostWork,
    duplicatedWork,
    doubleSpent,
    drift,
  };
}

export function summarize(runs: readonly SimRunResult[]): SweepReport {
  const faultCounts = Object.fromEntries(FAULT_POINTS.map((point) => [point, 0])) as Record<FaultPoint, number>;
  const violations: { seed: number; violations: readonly string[] }[] = [];
  const latencies: number[] = [];
  let lostWork = 0;
  let duplicatedWork = 0;
  let doubleSpent = 0;
  let drift = 0;
  for (const run of runs) {
    if (run.faultFired) faultCounts[run.faultFired] += 1;
    latencies.push(...run.latenciesMs);
    if (!run.passed) violations.push({ seed: run.seed, violations: run.violations });
    for (const violation of run.violations) {
      if (violation.includes("lost")) lostWork += 1;
      if (violation.includes("duplicat")) duplicatedWork += 1;
      if (violation.includes("budget") || violation.includes("grant") || violation.includes("window") || violation.includes("double")) {
        doubleSpent += 1;
      }
      if (violation.includes("rollup")) drift += 1;
    }
  }
  const passed = runs.length - violations.length;
  return {
    runs,
    passed,
    failed: violations.length,
    total: runs.length,
    violations,
    faultCounts,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    lostWork,
    duplicatedWork,
    doubleSpent,
    drift,
  };
}

/** Full M0 exit certification: 9,900 memory runs and 100 on-disk crash/restart runs. */
export function runM0ExitCertification(): Promise<SweepReport> {
  return runSweep({
    memoryRuns: 9_900,
    diskRuns: 100,
    memorySeedStart: 1,
    diskSeedStart: 9_901,
  });
}
