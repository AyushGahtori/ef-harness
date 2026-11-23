import fs from "node:fs";
import path from "node:path";
import type { ChaosSweepResult } from "./types.js";

export interface ChaosTrendReceipt {
  readonly task: "Task-192";
  readonly seeds: number;
  readonly passed: number;
  readonly failed: number;
  readonly elapsedMs: number;
  readonly hookCoverage: Record<string, number>;
  readonly classCoverage: Record<string, number>;
}

/** Writes structured chaos receipts under the ephemeral artifact root (never the real repo). */
export function writeChaosTrendReceipt(artifactRoot: string, sweep: ChaosSweepResult): ChaosTrendReceipt {
  const reportsDir = path.join(artifactRoot, "meta-lab", "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const receipt: ChaosTrendReceipt = {
    task: "Task-192",
    seeds: sweep.seeds,
    passed: sweep.passed,
    failed: sweep.failed,
    elapsedMs: sweep.elapsedMs,
    hookCoverage: { ...sweep.coverage.hooks },
    classCoverage: { ...sweep.coverage.classes },
  };
  fs.writeFileSync(path.join(reportsDir, "chaos-trend.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}