import { DepthError } from "./errors.js";
import type {
  AutomaticBasis,
  CriterionDomain,
  DepthDecision,
  ProjectStage,
  SettledBasis,
  SupersessionRecord,
} from "./types.js";
import {
  isAutomaticBasis,
  isCriterionStatus,
  isMustAskClass,
  isProjectStage,
  isRiskTier,
  isSettledBasis,
} from "./types.js";

export function decisionToJson(decision: DepthDecision): Record<string, unknown> {
  const json: Record<string, unknown> = {
    criterion: decision.criterionId,
    label: decision.label,
    status: decision.status,
    value: decision.value,
    work_item: decision.workItemId,
    impact_level: decision.impactLevel,
    downstream_task_count: decision.downstreamTaskCount,
    must_ask: decision.mustAsk,
  };
  if (decision.basis !== undefined) json.basis = decision.basis;
  if (decision.rationale !== undefined) json.rationale = decision.rationale;
  if (decision.recommendedOptionId !== undefined) json.recommended_option_id = decision.recommendedOptionId;
  if (decision.delegatedAt !== undefined) json.delegated_at = decision.delegatedAt;
  if (decision.defaultedAt !== undefined) json.defaulted_at = decision.defaultedAt;
  if (decision.stageAtDelegation !== undefined) json.stage_at_delegation = decision.stageAtDelegation;
  if (decision.decisionBadge !== undefined) json.decision_badge = decision.decisionBadge;
  if (decision.mustAskClass !== undefined) json.must_ask_class = decision.mustAskClass;
  if (decision.supersession !== undefined) {
    json.supersession = {
      previous_basis: decision.supersession.previousBasis,
      previous_value: decision.supersession.previousValue,
      previous_version: decision.supersession.previousVersion,
    };
  }
  if (decision.askValue !== undefined) json.ask_value = decision.askValue;
  if (decision.impact !== undefined) json.impact = decision.impact;
  if (decision.uncertainty !== undefined) json.uncertainty = decision.uncertainty;
  if (decision.domain !== undefined) json.domain = decision.domain;
  if (decision.conflict === true) json.conflict = true;
  if (decision.highRiskSpecExpander === true) json.high_risk_spec_expander = true;
  if (decision.ambiguousBrownfield === true) json.ambiguous_brownfield = true;
  return json;
}

export function parseDecision(nodeId: string, version: number, raw: unknown): DepthDecision {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DepthError(`decision ${nodeId} fields must be an object`);
  }
  const record = raw as Record<string, unknown>;
  const criterionId = requiredString(record, "criterion");
  const label = requiredString(record, "label");
  const status = requiredString(record, "status");
  if (!isCriterionStatus(status)) throw new DepthError(`decision ${nodeId} has status ${status}`);
  const workItemId = requiredString(record, "work_item");
  const impactLevel = requiredString(record, "impact_level");
  if (!isRiskTier(impactLevel)) throw new DepthError(`decision ${nodeId} has impact ${impactLevel}`);
  const downstream = record.downstream_task_count;
  if (typeof downstream !== "number" || !Number.isInteger(downstream)) {
    throw new DepthError(`decision ${nodeId} is missing downstream_task_count`);
  }
  const value = record.value;
  const decision: DepthDecision = {
    nodeId,
    version,
    criterionId,
    label,
    status,
    value: typeof value === "string" ? value : null,
    workItemId,
    impactLevel,
    downstreamTaskCount: downstream,
    mustAsk: record.must_ask === true,
  };
  return applyOptional(decision, record);
}

