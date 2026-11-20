import { Phase0Error } from "./errors.js";
import type { Gate0Receipt, GateCheckRecord, GateCommandRecord, StyleguideThumbnail } from "./types.js";
import { INTEGRATION_BRANCH } from "./types.js";

export interface ReceiptDraft {
  readonly projectId: string;
  readonly status: "PASS" | "FAIL";
  readonly integrationSha: string;
  readonly repairAttempts: number;
  readonly commands: readonly GateCommandRecord[];
  readonly checks: readonly GateCheckRecord[];
  readonly failingTaskId: string | null;
  readonly failureKind: string | null;
  readonly styleguideThumbnail: StyleguideThumbnail | null;
  readonly escalated: boolean;
  readonly quarantine: readonly string[];
  readonly recordedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushIssue(issues: string[], condition: boolean, message: string): void {
  if (!condition) issues.push(message);
}

/**
 * Wave 1 stays locked unless this receipt is a verified PASS for the
 * current `harness/integration` HEAD.
 */
export function wave1MayStart(receipt: Gate0Receipt | null, headSha: string): boolean {
  if (!receipt) return false;
  return receipt.status === "PASS" && receipt.wave1Unlocked && receipt.integrationSha === headSha;
}

export function buildGate0Receipt(draft: ReceiptDraft): Gate0Receipt {
  const wave1Unlocked = draft.status === "PASS" && !draft.escalated;
  const receipt: Gate0Receipt = {
    schema: "gate0_receipt@1",
    projectId: draft.projectId,
    status: draft.status,
    integrationRef: INTEGRATION_BRANCH,
    integrationSha: draft.integrationSha,
    wave1Unlocked,
    repairAttempts: draft.repairAttempts,
    commands: draft.commands,
    checks: draft.checks,
    failingTaskId: draft.status === "PASS" ? null : draft.failingTaskId,
    failureKind: draft.status === "PASS" ? null : draft.failureKind,
    styleguideThumbnail: draft.styleguideThumbnail,
    escalated: draft.escalated,
    quarantine: draft.quarantine,
    recordedAt: draft.recordedAt,
  };
  return Gate0ReceiptSchema.parse(receipt);
}

export const Gate0ReceiptSchema = {
  id: "gate0_receipt@1" as const,
  parse(value: unknown): Gate0Receipt {
    const parsed = Gate0ReceiptSchema.safeParse(value);
    if (!parsed.ok) {
      throw new Phase0Error("invalid_receipt", parsed.issues.join("; "));
    }
    return parsed.data;
  },
  safeParse(value: unknown): { ok: true; data: Gate0Receipt } | { ok: false; issues: readonly string[] } {
    const issues: string[] = [];
    pushIssue(issues, isRecord(value), "receipt must be an object");
    if (!isRecord(value)) return { ok: false, issues };
    pushIssue(issues, value.schema === "gate0_receipt@1", "schema must be gate0_receipt@1");
    pushIssue(issues, typeof value.projectId === "string" && value.projectId.length > 0, "projectId is required");
    pushIssue(issues, value.status === "PASS" || value.status === "FAIL", "status must be PASS or FAIL");
    pushIssue(issues, value.integrationRef === INTEGRATION_BRANCH, "integrationRef must be harness/integration");
    pushIssue(
      issues,
      typeof value.integrationSha === "string" && /^[0-9a-f]{40}$/.test(value.integrationSha),
      "integrationSha must be a 40-character git sha",
    );
    pushIssue(issues, typeof value.wave1Unlocked === "boolean", "wave1Unlocked must be boolean");
    pushIssue(
      issues,
      typeof value.repairAttempts === "number" && Number.isInteger(value.repairAttempts) && value.repairAttempts >= 0 && value.repairAttempts <= 2,
      "repairAttempts must be an integer from 0 to 2",
    );
    pushIssue(issues, typeof value.escalated === "boolean", "escalated must be boolean");
    pushIssue(issues, typeof value.recordedAt === "number" && Number.isInteger(value.recordedAt), "recordedAt must be an integer");
    pushIssue(issues, value.failingTaskId === null || typeof value.failingTaskId === "string", "failingTaskId must be a string or null");
    pushIssue(issues, value.failureKind === null || typeof value.failureKind === "string", "failureKind must be a string or null");
    if (value.status === "PASS" && value.wave1Unlocked !== true) {
      issues.push("PASS receipt must unlock Wave 1");
    }
    if (value.status === "FAIL" && value.wave1Unlocked === true) {
      issues.push("FAIL receipt must keep Wave 1 locked");
    }
    if (value.status === "PASS" && value.escalated === true) {
      issues.push("an escalated receipt cannot pass");
    }
    const commands = parseCommands(value.commands, issues);
    const checks = parseChecks(value.checks, issues);
    const quarantine = parseStrings(value.quarantine, "quarantine", issues);
    const thumbnail = parseThumbnail(value.styleguideThumbnail, issues);
    if (issues.length > 0 || !commands || !checks || !quarantine) {
      return { ok: false, issues };
    }
    const data: Gate0Receipt = {
      schema: "gate0_receipt@1",
      projectId: value.projectId as string,
      status: value.status as "PASS" | "FAIL",
      integrationRef: INTEGRATION_BRANCH,
      integrationSha: value.integrationSha as string,
      wave1Unlocked: value.wave1Unlocked as boolean,
      repairAttempts: value.repairAttempts as number,
      commands,
      checks,
      failingTaskId: (value.failingTaskId as string | null) ?? null,
      failureKind: (value.failureKind as string | null) ?? null,
      styleguideThumbnail: thumbnail,
      escalated: value.escalated as boolean,
      quarantine,
      recordedAt: value.recordedAt as number,
    };
    return { ok: true, data };
  },
};

function parseCommands(value: unknown, issues: string[]): readonly GateCommandRecord[] | null {
  if (!Array.isArray(value)) {
    issues.push("commands must be an array");
    return null;
  }
  const commands: GateCommandRecord[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      issues.push("command record must be an object");
      continue;
    }
    const duration = item.durationMs;
    const exitCode = item.exitCode;
    if (typeof item.id !== "string" || typeof item.command !== "string") {
      issues.push("command id and command are required");
      continue;
    }
    if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 0) {
      issues.push(`command ${item.id} durationMs must be an integer >= 0`);
      continue;
    }
    if (typeof exitCode !== "number" || !Number.isInteger(exitCode)) {
      issues.push(`command ${item.id} exitCode must be an integer`);
      continue;
    }
    commands.push({ id: item.id, command: item.command, durationMs: duration, exitCode });
  }
  return commands;
}

