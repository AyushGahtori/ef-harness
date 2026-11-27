import { InvalidIntegratorOutputError } from "./errors.js";
import type { FeatureIntegratorBlocked, FeatureIntegratorSuccess, FeatureIntegratorV1 } from "./types.js";

const SUCCESS_KEYS = new Set(["resolved_conflicts", "wiring_done", "rerun_checks"]);
const BLOCKED_KEYS = new Set(["blocked", "reason", "missing_ids"]);

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
 * Local port of Task 009 `FeatureIntegratorV1Schema`.
 * Accepts the success object or `{ blocked: true, reason, missing_ids? }` and rejects extra keys.
 */
export function parseFeatureIntegratorV1(value: unknown): FeatureIntegratorV1 {
  if (!isRecord(value)) {
    throw new InvalidIntegratorOutputError("feature-integrator@1 output must be an object");
  }
  if ("blocked" in value) {
    rejectExtra(value, BLOCKED_KEYS);
    if (value.blocked !== true) {
      throw new InvalidIntegratorOutputError("blocked must be true");
    }
    const blocked: FeatureIntegratorBlocked = {
      blocked: true,
      reason: text(value.reason, "reason"),
    };
    if ("missing_ids" in value) {
      return { ...blocked, missing_ids: idList(value.missing_ids, "missing_ids") };
    }
    return blocked;
  }
  rejectExtra(value, SUCCESS_KEYS);
  if (!Array.isArray(value.resolved_conflicts)) {
    throw new InvalidIntegratorOutputError("resolved_conflicts must be an array");
  }
  const resolved = value.resolved_conflicts.map((item, index) => {
    if (!isRecord(item)) {
      throw new InvalidIntegratorOutputError(`resolved_conflicts[${index}] must be an object`);
    }
    rejectExtra(item, new Set(["path", "summary"]));
    return {
      path: text(item.path, `resolved_conflicts[${index}].path`),
      summary: text(item.summary, `resolved_conflicts[${index}].summary`),
    };
  });
  const success: FeatureIntegratorSuccess = {
    resolved_conflicts: resolved,
    wiring_done: idList(value.wiring_done, "wiring_done"),
    rerun_checks: idList(value.rerun_checks, "rerun_checks"),
  };
  return success;
}

export function isBlockedOutput(value: FeatureIntegratorV1): value is FeatureIntegratorBlocked {
  return "blocked" in value && value.blocked === true;
}
