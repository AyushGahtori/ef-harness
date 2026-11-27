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
  readonly rubricId?: string;
  readonly turnId: string;
  readonly turn?: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
}

/**
 * Canonical decision payload shared by opening, prompts, and entailment.
 * `criterion` stays the stored id. `criterionId`, `groupId`, and
 * `selectedOptionId` are the names later spec checks read.
 */
export interface DecisionFields {
  readonly criterion: string;
  readonly criterionId?: string;
  readonly groupId?: string;
  readonly selectedOptionId?: string;
  readonly status: CriterionStatus;
  readonly value: unknown;
  readonly basis?: SettledBasis;
  readonly delegation?: DelegationRecord;
  readonly limits?: DelegationRecord;
  readonly derivedFromIds?: readonly string[];
  readonly question_id?: string;
  readonly options?: readonly string[];
  readonly options_version?: number;
  readonly acceptance_examples?: readonly string[];
  readonly evidence?: readonly EvidenceSpan[];
  readonly needs_confirmation?: boolean;
  readonly must_ask?: boolean;
  readonly work_item?: string;
  readonly scope_id?: string;
  readonly deferred_reason?: string;
  readonly revisit_wave?: string;
  readonly delegated_at?: string;
  readonly stage_at_delegation?: string;
  readonly recommended_option_id?: string;
  readonly rationale?: string;
  readonly rule?: string;
  readonly premises?: readonly string[];
  readonly entailment_verdict?: string;
}

/** Frozen discovery node shape. `criterionId` mirrors `criterion` when omitted. */
export interface DecisionNodeFields {
  readonly criterionId: string;
  readonly groupId?: string;
  readonly value: unknown;
  readonly selectedOptionId?: string;
  readonly basis?: SettledBasis;
  readonly evidence?: readonly EvidenceSpan[];
  readonly limits?: DelegationRecord;
  readonly derivedFromIds?: readonly string[];
  readonly status: CriterionStatus;
  readonly criterion: string;
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
  return JSON.stringify(decisionFieldsJson(fields));
}

export function toDecisionNodeFields(fields: DecisionFields): DecisionNodeFields {
  let node: DecisionNodeFields = {
    criterionId: fields.criterionId ?? fields.criterion,
    criterion: fields.criterion,
    status: fields.status,
    value: fields.value ?? null,
  };
  if (fields.groupId !== undefined) node = { ...node, groupId: fields.groupId };
  if (fields.basis !== undefined) node = { ...node, basis: fields.basis };
  const selected = fields.selectedOptionId ?? settledOptionId(fields);
  if (selected !== undefined) node = { ...node, selectedOptionId: selected };
  if (fields.limits !== undefined) node = { ...node, limits: fields.limits };
  else if (fields.delegation !== undefined) node = { ...node, limits: fields.delegation };
  if (fields.derivedFromIds !== undefined) node = { ...node, derivedFromIds: fields.derivedFromIds };
  if (fields.evidence !== undefined) node = { ...node, evidence: fields.evidence };
  return node;
}

function settledOptionId(fields: DecisionFields): string | undefined {
  if (fields.status !== "settled") return undefined;
  if (typeof fields.value !== "string" || fields.value.length === 0) return undefined;
  return fields.value;
}

export function parseDecisionFields(raw: unknown): DecisionFields {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BasisStatusSeparationError("decision fields must be an object");
  }
  const record = raw as Record<string, unknown>;
  const criterion = readCriterion(record);
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
  if (typeof record.must_ask === "boolean") {
    next = { ...next, must_ask: record.must_ask };
  }
  next = copyString(next, record, "criterionId");
  next = copyString(next, record, "groupId");
  next = copyString(next, record, "selectedOptionId");
  next = copyString(next, record, "work_item");
  next = copyString(next, record, "scope_id");
  next = copyString(next, record, "deferred_reason");
  next = copyString(next, record, "revisit_wave");
  next = copyString(next, record, "delegated_at");
  next = copyString(next, record, "stage_at_delegation");
  next = copyString(next, record, "recommended_option_id");
  next = copyString(next, record, "rationale");
  next = copyString(next, record, "rule");
  next = copyString(next, record, "entailment_verdict");
  if (isStringArray(record.derivedFromIds)) {
    next = { ...next, derivedFromIds: record.derivedFromIds };
  }
  if (isStringArray(record.premises)) {
    next = { ...next, premises: record.premises };
  }
  if (record.limits !== undefined && record.limits !== null && typeof record.limits === "object" && !Array.isArray(record.limits)) {
    next = { ...next, limits: parseDelegation(record.limits) };
  }
  return next;
}

