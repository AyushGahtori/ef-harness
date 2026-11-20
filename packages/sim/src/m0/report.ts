import fs from "node:fs";
import path from "node:path";
import { FAULT_POINTS } from "./faults.js";
import { repoRoot } from "./schema-cache.js";
import type { SweepReport } from "./sweep.js";

export const M0_EXIT_REPORT_PATH = path.join(repoRoot, "packages", "sim", "tests", "m0", "M0_EXIT_REPORT.md");

export function renderM0ExitReport(report: SweepReport, hashes: { seed42: string; seed1337: string }): string {
  const faults = FAULT_POINTS.map((point) => `| ${point} | ${report.faultCounts[point]} |`).join("\n");
  const coverage = FAULT_POINTS.every((point) => report.faultCounts[point] >= 100);
  const unlocked = report.total === 10_000 && report.passed === 10_000 && report.failed === 0 && coverage;
  const failedSeeds = report.violations
    .slice(0, 20)
    .map((failure) => `- seed ${failure.seed}: ${failure.violations.join("; ")}`)
    .join("\n");
  return `# M0 Exit Certification

- Pass count: ${report.passed}/${report.total}
- Failed runs: ${report.failed}
- Lost-work violations: ${report.lostWork}
- Duplicated-work violations: ${report.duplicatedWork}
- Double-spent or budget violations: ${report.doubleSpent}
- Rollup drift violations: ${report.drift}
- DB write latency p50: ${report.p50Ms.toFixed(3)} ms
- DB write latency p95: ${report.p95Ms.toFixed(3)} ms
- DB write latency p99: ${report.p99Ms.toFixed(3)} ms
- Seed 42 trace SHA-256: ${hashes.seed42}
- Seed 1337 trace SHA-256: ${hashes.seed1337}

## Fault classes exercised

| Fault | Fires |
| --- | ---: |
${faults}

## Sign-off

${unlocked ? "M1 UNLOCKED. The M0 kernel skeleton passed 10,000/10,000 crash-injected deterministic runs with zero lost work, zero duplicated work, zero double-spent budget, and zero rollup drift." : "M1 BLOCKED. The M0 exit gate did not pass."}
${failedSeeds.length > 0 ? `\n## Failures\n\n${failedSeeds}\n` : ""}`;
}

export function writeM0ExitReport(report: SweepReport, hashes: { seed42: string; seed1337: string }, file = M0_EXIT_REPORT_PATH): string {
  const body = renderM0ExitReport(report, hashes);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return body;
}
