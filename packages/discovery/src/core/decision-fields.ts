import { BasisStatusSeparationError } from "./errors.js";
import {
  isCriterionStatus,
  isSettledBasis,
  type CriterionStatus,
  type SettledBasis,
} from "./vocabularies.js";

export interface DelegationRecord {
  readonly scope: string;
  readonly limits: readonly string[];
  readonly turn: string;
}

export interface EvidenceSpan {
  readonly rubricId: string;
  readonly turnId: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
}

export interface DecisionFields {
  readonly criterion: string;
  readonly status: CriterionStatus;
  readonly value: unknown;
  readonly basis?: SettledBasis;
  readonly delegation?: DelegationRecord;
  readonly question_id?: string;
  readonly options?: readonly string[];
  readonly options_version?: number;
  readonly acceptance_examples?: readonly string[];
  readonly evidence?: readonly EvidenceSpan[];
  readonly needs_confirmation?: boolean;
  readonly work_item?: string;
}

export function decisionValueCredit(fields: DecisionFields): 0 | 1 {
  if (fields.status !== "settled" || fields.basis === undefined) return 0;
  if (fields.value === null || fields.value === "") return 0;
  return 1;
}

export function assertDecisionFields(fields: DecisionFields): void {
  if (!isCriterionStatus(fields.status)) {
    throw new BasisStatusSeparationError(`unknown criterion status: ${String(fields.status)}`);
  }
  if (fields.basis !== undefined && !isSettledBasis(fields.basis)) {
    throw new BasisStatusSeparationError(
      `basis ${String(fields.basis)} is not in SETTLED_BASES`,
    );
  }
  if (fields.status === "settled") {
    if (fields.basis === undefined) {
      throw new BasisStatusSeparationError("a settled decision requires a settled basis");
    }
    if (fields.value === null || fields.value === "") {
      throw new BasisStatusSeparationError("a settled decision requires a value");
    }
    return;
  }
  if (fields.basis !== undefined) {
    throw new BasisStatusSeparationError(
      `basis ${fields.basis} cannot be stored while status is ${fields.status}`,
    );
  }
}

export function serializeDecisionFields(fields: DecisionFields): string {
  assertDecisionFields(fields);
  return JSON.stringify(decisionToJson(fields));
}

export function parseDecisionFields(raw: unknown): DecisionFields {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BasisStatusSeparationError("decision fields must be an object");
  }
  const record = raw as Record<string, unknown>;
  const criterion = requiredString(record, "criterion");
  const status = record.status;
  if (!isCriterionStatus(status)) {
    throw new BasisStatusSeparationError(`unknown criterion status: ${String(status)}`);
  }
  const fields: DecisionFields = {
    criterion,
    status,
    value: record.value ?? null,
  };
  const withOptional = applyOptional(fields, record);
  assertDecisionFields(withOptional);
  return withOptional;
}

function applyOptional(base: DecisionFields, record: Record<string, unknown>): DecisionFields {
  let next: DecisionFields = base;
  if (record.basis !== undefined && record.basis !== null) {
    if (!isSettledBasis(record.basis)) {
      throw new BasisStatusSeparationError(`basis ${String(record.basis)} is not in SETTLED_BASES`);
    }
    next = { ...next, basis: record.basis };
  }
  if (record.delegation !== undefined && record.delegation !== null) {
    next = { ...next, delegation: parseDelegation(record.delegation) };
  }
  if (typeof record.question_id === "string") {
    next = { ...next, question_id: record.question_id };
  }
  if (Array.isArray(record.options)) {
    next = { ...next, options: record.options.map((item) => String(item)) };
  }
  if (typeof record.options_version === "number") {
    next = { ...next, options_version: record.options_version };
  }
  if (Array.isArray(record.acceptance_examples)) {
    next = { ...next, acceptance_examples: record.acceptance_examples.map((item) => String(item)) };
  }
  if (Array.isArray(record.evidence)) {
    next = { ...next, evidence: record.evidence.map((item) => parseEvidence(item)) };
  }
  if (record.needs_confirmation === true) {
    next = { ...next, needs_confirmation: true };
  }
  if (typeof record.work_item === "string") {
    next = { ...next, work_item: record.work_item };
  }
  return next;
}

function decisionToJson(fields: DecisionFields): Record<string, unknown> {
  const json: Record<string, unknown> = {
    criterion: fields.criterion,
    status: fields.status,
    value: fields.value ?? null,
  };
  if (fields.basis !== undefined) json.basis = fields.basis;
  if (fields.delegation !== undefined) json.delegation = fields.delegation;
  if (fields.question_id !== undefined) json.question_id = fields.question_id;
  if (fields.options !== undefined) json.options = fields.options;
  if (fields.options_version !== undefined) json.options_version = fields.options_version;
  if (fields.acceptance_examples !== undefined) {
    json.acceptance_examples = fields.acceptance_examples;
  }
  if (fields.evidence !== undefined) json.evidence = fields.evidence;
  if (fields.needs_confirmation === true) json.needs_confirmation = true;
  if (fields.work_item !== undefined) json.work_item = fields.work_item;
  return json;
}

function parseDelegation(raw: unknown): DelegationRecord {
  if (!raw || typeof raw !== "object") {
    throw new BasisStatusSeparationError("delegation must be an object");
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.scope !== "string" || typeof record.turn !== "string") {
    throw new BasisStatusSeparationError("delegation requires scope and turn");
  }
  if (!Array.isArray(record.limits) || record.limits.some((item) => typeof item !== "string")) {
    throw new BasisStatusSeparationError("delegation limits must be strings");
  }
  return {
    scope: record.scope,
    limits: record.limits as string[],
    turn: record.turn,
  };
}

function parseEvidence(raw: unknown): EvidenceSpan {
  if (!raw || typeof raw !== "object") {
    throw new BasisStatusSeparationError("evidence span must be an object");
  }
  const record = raw as Record<string, unknown>;
  if (
    typeof record.rubricId !== "string" ||
    typeof record.turnId !== "string" ||
    typeof record.quote !== "string" ||
    typeof record.start !== "number" ||
    typeof record.end !== "number"
  ) {
    throw new BasisStatusSeparationError("evidence span is incomplete");
  }
  return {
    rubricId: record.rubricId,
    turnId: record.turnId,
    quote: record.quote,
    start: record.start,
    end: record.end,
  };
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new BasisStatusSeparationError(`decision fields.${key} must be a string`);
  }
  return value;
}

/** Values known to satisfy a recorded limit token. Unknown values are outside the bounds. */
const VALUE_LIMIT_TAGS: Readonly<Record<string, readonly string[]>> = {
  sqlite: ["free", "local"],
};

export function valueSatisfiesLimits(value: string, limits: readonly string[]): boolean {
  const tags = VALUE_LIMIT_TAGS[value.trim().toLowerCase()];
  if (!tags) return false;
  return limits.every((limit) => tags.includes(limit.toLowerCase()));
}
