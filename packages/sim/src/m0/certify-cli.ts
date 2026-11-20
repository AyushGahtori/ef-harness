import path from "node:path";
import { pathToFileURL } from "node:url";
import { FAULT_POINTS } from "./faults.js";
import { writeM0ExitReport } from "./report.js";
import { replaySeed } from "./simulator.js";
import { runM0ExitCertification } from "./sweep.js";

export async function runCertifyCli(): Promise<number> {
  const report = await runM0ExitCertification();
  const seed42 = await replaySeed(42);
  const seed1337 = await replaySeed(1337);
  writeM0ExitReport(report, { seed42: seed42.traceHash, seed1337: seed1337.traceHash });
  const coverage = FAULT_POINTS.every((point) => report.faultCounts[point] >= 100);
  const ok = report.passed === 10_000 && report.failed === 0 && coverage && report.lostWork === 0 && report.duplicatedWork === 0 && report.doubleSpent === 0 && report.drift === 0;
  console.log(`M0 exit ${report.passed}/${report.total} p99=${report.p99Ms.toFixed(3)}ms coverage=${coverage ? "yes" : "no"}`);
  if (!ok) {
    for (const failure of report.violations.slice(0, 10)) {
      console.error(`seed ${failure.seed}: ${failure.violations.join("; ")}`);
    }
  }
  return ok ? 0 : 1;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  runCertifyCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
