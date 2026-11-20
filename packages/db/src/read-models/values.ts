import type { SQLInputValue } from "node:sqlite";
import { REQUIREMENT_STATUSES, type RequirementStatusName } from "./types.js";

export type SqlValue = SQLInputValue;
export type SqlRow = Record<string, SQLInputValue | undefined>;

const STATUS_NAMES = new Set<string>(REQUIREMENT_STATUSES);

export function text(value: SQLInputValue | undefined, label: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  throw new Error(`${label} is not text`);
}

export function nullableText(value: SQLInputValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  throw new Error("expected text or null");
}

export function integer(value: SQLInputValue | undefined, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint") {
    const number = Number(value);
    if (Number.isSafeInteger(number)) return number;
  }
  throw new Error(`${label} is not a safe integer`);
}

export function nullableInteger(value: SQLInputValue | undefined): number | null {
  if (value === null || value === undefined) return null;
  return integer(value, "integer");
}

export function requirementStatus(value: SQLInputValue | undefined): RequirementStatusName {
  const status = text(value, "requirement status");
  if (!STATUS_NAMES.has(status)) {
    throw new Error(`unexpected requirement status ${status}`);
  }
  return status as RequirementStatusName;
}

export function emptyRequirementCounts(): Record<RequirementStatusName, number> {
  return {
    uncovered: 0,
    pending: 0,
    passing: 0,
    failing: 0,
    waived: 0,
  };
}

export function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