function parseChecks(value: unknown, issues: string[]): readonly GateCheckRecord[] | null {
  if (!Array.isArray(value)) {
    issues.push("checks must be an array");
    return null;
  }
  const checks: GateCheckRecord[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      issues.push("check record must be an object");
      continue;
    }
    const status = item.status;
    if (typeof item.id !== "string" || typeof item.ownerTaskId !== "string" || typeof item.detail !== "string") {
      issues.push("check id, ownerTaskId, and detail are required");
      continue;
    }
    if (status !== "pass" && status !== "fail" && status !== "not_applicable") {
      issues.push(`check ${item.id} has an unknown status`);
      continue;
    }
    checks.push({ id: item.id, ownerTaskId: item.ownerTaskId, status, detail: item.detail });
  }
  return checks;
}

function parseStrings(value: unknown, label: string, issues: string[]): readonly string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    issues.push(`${label} must be a string array`);
    return null;
  }
  return value as string[];
}

function parseThumbnail(value: unknown, issues: string[]): StyleguideThumbnail | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    issues.push("styleguideThumbnail must be an object or null");
    return null;
  }
  const viewport = value.viewport;
  if (value.route !== "/__styleguide") issues.push("thumbnail route must be /__styleguide");
  if (typeof value.casId !== "string" || !/^[0-9a-f]{64}$/.test(value.casId)) issues.push("thumbnail casId must be a sha256");
  if (typeof value.mime !== "string" || value.mime.length === 0) issues.push("thumbnail mime is required");
  if (typeof value.bytes !== "number" || !Number.isInteger(value.bytes) || value.bytes <= 0) {
    issues.push("thumbnail bytes must be a positive integer");
  }
  if (viewport !== "375" && viewport !== "1440") issues.push("thumbnail viewport must be 375 or 1440");
  if (issues.length > 0) return null;
  return {
    route: "/__styleguide",
    casId: value.casId as string,
    mime: value.mime as string,
    bytes: value.bytes as number,
    viewport: viewport as "375" | "1440",
  };
}
