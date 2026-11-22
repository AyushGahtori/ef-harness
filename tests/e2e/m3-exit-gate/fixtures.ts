import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BaselineMetrics,
  HiddenSuiteDoc,
  LatencyCurve,
  M3Fixtures,
  MachineProfile,
  WorkGraph,
  WorkTask,
} from "./types.ts";

export function harnessRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function num(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`fixture field ${key} is not a finite number`);
  }
  return value;
}

function str(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`fixture field ${key} is empty`);
  }
  return value;
}

export function parseBaseline(value: unknown): BaselineMetrics {
  if (!isRecord(value)) throw new Error("baseline is not an object");
  return {
    totalWallClockSec: num(value, "totalWallClockSec"),
    phase0Sec: num(value, "phase0Sec"),
    waveBuildSec: num(value, "waveBuildSec"),
    completionAuditSec: num(value, "completionAuditSec"),
    totalTokens: num(value, "totalTokens"),
    paperworkPct: num(value, "paperworkPct"),
    hiddenPassCount: num(value, "hiddenPassCount"),
    hiddenTotalCount: num(value, "hiddenTotalCount"),
    passRatePct: num(value, "passRatePct"),
  };
}

function parseTask(value: unknown): WorkTask {
  if (!isRecord(value)) throw new Error("work task is not an object");
  const phase = str(value, "phase");
  const kind = str(value, "kind");
  if (phase !== "phase0" && phase !== "wave" && phase !== "merge" && phase !== "audit") {
    throw new Error(`unknown phase ${phase}`);
  }
  if (kind !== "model" && kind !== "merge") throw new Error(`unknown kind ${kind}`);
  const deps = value.deps;
  if (!Array.isArray(deps) || deps.some((dep) => typeof dep !== "string")) {
    throw new Error(`task ${String(value.id)} has a bad dependency list`);
  }
  return {
    id: str(value, "id"),
    phase,
    feature: str(value, "feature"),
    kind,
    tokens: num(value, "tokens"),
    avgExecSec: num(value, "avgExecSec"),
    deps,
  };
}

export function parseGraph(value: unknown): WorkGraph {
  if (!isRecord(value) || !Array.isArray(value.tasks)) throw new Error("work graph is missing tasks");
  return { schema: str(value, "schema"), tasks: value.tasks.map((task) => parseTask(task)) };
}

function parseCurve(value: unknown): LatencyCurve {
  if (!isRecord(value) || !isRecord(value.coding)) throw new Error("latency curve is missing coding");
  return {
    schema: str(value, "schema"),
    coding: { tokens: num(value.coding, "tokens"), seconds: num(value.coding, "seconds") },
    paperworkTokens: num(value, "paperworkTokens"),
    codingTokens: num(value, "codingTokens"),
    totalTokens: num(value, "totalTokens"),
    jitterRetrySec: num(value, "jitterRetrySec"),
    jitterTaskId: str(value, "jitterTaskId"),
  };
}

function parseProfile(value: unknown): MachineProfile {
  if (!isRecord(value)) throw new Error("machine profile is not an object");
  const preset = str(value, "preset");
  if (preset !== "Balanced" && preset !== "Fastest" && preset !== "Cheapest") {
    throw new Error(`unknown preset ${preset}`);
  }
  return {
    schema: str(value, "schema"),
    ramGb: num(value, "ramGb"),
    thinkingPool: num(value, "thinkingPool"),
    warmSlots: num(value, "warmSlots"),
    sessionCap: num(value, "sessionCap"),
    pacingCap: num(value, "pacingCap"),
    worktreeSlots: num(value, "worktreeSlots"),
    preset,
    presetCap: num(value, "presetCap"),
    orangeEnterMs: num(value, "orangeEnterMs"),
    greenRecoverMs: num(value, "greenRecoverMs"),
    spikeIgnoredMs: num(value, "spikeIgnoredMs"),
  };
}

