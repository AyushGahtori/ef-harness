import { createHash } from "node:crypto";
import type { GateDecision, M3ExitGateReport } from "./types.js";

export const M3_EXIT_GATE_REPORT_SCHEMA = "m3-exit-gate-report@1" as const;

export const SPEEDUP_MIN = 2;
export const PASS_RATE_FLOOR = 0.9;
export const DB_P99_LIMIT_MS = 50;
export const BOARD_UPDATE_LIMIT_MS = 10;
export const BOARD_PAINT_P95_LIMIT_MS = 50;
export const STOP_LIMIT_MS = 100;
export const PAPERWORK_LIMIT = 0.2;

export interface GateInput {
  speedupRatio: number;
  m3PassRate: number;
  m2PassRate: number;
  dbWriteP99Ms: number;
  boardUpdateMs: number;
  boardPaintP95Ms: number;
  stopLatencyMs: number;
  leakedPids: number;
  secretsFound: number;
  paperworkPct: number;
  viewsTracked: number;
  postStopMerges: number;
  unauthorizedClaims: number;
  unauthorizedTokens: number;
  sqliteBusy: number;
  scenariosPassed: number;
  scenariosTotal: number;
}

export function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function signReport(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

export function signingView(report: M3ExitGateReport): unknown {
  const { signature: _signature, hostElapsedMs: _hostElapsedMs, ...rest } = report;
  void _signature;
  void _hostElapsedMs;
  return rest;
}

export function passRateDeltaPct(m3PassRate: number, m2PassRate: number): number {
  return (m3PassRate - m2PassRate) * 100;
}

export function evaluateM3ExitGate(input: GateInput): GateDecision {
  const reasons: string[] = [];
  const detail: string[] = [];
  const delta = passRateDeltaPct(input.m3PassRate, input.m2PassRate);
  if (!(input.speedupRatio >= SPEEDUP_MIN)) {
    reasons.push("speedup");
    detail.push(`speedupRatio ${input.speedupRatio} < ${SPEEDUP_MIN}`);
  }
  if (!(input.m3PassRate >= PASS_RATE_FLOOR) || !(input.m3PassRate >= input.m2PassRate)) {
    reasons.push("passRate");
    detail.push(
      `passRate m3=${input.m3PassRate} m2=${input.m2PassRate} passRateDelta=${delta}`,
    );
  }
  if (!(input.dbWriteP99Ms < DB_P99_LIMIT_MS)) {
    reasons.push("dbWriteP99Ms");
    detail.push(`dbWriteP99Ms ${input.dbWriteP99Ms} >= ${DB_P99_LIMIT_MS}`);
  }
  if (!(input.boardUpdateMs < BOARD_UPDATE_LIMIT_MS)) {
    reasons.push("boardUpdateMs");
    detail.push(`boardUpdateMs ${input.boardUpdateMs} >= ${BOARD_UPDATE_LIMIT_MS}`);
  }
  if (!(input.boardPaintP95Ms < BOARD_PAINT_P95_LIMIT_MS)) {
    reasons.push("boardPaintP95Ms");
    detail.push(`boardPaintP95Ms ${input.boardPaintP95Ms} >= ${BOARD_PAINT_P95_LIMIT_MS}`);
  }
  if (!(input.stopLatencyMs < STOP_LIMIT_MS)) {
    reasons.push("stopLatencyMs");
    detail.push(`stopLatencyMs ${input.stopLatencyMs} >= ${STOP_LIMIT_MS}`);
  }
  if (input.leakedPids !== 0) {
    reasons.push("leakedPids");
    detail.push(`leakedPids ${input.leakedPids}`);
  }
  if (input.secretsFound !== 0) {
    reasons.push("secretsFound");
    detail.push(`secretsFound ${input.secretsFound}`);
  }
  if (!(input.paperworkPct <= PAPERWORK_LIMIT)) {
    reasons.push("paperworkPct");
    detail.push(`paperworkPct ${input.paperworkPct} > ${PAPERWORK_LIMIT}`);
  }
  if (input.viewsTracked !== 0) {
    reasons.push("viewsTracked");
    detail.push(`viewsTracked ${input.viewsTracked}`);
  }
  if (input.postStopMerges !== 0) {
    reasons.push("postStopMerges");
    detail.push(`postStopMerges ${input.postStopMerges}`);
  }
  if (input.unauthorizedClaims !== 0 || input.unauthorizedTokens !== 0) {
    reasons.push("unauthorizedResume");
    detail.push(`claims ${input.unauthorizedClaims} tokens ${input.unauthorizedTokens}`);
  }
  if (input.sqliteBusy !== 0) {
    reasons.push("sqliteBusy");
    detail.push(`SQLITE_BUSY ${input.sqliteBusy}`);
  }
  if (input.scenariosPassed !== input.scenariosTotal) {
    reasons.push("scenarios");
    detail.push(`scenarios ${input.scenariosPassed}/${input.scenariosTotal}`);
  }
  return {
    exitCode: reasons.length === 0 ? 0 : 1,
    reasons,
    detail,
    passRateDeltaPct: delta,
  };
}

export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? Number.POSITIVE_INFINITY;
}

function fixed(value: number): string {
  if (!Number.isFinite(value)) return "inf";
  return value.toFixed(3);
}

export function renderScorecard(report: M3ExitGateReport): string {
  const lines = [
    "# M3 Exit Gate Scorecard",
    "",
    `Mode: ${report.mode}`,
    `Gate: ${report.gate.exitCode === 0 ? "pass" : "fail"}`,
    `Claimed certification: ${report.claimedCertification ? "yes" : "no"}`,
    "",
    "| Metric | M2 sequential | M3 parallel |",
    "| --- | --- | --- |",
    `| Wall clock (s) | ${fixed(report.m2.totalWallClockSec)} | ${fixed(report.m3.totalWallClockSec)} |`,
    `| Pass rate (%) | ${fixed(report.m2.passRatePct)} | ${fixed(report.m3.passRatePct)} |`,
    `| Paperwork | ${fixed(report.m2.paperworkPct)} | ${fixed(report.m3.paperworkPct)} |`,
    "",
    `| speedupRatio | ${fixed(report.speedupRatio)} |`,
    `| passRateDelta | ${fixed(report.passRateDelta)} |`,
    `| dbWriteP99Ms | ${fixed(report.dbWriteP99Ms)} |`,
    `| boardUpdateMs | ${fixed(report.boardUpdateMs)} |`,
    `| stopLatencyMs | ${fixed(report.stopLatencyMs)} |`,
    `| leakedPids | ${report.leakedPids} |`,
    "",
    `Workers: ${report.dbWorkers}. Samples: ${report.dbSamples}. SQLITE_BUSY: ${report.sqliteBusy}.`,
    `Board: ${report.boardTasks} tasks / ${report.boardRequirements} requirements. Paint p95: ${fixed(report.boardPaintP95Ms)} ms.`,
    `Secrets: ${report.secretsFound}. Views in Git: ${report.viewsTracked}. Post-stop merges: ${report.postStopMerges}.`,
    `Unauthorized claims before Resume: ${report.unauthorizedClaims}.`,
    "",
    "## Scenarios",
    "",
  ];
  for (const scenario of report.scenarios) {
    lines.push(`- ${scenario.pass ? "pass" : "fail"} ${scenario.id}: ${scenario.detail}`);
  }
  if (report.gate.detail.length > 0) {
    lines.push("", "## Gate detail", "");
    for (const line of report.gate.detail) lines.push(`- ${line}`);
  }
  lines.push("");
  return lines.join("\n");
}
