import { InvalidIntegratorOutputError } from "./errors.js";
import type { ProjectIntegratorBlocked, ProjectIntegratorSuccess, ProjectIntegratorV1 } from "./types.js";

const SUCCESS_KEYS = new Set(["migrations_order", "ccr_decisions", "rerun_suites"]);
const BLOCKED_KEYS = new Set(["blocked", "reason", "missing_ids"]);
const DECISION_KEYS = new Set(["id", "class", "decision"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidIntegratorOutputError(`${label} must be non-empty text`);
  }
  return value.trim();
}

function id(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (/\s/.test(parsed)) {
    throw new InvalidIntegratorOutputError(`${label} must not contain whitespace`);
  }
  return parsed;
}

function classOf(value: unknown, label: string): "additive" | "breaking" {
  if (value === "additive" || value === "breaking") return value;
  throw new InvalidIntegratorOutputError(`${label} is invalid`);
}

function decisionOf(value: unknown, label: string): "approve" | "revise" {
  if (value === "approve" || value === "revise") return value;
  throw new InvalidIntegratorOutputError(`${label} is invalid`);
}

function idList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new InvalidIntegratorOutputError(`${label} must be an array`);
  }
  return value.map((item, index) => id(item, `${label}[${index}]`));
}

function rejectExtra(record: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new InvalidIntegratorOutputError(`unexpected key ${key}`);
    }
  }
}

/**
 * Local port of Task 009 `ProjectIntegratorV1Schema`.
 * Success object or `{ blocked: true, reason, missing_ids? }`. Extra keys are rejected.
 * Additive decisions must be `approve`. Breaking decisions must be `revise`.
 */
export function parseProjectIntegratorV1(value: unknown): ProjectIntegratorV1 {
  if (!isRecord(value)) {
    throw new InvalidIntegratorOutputError("project-integrator@1 output must be an object");
  }
  if ("blocked" in value) {
    rejectExtra(value, BLOCKED_KEYS);
    if (value.blocked !== true) {
      throw new InvalidIntegratorOutputError("blocked must be true");
    }
    const blocked: ProjectIntegratorBlocked = {
      blocked: true,
      reason: text(value.reason, "reason"),
    };
    if ("missing_ids" in value) {
      return { ...blocked, missing_ids: idList(value.missing_ids, "missing_ids") };
    }
    return blocked;
  }
  rejectExtra(value, SUCCESS_KEYS);
  if (!Array.isArray(value.ccr_decisions)) {
    throw new InvalidIntegratorOutputError("ccr_decisions must be an array");
  }
  const decisions = value.ccr_decisions.map((item, index) => {
    if (!isRecord(item)) {
      throw new InvalidIntegratorOutputError(`ccr_decisions[${index}] must be an object`);
    }
    rejectExtra(item, DECISION_KEYS);
    const klass = classOf(item.class, `ccr_decisions[${index}].class`);
    const decision = decisionOf(item.decision, `ccr_decisions[${index}].decision`);
    if (klass === "additive" && decision !== "approve") {
      throw new InvalidIntegratorOutputError("additive change requests are approved");
    }
    if (klass === "breaking" && decision !== "revise") {
      throw new InvalidIntegratorOutputError("breaking change requests are sent to revision");
    }
    return { id: id(item.id, `ccr_decisions[${index}].id`), class: klass, decision };
  });
  const success: ProjectIntegratorSuccess = {
    migrations_order: idList(value.migrations_order, "migrations_order"),
    ccr_decisions: decisions,
    rerun_suites: idList(value.rerun_suites, "rerun_suites"),
  };
  return success;
}

export function isBlockedOutput(value: ProjectIntegratorV1): value is ProjectIntegratorBlocked {
  return "blocked" in value && value.blocked === true;
}