function applyOptional(base: DepthDecision, record: Record<string, unknown>): DepthDecision {
  let next = base;
  if (typeof record.basis === "string") {
    if (!isSettledBasis(record.basis)) throw new DepthError(`basis ${record.basis} is not settled`);
    next = { ...next, basis: record.basis };
  }
  if (typeof record.rationale === "string") next = { ...next, rationale: record.rationale };
  if (typeof record.recommended_option_id === "string") {
    next = { ...next, recommendedOptionId: record.recommended_option_id };
  }
  if (typeof record.delegated_at === "number") next = { ...next, delegatedAt: record.delegated_at };
  if (typeof record.defaulted_at === "number") next = { ...next, defaultedAt: record.defaulted_at };
  if (typeof record.stage_at_delegation === "string" && isProjectStage(record.stage_at_delegation)) {
    next = { ...next, stageAtDelegation: record.stage_at_delegation };
  }
  if (typeof record.decision_badge === "string") next = { ...next, decisionBadge: record.decision_badge };
  if (typeof record.must_ask_class === "string" && isMustAskClass(record.must_ask_class)) {
    next = { ...next, mustAskClass: record.must_ask_class };
  }
  const supersession = parseSupersession(record.supersession);
  if (supersession) next = { ...next, supersession };
  if (typeof record.ask_value === "number") next = { ...next, askValue: record.ask_value };
  if (typeof record.impact === "number") next = { ...next, impact: record.impact };
  if (typeof record.uncertainty === "number") next = { ...next, uncertainty: record.uncertainty };
  if (typeof record.domain === "string") next = { ...next, domain: record.domain as CriterionDomain };
  if (record.conflict === true) next = { ...next, conflict: true };
  if (record.high_risk_spec_expander === true) next = { ...next, highRiskSpecExpander: true };
  if (record.ambiguous_brownfield === true) next = { ...next, ambiguousBrownfield: true };
  assertPairing(next);
  return next;
}

function parseSupersession(raw: unknown): SupersessionRecord | null {
  if (raw === undefined || raw === null) return null;
  if (!raw || typeof raw !== "object") throw new DepthError("supersession must be an object");
  const record = raw as Record<string, unknown>;
  if (typeof record.previous_basis !== "string" || !isAutomaticBasis(record.previous_basis)) {
    throw new DepthError("supersession previous_basis must be delegated or defaulted");
  }
  if (typeof record.previous_value !== "string" || typeof record.previous_version !== "number") {
    throw new DepthError("supersession is incomplete");
  }
  return {
    previousBasis: record.previous_basis,
    previousValue: record.previous_value,
    previousVersion: record.previous_version,
  };
}

function assertPairing(decision: DepthDecision): void {
  if (decision.status === "settled") {
    if (decision.basis === undefined) throw new DepthError(`${decision.criterionId} is settled without a basis`);
    if (decision.value === null || decision.value.length === 0) {
      throw new DepthError(`${decision.criterionId} is settled without a value`);
    }
    return;
  }
  if (decision.basis !== undefined) {
    throw new DepthError(`${decision.criterionId} stores basis ${decision.basis} while ${decision.status}`);
  }
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new DepthError(`decision fields.${key} must be a string`);
  }
  return value;
}

export function decisionNodeId(workItemId: string, criterionId: string): string {
  return `decision:${workItemId}:${criterionId}`;
}

export function projectStageNodeId(workItemId: string): string {
  return `project-stage:${workItemId}`;
}

export interface StageNodeFields {
  readonly role: "project_stage";
  readonly workItemId: string;
  readonly stage: ProjectStage;
  readonly askThreshold: number;
  readonly importanceThreshold: number;
  readonly visibleQuestionCap: number;
  readonly verificationLevel: "relaxed" | "standard" | "strict";
}

export function stageToJson(fields: StageNodeFields): Record<string, unknown> {
  return {
    role: fields.role,
    work_item: fields.workItemId,
    stage: fields.stage,
    ask_threshold: fields.askThreshold,
    importance_threshold: fields.importanceThreshold,
    visible_question_cap: fields.visibleQuestionCap,
    verification_level: fields.verificationLevel,
  };
}

export function parseStage(raw: unknown): StageNodeFields {
  if (!raw || typeof raw !== "object") throw new DepthError("project stage fields must be an object");
  const record = raw as Record<string, unknown>;
  if (record.role !== "project_stage") throw new DepthError("project stage node has the wrong role");
  if (typeof record.work_item !== "string" || typeof record.stage !== "string" || !isProjectStage(record.stage)) {
    throw new DepthError("project stage node is incomplete");
  }
  if (
    typeof record.ask_threshold !== "number" ||
    typeof record.importance_threshold !== "number" ||
    typeof record.visible_question_cap !== "number" ||
    (record.verification_level !== "relaxed" &&
      record.verification_level !== "standard" &&
      record.verification_level !== "strict")
  ) {
    throw new DepthError("project stage profile is incomplete");
  }
  return {
    role: "project_stage",
    workItemId: record.work_item,
    stage: record.stage,
    askThreshold: record.ask_threshold,
    importanceThreshold: record.importance_threshold,
    visibleQuestionCap: record.visible_question_cap,
    verificationLevel: record.verification_level,
  };
}

