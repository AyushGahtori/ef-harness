import path from "node:path";
import { pathToFileURL } from "node:url";
import { FAULT_POINTS, type FaultPoint } from "./faults.js";
import { runSimulation } from "./simulator.js";

export async function runChunkCli(argv: readonly string[]): Promise<void> {
  const start = Number(argv[0]);
  const count = Number(argv[1]);
  const mode = argv[2] === "disk" ? "disk" : "memory";
  const realPipe = argv[3] !== "nopipe";
  if (!Number.isInteger(start) || !Number.isInteger(count) || count < 0) {
    throw new Error("usage: chunk-cli <start> <count> <memory|disk> [pipe|nopipe]");
  }
  const faultCounts = Object.fromEntries(FAULT_POINTS.map((point) => [point, 0])) as Record<FaultPoint, number>;
  const violations: { seed: number; violations: string[] }[] = [];
  const latencies: number[] = [];
  let lostWork = 0;
  let duplicatedWork = 0;
  let doubleSpent = 0;
  let drift = 0;
  for (let index = 0; index < count; index += 1) {
    const run = await runSimulation({ seed: start + index, mode, realPipe });
    if (run.faultFired) faultCounts[run.faultFired] += 1;
    latencies.push(...run.latenciesMs);
    if (!run.passed) violations.push({ seed: run.seed, violations: [...run.violations] });
    for (const violation of run.violations) {
      if (violation.includes("lost")) lostWork += 1;
      if (violation.includes("duplicat")) duplicatedWork += 1;
      if (violation.includes("budget") || violation.includes("grant") || violation.includes("window") || violation.includes("double")) {
        doubleSpent += 1;
      }
      if (violation.includes("rollup")) drift += 1;
    }
  }
  console.log(JSON.stringify({
    passed: count - violations.length,
    failed: violations.length,
    violations: violations.slice(0, 20),
    faultCounts,
    latencies,
    lostWork,
    duplicatedWork,
    doubleSpent,
    drift,
  }));
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  runChunkCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
