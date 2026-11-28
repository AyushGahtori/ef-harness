import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BENCHMARK_FILE } from "./constants.js";

export function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let hop = 0; hop < 8; hop += 1) {
    const benchmark = path.join(dir, BENCHMARK_FILE);
    const workspace = path.join(dir, "pnpm-workspace.yaml");
    if (fs.existsSync(benchmark) && fs.existsSync(workspace)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("repository root not found from the M5 exit gate");
}

export function benchmarkJsonPath(): string {
  return path.join(repoRoot(), BENCHMARK_FILE);
}

export function fixtureJsonPath(): string {
  return path.join(repoRoot(), "benchmarks", "m5-resume-changer", "fixture.json");
}

export function codeIndexSchemaPath(): string {
  return path.join(repoRoot(), "schema", "code-index.sql");
}