export function decisionFieldsJson(fields: DecisionFields): Record<string, unknown> {
  const json: Record<string, unknown> = {
    criterion: fields.criterion,
    criterionId: fields.criterionId ?? fields.criterion,
    status: fields.status,
    value: fields.value ?? null,
  };
  if (fields.basis !== undefined) json.basis = fields.basis;
  if (fields.delegation !== undefined) json.delegation = fields.delegation;
  if (fields.limits !== undefined) json.limits = fields.limits;
  if (fields.question_id !== undefined) json.question_id = fields.question_id;
  if (fields.options !== undefined) json.options = fields.options;
  if (fields.options_version !== undefined) json.options_version = fields.options_version;
  if (fields.acceptance_examples !== undefined) {
    json.acceptance_examples = fields.acceptance_examples;
  }
  if (fields.evidence !== undefined) json.evidence = fields.evidence;
  if (fields.needs_confirmation === true) json.needs_confirmation = true;
  if (fields.must_ask === true || fields.must_ask === false) json.must_ask = fields.must_ask;
  if (fields.groupId !== undefined) json.groupId = fields.groupId;
  const selected = fields.selectedOptionId ?? settledOptionId(fields);
  if (selected !== undefined) json.selectedOptionId = selected;
  if (fields.derivedFromIds !== undefined) json.derivedFromIds = fields.derivedFromIds;
  if (fields.work_item !== undefined) json.work_item = fields.work_item;
  if (fields.scope_id !== undefined) json.scope_id = fields.scope_id;
  if (fields.deferred_reason !== undefined) json.deferred_reason = fields.deferred_reason;
  if (fields.revisit_wave !== undefined) json.revisit_wave = fields.revisit_wave;
  if (fields.delegated_at !== undefined) json.delegated_at = fields.delegated_at;
  if (fields.stage_at_delegation !== undefined) json.stage_at_delegation = fields.stage_at_delegation;
  if (fields.recommended_option_id !== undefined) json.recommended_option_id = fields.recommended_option_id;
  if (fields.rationale !== undefined) json.rationale = fields.rationale;
  if (fields.rule !== undefined) json.rule = fields.rule;
  if (fields.premises !== undefined) json.premises = fields.premises;
  if (fields.entailment_verdict !== undefined) json.entailment_verdict = fields.entailment_verdict;
  return json;
}

function copyString<K extends "criterionId" | "groupId" | "selectedOptionId" | "work_item" | "scope_id" | "deferred_reason" | "revisit_wave" | "delegated_at" | "stage_at_delegation" | "recommended_option_id" | "rationale" | "rule" | "entailment_verdict">(
  fields: DecisionFields,
  record: Record<string, unknown>,
  key: K,
): DecisionFields {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) return fields;
  return { ...fields, [key]: value };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function readCriterion(record: Record<string, unknown>): string {
  if (typeof record.criterion === "string" && record.criterion.length > 0) return record.criterion;
  if (typeof record.criterionId === "string" && record.criterionId.length > 0) return record.criterionId;
  throw new BasisStatusSeparationError("decision fields.criterion must be a string");
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
  const turnId =
    typeof record.turnId === "string" && record.turnId.length > 0
      ? record.turnId
      : typeof record.turn === "string" && record.turn.length > 0
        ? record.turn
        : "";
  if (
    turnId.length === 0 ||
    typeof record.quote !== "string" ||
    typeof record.start !== "number" ||
    typeof record.end !== "number"
  ) {
    throw new BasisStatusSeparationError("evidence span is incomplete");
  }
  let span: EvidenceSpan = {
    turnId,
    quote: record.quote,
    start: record.start,
    end: record.end,
  };
  if (typeof record.rubricId === "string" && record.rubricId.length > 0) {
    span = { ...span, rubricId: record.rubricId };
  }
  if (typeof record.turn === "string" && record.turn.length > 0) {
    span = { ...span, turn: record.turn };
  }
  return span;
}

/**
 * Option id or limit tag to the constraint tags that option satisfies.
 * `sqlite` keeps `free` and `local`. Other catalog options are matched by tag,
 * not rejected for being something other than sqlite.
 */
export const VALUE_LIMIT_TAGS: Readonly<Record<string, readonly string[]>> = {
  sqlite: ["free", "local", "local_only", "relational_acid", "zero_paid_saas"],
  sqlite_relational: ["free", "local", "local_only", "relational_acid", "zero_paid_saas"],
  postgres: ["relational_acid"],
  postgres_relational: ["relational_acid"],
  local_only: ["local_only", "free", "local"],
  zero_paid_saas: ["zero_paid_saas", "free"],
  serverless_compatible: ["serverless_compatible"],
  relational_acid: ["relational_acid"],
  valkey: ["local_only"],
  playwright: ["local_only", "zero_paid_saas"],
  vitest: ["local_only", "zero_paid_saas"],
  mailpit: ["local_only", "zero_paid_saas"],
  sse: ["serverless_compatible"],
  cookie_session: ["local_only", "zero_paid_saas"],
};

export function valueSatisfiesLimits(
  value: string,
  limits: readonly string[],
  catalog: Readonly<Record<string, readonly string[]>> = VALUE_LIMIT_TAGS,
): boolean {
  const tags = catalog[value.trim().toLowerCase()];
  if (!tags) return false;
  return limits.every((limit) => tags.includes(limit.toLowerCase()));
}
