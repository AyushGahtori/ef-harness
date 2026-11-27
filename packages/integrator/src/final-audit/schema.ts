import { InvalidAuditorOutputError } from "./errors.js";

export interface LocatedFinding {
  readonly requirement: string;
  readonly location: string;
  readonly detail: string;
}

export interface WeakCheckFinding {
  readonly check: string;
  readonly requirement: string;
  readonly why: string;
}

export interface FinalProjectAuditorSuccess {
  readonly missing: readonly LocatedFinding[];
  readonly stubbed: readonly LocatedFinding[];
  readonly unhandled_edge_cases: readonly LocatedFinding[];
  readonly weak_checks: readonly WeakCheckFinding[];
  readonly verdict: "complete" | "incomplete";
}

export interface FinalProjectAuditorBlocked {
  readonly blocked: true;
  readonly reason: string;
  readonly missing_ids?: readonly string[];
}

export type FinalProjectAuditorV1 = FinalProjectAuditorSuccess | FinalProjectAuditorBlocked;

const SUCCESS_KEYS = ["missing", "stubbed", "unhandled_edge_cases", "weak_checks", "verdict"] as const;
const BLOCKED_KEYS = ["blocked", "reason", "missing_ids"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new InvalidAuditorOutputError(`unexpected key ${key}`);
    }
  }
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new InvalidAuditorOutputError(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) {
    throw new InvalidAuditorOutputError(`${label} must be a non-empty id without whitespace`);
  }
  return trimmed;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new InvalidAuditorOutputError(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new InvalidAuditorOutputError(`${label} must be non-empty text`);
  }
  return trimmed;
}

function located(value: unknown, label: string): LocatedFinding {
  if (!isRecord(value)) {
    throw new InvalidAuditorOutputError(`${label} must be an object`);
  }
  assertExactKeys(value, ["requirement", "location", "detail"]);
  return {
    requirement: requiredId(value.requirement, `${label}.requirement`),
    location: requiredText(value.location, `${label}.location`),
    detail: requiredText(value.detail, `${label}.detail`),
  };
}

function locatedList(value: unknown, label: string): LocatedFinding[] {
  if (!Array.isArray(value)) {
    throw new InvalidAuditorOutputError(`${label} must be an array`);
  }
  return value.map((item, index) => located(item, `${label}[${index}]`));
}

function weakList(value: unknown): WeakCheckFinding[] {
  if (!Array.isArray(value)) {
    throw new InvalidAuditorOutputError("weak_checks must be an array");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new InvalidAuditorOutputError(`weak_checks[${index}] must be an object`);
    }
    assertExactKeys(item, ["check", "requirement", "why"]);
    return {
      check: requiredId(item.check, `weak_checks[${index}].check`),
      requirement: requiredId(item.requirement, `weak_checks[${index}].requirement`),
      why: requiredText(item.why, `weak_checks[${index}].why`),
    };
  });
}

function parseBlocked(record: Record<string, unknown>): FinalProjectAuditorBlocked {
  assertExactKeys(record, BLOCKED_KEYS);
  if (record.blocked !== true) {
    throw new InvalidAuditorOutputError("blocked exit must set blocked to true");
  }
  const blocked: FinalProjectAuditorBlocked = {
    blocked: true,
    reason: requiredText(record.reason, "reason"),
  };
  if (record.missing_ids === undefined) return blocked;
  if (!Array.isArray(record.missing_ids)) {
    throw new InvalidAuditorOutputError("missing_ids must be an array");
  }
  return {
    ...blocked,
    missing_ids: record.missing_ids.map((item, index) => requiredId(item, `missing_ids[${index}]`)),
  };
}

function parseSuccess(record: Record<string, unknown>): FinalProjectAuditorSuccess {
  assertExactKeys(record, SUCCESS_KEYS);
  if (record.verdict !== "complete" && record.verdict !== "incomplete") {
    throw new InvalidAuditorOutputError("verdict must be complete or incomplete");
  }
  const success: FinalProjectAuditorSuccess = {
    missing: locatedList(record.missing, "missing"),
    stubbed: locatedList(record.stubbed, "stubbed"),
    unhandled_edge_cases: locatedList(record.unhandled_edge_cases, "unhandled_edge_cases"),
    weak_checks: weakList(record.weak_checks),
    verdict: record.verdict,
  };
  const nonempty =
    success.missing.length > 0 ||
    success.stubbed.length > 0 ||
    success.unhandled_edge_cases.length > 0 ||
    success.weak_checks.length > 0;
  if (success.verdict === "complete" && nonempty) {
    throw new InvalidAuditorOutputError(
      "verdict complete is valid only when missing, stubbed, unhandled_edge_cases, and weak_checks are all empty",
    );
  }
  return success;
}

/** Local port of Task 009 `FinalProjectAuditorV1Schema` (strict success or honest blocked exit). */
export function parseFinalProjectAuditorV1(input: unknown): FinalProjectAuditorV1 {
  if (!isRecord(input)) {
    throw new InvalidAuditorOutputError("auditor output must be an object");
  }
  if ("blocked" in input) return parseBlocked(input);
  return parseSuccess(input);
}

export function isBlockedAuditor(value: FinalProjectAuditorV1): value is FinalProjectAuditorBlocked {
  return "blocked" in value && value.blocked === true;
}