function parseSuite(value: unknown): HiddenSuiteDoc {
  if (!isRecord(value) || !Array.isArray(value.checks)) throw new Error("hidden suite is missing checks");
  const checks = value.checks.map((check) => {
    if (!isRecord(check)) throw new Error("hidden check is not an object");
    return { id: str(check, "id"), title: str(check, "title") };
  });
  return {
    schema: str(value, "schema"),
    canary: str(value, "canary"),
    independentOfOracleAuthor: value.independentOfOracleAuthor === true,
    checks,
  };
}

export function paperworkFraction(paperworkTokens: number, totalTokens: number): number {
  if (totalTokens <= 0) return 1;
  return paperworkTokens / totalTokens;
}

export function assertFixtureInvariant(fixtures: M3Fixtures): void {
  const seconds = fixtures.graph.tasks.reduce((sum, task) => sum + task.avgExecSec, 0);
  if (Math.abs(seconds - fixtures.baseline.totalWallClockSec) > 1e-6) {
    throw new Error(`work graph sums to ${seconds}, baseline is ${fixtures.baseline.totalWallClockSec}`);
  }
  const coding = fixtures.graph.tasks.filter((task) => task.phase === "wave" && task.kind === "model");
  const codingTokens = coding.reduce((sum, task) => sum + task.tokens, 0);
  const paperwork = fixtures.graph.tasks
    .filter((task) => task.kind === "model" && task.phase !== "wave")
    .reduce((sum, task) => sum + task.tokens, 0);
  if (codingTokens !== fixtures.curve.codingTokens) {
    throw new Error(`coding tokens ${codingTokens} do not match the latency curve`);
  }
  if (paperwork !== fixtures.curve.paperworkTokens) {
    throw new Error(`paperwork tokens ${paperwork} do not match the latency curve`);
  }
  if (codingTokens + paperwork !== fixtures.baseline.totalTokens) {
    throw new Error("token split does not match the M2 total");
  }
  const fraction = paperworkFraction(paperwork, fixtures.baseline.totalTokens);
  if (Math.abs(fraction - fixtures.baseline.paperworkPct) > 1e-9) {
    throw new Error(`paperwork fraction ${fraction} does not match the baseline`);
  }
  if (fixtures.baseline.paperworkPct > 0.2) throw new Error("baseline paperwork is already over 20%");
  if (fixtures.suite.checks.length !== fixtures.baseline.hiddenTotalCount) {
    throw new Error("hidden suite length does not match the baseline");
  }
  if (fixtures.baseline.hiddenTotalCount < 25) throw new Error("hidden suite is below the 25-check floor");
  for (const task of coding) {
    if (task.tokens !== fixtures.curve.coding.tokens || task.avgExecSec !== fixtures.curve.coding.seconds) {
      throw new Error(`${task.id} is not on the coding latency curve`);
    }
  }
  const ids = new Set(fixtures.graph.tasks.map((task) => task.id));
  for (const task of fixtures.graph.tasks) {
    for (const dep of task.deps) {
      if (!ids.has(dep)) throw new Error(`${task.id} depends on missing ${dep}`);
    }
  }
}

export function loadM3Fixtures(root = harnessRoot()): M3Fixtures {
  const dir = path.join(root, "benchmarks", "m3-parallel");
  const fixtures: M3Fixtures = {
    root,
    baseline: parseBaseline(readJson(path.join(dir, "m2-baseline.port.json"))),
    suite: parseSuite(readJson(path.join(dir, "hidden-suite.port.json"))),
    graph: parseGraph(readJson(path.join(dir, "work-graph.json"))),
    curve: parseCurve(readJson(path.join(dir, "latency-curve.json"))),
    profile: parseProfile(readJson(path.join(dir, "machine-profile.json"))),
    opening: fs.readFileSync(path.join(dir, "opening-spec.txt"), "utf8").trim(),
  };
  assertFixtureInvariant(fixtures);
  return fixtures;
}