export function stripSettlement(decision: DepthDecision): DepthDecision {
  const next: DepthDecision = {
    nodeId: decision.nodeId,
    version: decision.version,
    criterionId: decision.criterionId,
    label: decision.label,
    status: "open",
    value: null,
    workItemId: decision.workItemId,
    impactLevel: decision.impactLevel,
    downstreamTaskCount: decision.downstreamTaskCount,
    mustAsk: decision.mustAsk,
  };
  return copyIdentity(decision, next);
}

function copyIdentity(source: DepthDecision, target: DepthDecision): DepthDecision {
  let next = target;
  if (source.mustAskClass !== undefined) next = { ...next, mustAskClass: source.mustAskClass };
  if (source.domain !== undefined) next = { ...next, domain: source.domain };
  if (source.conflict === true) next = { ...next, conflict: true };
  if (source.highRiskSpecExpander === true) next = { ...next, highRiskSpecExpander: true };
  if (source.ambiguousBrownfield === true) next = { ...next, ambiguousBrownfield: true };
  return next;
}

export function automaticFields(input: {
  readonly current: DepthDecision;
  readonly basis: AutomaticBasis;
  readonly optionId: string;
  readonly rationale: string;
  readonly stage: ProjectStage;
  readonly at: number;
  readonly askValue: number;
  readonly impact: number;
  readonly uncertainty: number;
}): DepthDecision {
  const next: DepthDecision = {
    nodeId: input.current.nodeId,
    version: input.current.version,
    criterionId: input.current.criterionId,
    label: input.current.label,
    status: "settled",
    value: input.optionId,
    workItemId: input.current.workItemId,
    impactLevel: input.current.impactLevel,
    downstreamTaskCount: input.current.downstreamTaskCount,
    mustAsk: false,
    basis: input.basis,
    rationale: input.rationale,
    recommendedOptionId: input.optionId,
    stageAtDelegation: input.stage,
    askValue: input.askValue,
    impact: input.impact,
    uncertainty: input.uncertainty,
  };
  const stamped =
    input.basis === "delegated" ? { ...next, delegatedAt: input.at } : { ...next, defaultedAt: input.at };
  return copyIdentity(input.current, stamped);
}

export function explicitFields(input: {
  readonly current: DepthDecision;
  readonly optionId: string;
  readonly rationale: string;
  readonly supersession?: SupersessionRecord;
}): DepthDecision {
  const next: DepthDecision = {
    nodeId: input.current.nodeId,
    version: input.current.version,
    criterionId: input.current.criterionId,
    label: input.current.label,
    status: "settled",
    value: input.optionId,
    workItemId: input.current.workItemId,
    impactLevel: input.current.impactLevel,
    downstreamTaskCount: input.current.downstreamTaskCount,
    mustAsk: input.current.mustAsk,
    basis: "explicit" satisfies SettledBasis,
    rationale: input.rationale,
  };
  let stamped = copyIdentity(input.current, next);
  if (input.supersession) stamped = { ...stamped, supersession: input.supersession };
  return stamped;
}

export function derivedFields(input: {
  readonly current: DepthDecision;
  readonly optionId: string;
  readonly rationale: string;
}): DepthDecision {
  const next: DepthDecision = {
    nodeId: input.current.nodeId,
    version: input.current.version,
    criterionId: input.current.criterionId,
    label: input.current.label,
    status: "settled",
    value: input.optionId,
    workItemId: input.current.workItemId,
    impactLevel: input.current.impactLevel,
    downstreamTaskCount: input.current.downstreamTaskCount,
    mustAsk: input.current.mustAsk,
    basis: "derived",
    rationale: input.rationale,
  };
  return copyIdentity(input.current, next);
}
