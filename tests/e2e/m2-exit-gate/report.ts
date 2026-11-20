import { createHash } from "node:crypto";
import fs from "node:fs";
import type { BaselineMetrics, GateDecision, M2ExitGateReport, TokenSplit } from "./types.ts";

export const M2_EXIT_GATE_REPORT_SCHEMA = "m2-exit-gate-report@1" as const;

export const BASELINE_KEYS = [
  "totalWallClockSec",
  "phase0Sec",
  "waveBuildSec",
  "completionAuditSec",
  "totalTokens",
  "paperworkPct",
  "hiddenPassCount",
  "hiddenTotalCount",
  "passRatePct",
] as const;

export function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function signReport(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

export function paperworkTokens(tokens: TokenSplit): number {
  return tokens.discovery + tokens.spec + tokens.research + tokens.architecture + tokens.planning + tokens.audit;
}

export function totalTokens(tokens: TokenSplit): number {
  return paperworkTokens(tokens) + tokens.coding;
}

export function paperworkPct(tokens: TokenSplit): number {
  const total = totalTokens(tokens);
  if (total <= 0) return 1;
  return Number((paperworkTokens(tokens) / total).toFixed(4));
}

export function passRatePct(passCount: number, totalCount: number): number {
  if (totalCount <= 0) return 0;
  return Number(((passCount / totalCount) * 100).toFixed(2));
}

export function validateBaselineMetrics(value: BaselineMetrics, schemaText: string): string[] {
  const schema = JSON.parse(schemaText) as { required?: string[]; additionalProperties?: boolean };
  const errors: string[] = [];
  const required = schema.required ?? [];
  for (const key of required) {
    if (!(key in value)) errors.push(`missing ${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!required.includes(key)) errors.push(`extra ${key}`);
  }
  if (value.hiddenTotalCount < 25) errors.push("hiddenTotalCount below 25");
  if (value.hiddenPassCount < 0 || value.hiddenPassCount > value.hiddenTotalCount) errors.push("hiddenPassCount");
  if (value.paperworkPct < 0 || value.paperworkPct > 1) errors.push("paperworkPct range");
  if (value.passRatePct < 0 || value.passRatePct > 100) errors.push("passRatePct range");
  if (value.totalTokens < 0 || !Number.isInteger(value.totalTokens)) errors.push("totalTokens");
  for (const key of ["totalWallClockSec", "phase0Sec", "waveBuildSec", "completionAuditSec"] as const) {
    if (value[key] < 0) errors.push(`${key} negative`);
  }
  return errors;
}

export interface GateInput {
  hiddenPassCount: number;
  hiddenTotalCount: number;
  paperworkPct: number;
  leakedPids: number;
  secretsFound: number;
  staticAuditFailures: number;
  falseOverInferences: number;
  viewsTracked: number;
  trailersValid: boolean;
  cleanTree: boolean;
  hiddenLeak: boolean;
}

export function evaluateExitGate(input: GateInput): GateDecision {
  const reasons: string[] = [];
  const rate = input.hiddenTotalCount > 0 ? input.hiddenPassCount / input.hiddenTotalCount : 0;
  if (!(rate >= 0.9)) reasons.push("hiddenPassRate");
  if (input.hiddenTotalCount < 25) reasons.push("hiddenTotalCount");
  if (!(input.paperworkPct <= 0.2)) reasons.push("paperworkPct");
  if (input.leakedPids !== 0) reasons.push("leakedPids");
  if (input.secretsFound !== 0) reasons.push("secretsFound");
  if (input.staticAuditFailures !== 0) reasons.push("staticAudit");
  if (input.falseOverInferences !== 0) reasons.push("falseOverInference");
  if (input.viewsTracked !== 0) reasons.push("viewsTracked");
  if (!input.trailersValid) reasons.push("trailers");
  if (!input.cleanTree) reasons.push("dirtyTree");
  if (input.hiddenLeak) reasons.push("hiddenLeak");
  return { exitCode: reasons.length === 0 ? 0 : 1, reasons };
}

export function signingView(report: M2ExitGateReport): unknown {
  return {
    schema: report.schema,
    mode: report.mode,
    baseline: report.baseline,
    gate: report.gate,
    hiddenPassRate: report.hiddenPassRate,
    paperworkPct: report.paperworkPct,
    leakedPids: report.leakedPids,
    secretsFound: report.secretsFound,
    staticAuditFailures: report.staticAuditFailures,
    falseOverInferences: report.falseOverInferences,
    checks: report.checks.map((check) => ({ id: check.id, pass: check.pass })),
    stages: report.stages,
    claimedCertification: report.claimedCertification,
  };
}

export function renderReport(report: M2ExitGateReport): string {
  const lines = [
    "# M2 Kitchen exit gate",
    "",
    `- Mode: ${report.mode}`,
    `- Gate exit: ${report.gate.exitCode}`,
    `- Reasons: ${report.gate.reasons.length === 0 ? "none" : report.gate.reasons.join(", ")}`,
    `- Hidden pass rate: ${report.hiddenPassRate}`,
    `- Paperwork fraction: ${report.paperworkPct}`,
    `- Leaked PIDs: ${report.leakedPids}`,
    `- Secrets: ${report.secretsFound}`,
    `- Static audit failures: ${report.staticAuditFailures}`,
    `- False over-inferences: ${report.falseOverInferences}`,
    `- Claimed certification: ${report.claimedCertification ? "yes" : "no"}`,
    `- Signature: ${report.signature}`,
    "",
    "## Baseline",
    "",
    "```json",
    JSON.stringify(report.baseline, null, 2),
    "```",
    "",
    "## Hidden checks",
    "",
  ];
  for (const check of report.checks) {
    lines.push(`- ${check.pass ? "PASS" : "FAIL"} ${check.id}: ${check.title}`);
  }
  lines.push("", "## Stages", "");
  for (const stage of report.stages) lines.push(`- ${stage}`);
  lines.push("");
  return lines.join("\n");
}

export function readSchema(schemaPath: string): string {
  return fs.readFileSync(schemaPath, "utf8");
}
