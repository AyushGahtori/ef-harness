import fs from "node:fs";
import path from "node:path";
import {
  BatchResolveV1Schema as SharedBatchResolveV1Schema,
  ClarifyV1Schema as SharedClarifyV1Schema,
  OpeningReviewV1Schema as SharedOpeningReviewV1Schema,
  canonicalAssetAbsolute,
} from "@ef-harness/shared-contracts";

import type {
  BatchDocumentV1,
  BatchProposal,
  BlockedExit,
  ClarifyOptionV1,
  ClarifyV1,
  ConflictSide,
  DelegationRecord,
  DiscoveryPromptId,
  EvidenceSpan,
  ItemSchemaFailure,
  ModelCompletion,
  ModelCompletionRequest,
  ModelProtocolAdapter,
  OpeningClaimV1,
  OpeningDomainV1,
  OpeningReviewV1,
  OpeningRubricId,
  OpeningRubricV1,
  ProposedGap,
  SchemaIssue,
} from "./types.js";
import { OPENING_RUBRIC_IDS } from "./types.js";

/**
 * Prompt runners validate `batch-resolve@1`, `opening-review@1`, and `clarify@1`
 * with `@ef-harness/shared-contracts`. The batch document parser below still
 * accepts the multi-proposal payload the orchestrator sends to the model.
 */

export interface ClosedSchema<T> {
  readonly id: string;
  safeParse(input: unknown): { success: true; data: T } | { success: false; issues: readonly SchemaIssue[] };
}

export interface PromptEnvelope {
  readonly text: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly rubricVersion: string;
  readonly ruleIds: readonly string[];
}

type ParseHit<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "blocked"; readonly blocked: BlockedExit }
  | { readonly kind: "invalid"; readonly issues: readonly SchemaIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectExtra(
  value: Record<string, unknown>,
  allowed: readonly string[],
  pathName: string,
  issues: SchemaIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.push({ path: `${pathName}.${key}`, message: "unknown key rejected by closed schema" });
    }
  }
}

function parseEvidence(value: unknown, pathName: string, issues: SchemaIssue[]): EvidenceSpan | null {
  if (!isRecord(value)) {
    issues.push({ path: pathName, message: "evidence span must be an object" });
    return null;
  }
  rejectExtra(value, ["turn", "start", "end", "quote"], pathName, issues);
  if (typeof value.turn !== "string" || value.turn.length === 0) {
    issues.push({ path: `${pathName}.turn`, message: "turn id is required" });
  }
  if (typeof value.start !== "number" || !Number.isInteger(value.start) || value.start < 0) {
    issues.push({ path: `${pathName}.start`, message: "start must be an integer >= 0" });
  }
  if (typeof value.end !== "number" || !Number.isInteger(value.end)) {
    issues.push({ path: `${pathName}.end`, message: "end must be an integer" });
  }
  if (typeof value.quote !== "string" || value.quote.length === 0) {
    issues.push({ path: `${pathName}.quote`, message: "quote is required" });
  }
  if (
    typeof value.turn === "string" &&
    typeof value.start === "number" &&
    typeof value.end === "number" &&
    typeof value.quote === "string" &&
    value.end <= value.start
  ) {
    issues.push({ path: `${pathName}.end`, message: "end must be greater than start" });
  }
  if (issues.some((issue) => issue.path.startsWith(pathName))) return null;
  return {
    turn: value.turn as string,
    start: value.start as number,
    end: value.end as number,
    quote: value.quote as string,
  };
}

function parseEvidenceList(value: unknown, pathName: string, issues: SchemaIssue[]): EvidenceSpan[] {
  if (!Array.isArray(value)) {
    issues.push({ path: pathName, message: "evidence must be an array" });
    return [];
  }
  const spans: EvidenceSpan[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const before = issues.length;
    const span = parseEvidence(value[index], `${pathName}[${index}]`, issues);
    if (span && issues.length === before) spans.push(span);
  }
  return spans;
}

function parseDelegation(value: unknown, pathName: string, issues: SchemaIssue[]): DelegationRecord | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    issues.push({ path: pathName, message: "delegation must be an object or null" });
    return null;
  }
  rejectExtra(value, ["scope", "limits", "turn"], pathName, issues);
  if (typeof value.scope !== "string" || value.scope.trim() === "") {
    issues.push({ path: `${pathName}.scope`, message: "scope is required" });
  }
  if (typeof value.turn !== "string" || value.turn.trim() === "") {
    issues.push({ path: `${pathName}.turn`, message: "turn is required" });
  }
  if (!Array.isArray(value.limits) || value.limits.some((limit) => typeof limit !== "string")) {
    issues.push({ path: `${pathName}.limits`, message: "limits must be a string array" });
  }
  if (issues.some((issue) => issue.path.startsWith(pathName))) return null;
  return {
    scope: value.scope as string,
    limits: value.limits as string[],
    turn: value.turn as string,
  };
}

export function parseBlocked(value: unknown): ParseHit<never> | { readonly kind: "absent" } {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, "blocked")) {
    return { kind: "absent" };
  }
  const issues: SchemaIssue[] = [];
  if (value.blocked !== true) {
    issues.push({ path: "blocked", message: "blocked must be true on an honest exit" });
  }
  rejectExtra(value, ["blocked", "reason", "missing_ids"], "$", issues);
  if (typeof value.reason !== "string" || value.reason.trim() === "") {
    issues.push({ path: "reason", message: "reason is required" });
  }
  let missingIds: string[] = [];
  if (Object.prototype.hasOwnProperty.call(value, "missing_ids")) {
    if (!Array.isArray(value.missing_ids) || value.missing_ids.some((id) => typeof id !== "string")) {
      issues.push({ path: "missing_ids", message: "missing_ids must be a string array" });
    } else {
      missingIds = value.missing_ids.filter((id): id is string => typeof id === "string");
    }
  }
  if (issues.length > 0 || typeof value.reason !== "string") return { kind: "invalid", issues };
  return { kind: "blocked", blocked: { reason: value.reason, missingIds } };
}

const STATUSES = ["settled", "partial", "missing", "conflict"] as const;
const BASES = ["explicit", "derived", "delegated"] as const;

export function parseBatchProposal(value: unknown, pathName: string): { proposal: BatchProposal | null; issues: SchemaIssue[] } {
  const issues: SchemaIssue[] = [];
  if (!isRecord(value)) {
    return { proposal: null, issues: [{ path: pathName, message: "proposal must be an object" }] };
  }
  rejectExtra(
    value,
    [
      "criterion",
      "question",
      "status",
      "basis",
      "value",
      "evidence",
      "rule",
      "premises",
      "delegation",
      "conflict",
      "missing_detail",
    ],
    pathName,
    issues,
  );
  if (typeof value.criterion !== "string" || value.criterion.trim() === "") {
    issues.push({ path: `${pathName}.criterion`, message: "criterion is required" });
  }
  if (typeof value.question !== "string" || value.question.trim() === "") {
    issues.push({ path: `${pathName}.question`, message: "question is required" });
  }
  if (typeof value.status !== "string" || !STATUSES.includes(value.status as (typeof STATUSES)[number])) {
    issues.push({ path: `${pathName}.status`, message: "status must be settled, partial, missing, or conflict" });
  }
  if (!(value.basis === null || (typeof value.basis === "string" && BASES.includes(value.basis as (typeof BASES)[number])))) {
    issues.push({ path: `${pathName}.basis`, message: "basis must be explicit, derived, delegated, or null" });
  }
  if (!(value.value === null || typeof value.value === "string")) {
    issues.push({ path: `${pathName}.value`, message: "value must be a string or null" });
  }
  const evidence = parseEvidenceList(value.evidence, `${pathName}.evidence`, issues);
  if (!(value.rule === null || typeof value.rule === "string")) {
    issues.push({ path: `${pathName}.rule`, message: "rule must be a string or null" });
  }
  if (!Array.isArray(value.premises) || value.premises.some((premise) => typeof premise !== "string")) {
    issues.push({ path: `${pathName}.premises`, message: "premises must be a string array" });
  }
  const delegation = parseDelegation(value.delegation, `${pathName}.delegation`, issues);
  let conflict: ConflictSide[] | null = null;
  if (value.conflict === null) conflict = null;
  else if (!Array.isArray(value.conflict)) {
    issues.push({ path: `${pathName}.conflict`, message: "conflict must be an array or null" });
  } else {
    conflict = [];
    for (let index = 0; index < value.conflict.length; index += 1) {
      const side = value.conflict[index];
      if (!isRecord(side)) {
        issues.push({ path: `${pathName}.conflict[${index}]`, message: "conflict side must be an object" });
        continue;
      }
      rejectExtra(side, ["evidence"], `${pathName}.conflict[${index}]`, issues);
      const sideEvidence = parseEvidenceList(side.evidence, `${pathName}.conflict[${index}].evidence`, issues);
      conflict.push({ evidence: sideEvidence });
    }
  }
  if (!(value.missing_detail === null || typeof value.missing_detail === "string")) {
    issues.push({ path: `${pathName}.missing_detail`, message: "missing_detail must be a string or null" });
  }
  if (value.status === "settled") {
    if (value.basis === null) {
      issues.push({ path: `${pathName}.basis`, message: "basis is required when status is settled" });
    }
    if (typeof value.value !== "string" || value.value.trim() === "") {
      issues.push({ path: `${pathName}.value`, message: "settled proposals need a value" });
    }
  } else if (value.basis !== null) {
    issues.push({ path: `${pathName}.basis`, message: "basis is set only when status is settled" });
  }
  if (value.status === "missing" && value.value !== null) {
    issues.push({ path: `${pathName}.value`, message: "missing proposals have a null value" });
  }
  if (value.status === "conflict" && value.value !== null) {
    issues.push({ path: `${pathName}.value`, message: "conflict proposals have a null value" });
  }
  if (value.basis === "derived" && (typeof value.rule !== "string" || value.rule.trim() === "")) {
    issues.push({ path: `${pathName}.rule`, message: "derived proposals name an allowlisted rule" });
  }
  if (value.basis === "derived" && (!Array.isArray(value.premises) || value.premises.length === 0)) {
    issues.push({ path: `${pathName}.premises`, message: "derived proposals list resolved premises" });
  }
  if (value.basis === "delegated" && delegation === null) {
    issues.push({ path: `${pathName}.delegation`, message: "delegated proposals record scope, limits, and turn" });
  }
  if (issues.length > 0) return { proposal: null, issues };
  return {
    proposal: {
      criterion: value.criterion as string,
      question: value.question as string,
      status: value.status as BatchProposal["status"],
      basis: value.basis as BatchProposal["basis"],
      value: value.value as string | null,
      evidence,
      rule: value.rule as string | null,
      premises: value.premises as string[],
      delegation,
      conflict,
      missing_detail: value.missing_detail as string | null,
    },
    issues: [],
  };
}

function parseGap(value: unknown, pathName: string): { gap: ProposedGap | null; issues: SchemaIssue[] } {
  const issues: SchemaIssue[] = [];
  if (!isRecord(value)) return { gap: null, issues: [{ path: pathName, message: "proposed gap must be an object" }] };
  rejectExtra(value, ["criterion", "source"], pathName, issues);
  if (typeof value.criterion !== "string" || value.criterion.trim() === "") {
    issues.push({ path: `${pathName}.criterion`, message: "criterion is required" });
  }
  if (typeof value.source !== "string" || value.source.trim() === "") {
    issues.push({ path: `${pathName}.source`, message: "source is required" });
  }
  if (issues.length > 0) return { gap: null, issues };
  return { gap: { criterion: value.criterion as string, source: value.source as string }, issues: [] };
}

export function parseBatchDocument(value: unknown): ParseHit<BatchDocumentV1> {
  const blocked = parseBlocked(value);
  if (blocked.kind !== "absent") return blocked;

  let items: unknown[] = [];
  let gaps: unknown[] = [];
  if (Array.isArray(value)) {
    items = value;
  } else if (isRecord(value) && Array.isArray(value.proposals)) {
    const issues: SchemaIssue[] = [];
    rejectExtra(value, ["proposals", "proposed_gaps"], "$", issues);
    if (issues.length > 0) return { kind: "invalid", issues };
    items = value.proposals;
    gaps = Array.isArray(value.proposed_gaps) ? value.proposed_gaps : [];
    if (Object.prototype.hasOwnProperty.call(value, "proposed_gaps") && !Array.isArray(value.proposed_gaps)) {
      return { kind: "invalid", issues: [{ path: "proposed_gaps", message: "proposed_gaps must be an array" }] };
    }
  } else if (isRecord(value) && typeof value.criterion === "string" && typeof value.status === "string") {
    items = [value];
  } else {
    return {
      kind: "invalid",
      issues: [{ path: "$", message: "batch-resolve output must be a proposal, an array, or { proposals }" }],
    };
  }

  const proposals: BatchProposal[] = [];
  const itemIssues: ItemSchemaFailure[] = [];
  items.forEach((item, index) => {
    const parsed = parseBatchProposal(item, `proposals[${index}]`);
    if (parsed.proposal) proposals.push(parsed.proposal);
    else {
      const record = isRecord(item) ? item : null;
      itemIssues.push({
        index,
        criterion: record && typeof record.criterion === "string" ? record.criterion : null,
        question: record && typeof record.question === "string" ? record.question : null,
        issues: parsed.issues,
      });
    }
  });
  const proposedGaps: ProposedGap[] = [];
  const gapIssues: SchemaIssue[] = [];
  gaps.forEach((gap, index) => {
    const parsed = parseGap(gap, `proposed_gaps[${index}]`);
    if (parsed.gap) proposedGaps.push(parsed.gap);
    else gapIssues.push(...parsed.issues);
  });
  if (proposals.length === 0) {
    const issues = itemIssues.flatMap((item) => item.issues);
    if (issues.length > 0) return { kind: "invalid", issues };
    if (gapIssues.length > 0) return { kind: "invalid", issues: gapIssues };
    return { kind: "invalid", issues: [{ path: "proposals", message: "at least one proposal is required" }] };
  }
  return {
    kind: "value",
    value: { proposals, proposed_gaps: proposedGaps, itemIssues, gapIssues },
  };
}

export const BatchResolveV1Schema = SharedBatchResolveV1Schema;

const CLAIM_KINDS = ["value", "recommendation_request", "delegation"] as const;

function parseOpening(value: unknown): ParseHit<OpeningReviewV1> {
  const blocked = parseBlocked(value);
  if (blocked.kind !== "absent") return blocked;
  if (!isRecord(value)) return { kind: "invalid", issues: [{ path: "$", message: "opening review must be an object" }] };
  const issues: SchemaIssue[] = [];
  rejectExtra(value, ["rubrics", "follow_up", "domains"], "$", issues);
  if (!Array.isArray(value.rubrics)) issues.push({ path: "rubrics", message: "rubrics must be an array" });
  if (!Array.isArray(value.domains)) issues.push({ path: "domains", message: "domains must be an array" });
  const rubrics: OpeningRubricV1[] = [];
  if (Array.isArray(value.rubrics)) {
    value.rubrics.forEach((entry, index) => {
      const pathName = `rubrics[${index}]`;
      if (!isRecord(entry)) {
        issues.push({ path: pathName, message: "rubric must be an object" });
        return;
      }
      rejectExtra(entry, ["rubric", "covered", "claims", "smallest_gap"], pathName, issues);
      if (typeof entry.rubric !== "string" || !OPENING_RUBRIC_IDS.includes(entry.rubric as OpeningRubricId)) {
        issues.push({ path: `${pathName}.rubric`, message: "rubric must be opening.1 through opening.5" });
      }
      if (!Array.isArray(entry.covered) || entry.covered.some((item) => typeof item !== "string")) {
        issues.push({ path: `${pathName}.covered`, message: "covered must be a string array" });
      }
      if (!(entry.smallest_gap === null || typeof entry.smallest_gap === "string")) {
        issues.push({ path: `${pathName}.smallest_gap`, message: "smallest_gap must be a string or null" });
      }
      const claims: OpeningClaimV1[] = [];
      if (!Array.isArray(entry.claims)) {
        issues.push({ path: `${pathName}.claims`, message: "claims must be an array" });
      } else {
        entry.claims.forEach((claim, claimIndex) => {
          const claimPath = `${pathName}.claims[${claimIndex}]`;
          if (!isRecord(claim)) {
            issues.push({ path: claimPath, message: "claim must be an object" });
            return;
          }
          rejectExtra(claim, ["criterion", "kind", "value", "evidence"], claimPath, issues);
          if (typeof claim.criterion !== "string" || claim.criterion.trim() === "") {
            issues.push({ path: `${claimPath}.criterion`, message: "criterion is required" });
          }
          if (typeof claim.kind !== "string" || !CLAIM_KINDS.includes(claim.kind as (typeof CLAIM_KINDS)[number])) {
            issues.push({ path: `${claimPath}.kind`, message: "kind must be value, recommendation_request, or delegation" });
          }
          if (!(claim.value === null || typeof claim.value === "string")) {
            issues.push({ path: `${claimPath}.value`, message: "value must be a string or null" });
          }
          const evidence = parseEvidenceList(claim.evidence, `${claimPath}.evidence`, issues);
          if (issues.some((issue) => issue.path.startsWith(claimPath))) return;
          claims.push({
            criterion: claim.criterion as string,
            kind: claim.kind as OpeningClaimV1["kind"],
            value: claim.value as string | null,
            evidence,
          });
        });
      }
      if (issues.some((issue) => issue.path.startsWith(pathName) && !issue.path.includes(".claims["))) return;
      if (typeof entry.rubric !== "string") return;
      rubrics.push({
        rubric: entry.rubric as OpeningRubricId,
        covered: Array.isArray(entry.covered) ? entry.covered.filter((item): item is string => typeof item === "string") : [],
        claims,
        smallest_gap: typeof entry.smallest_gap === "string" || entry.smallest_gap === null ? entry.smallest_gap : null,
      });
    });
  }
  let followUp: OpeningReviewV1["follow_up"] = null;
  if (value.follow_up === null) followUp = null;
  else if (!isRecord(value.follow_up)) issues.push({ path: "follow_up", message: "follow_up must be an object or null" });
  else {
    rejectExtra(value.follow_up, ["rubric", "question"], "follow_up", issues);
    if (typeof value.follow_up.rubric !== "string" || !OPENING_RUBRIC_IDS.includes(value.follow_up.rubric as OpeningRubricId)) {
      issues.push({ path: "follow_up.rubric", message: "follow_up.rubric must be an opening rubric id" });
    }
    if (typeof value.follow_up.question !== "string" || value.follow_up.question.trim() === "") {
      issues.push({ path: "follow_up.question", message: "follow_up.question is required" });
    }
    if (typeof value.follow_up.rubric === "string" && typeof value.follow_up.question === "string") {
      followUp = { rubric: value.follow_up.rubric as OpeningRubricId, question: value.follow_up.question };
    }
  }
  const domains: OpeningDomainV1[] = [];
  if (Array.isArray(value.domains)) {
    value.domains.forEach((entry, index) => {
      const pathName = `domains[${index}]`;
      if (!isRecord(entry)) {
        issues.push({ path: pathName, message: "domain must be an object" });
        return;
      }
      rejectExtra(entry, ["pack", "evidence", "certain"], pathName, issues);
      if (typeof entry.pack !== "string" || entry.pack.trim() === "") {
        issues.push({ path: `${pathName}.pack`, message: "pack is required" });
      }
      if (typeof entry.certain !== "boolean") {
        issues.push({ path: `${pathName}.certain`, message: "certain must be boolean" });
      }
      const evidence = parseEvidenceList(entry.evidence, `${pathName}.evidence`, issues);
      if (typeof entry.pack === "string" && typeof entry.certain === "boolean") {
        domains.push({ pack: entry.pack, evidence, certain: entry.certain });
      }
    });
  }
  if (issues.length > 0) return { kind: "invalid", issues };
  return { kind: "value", value: { rubrics, follow_up: followUp, domains } };
}

export const OpeningReviewV1Schema = SharedOpeningReviewV1Schema;

function parseClarify(value: unknown): ParseHit<ClarifyV1> {
  const blocked = parseBlocked(value);
  if (blocked.kind !== "absent") return blocked;
  if (!isRecord(value)) return { kind: "invalid", issues: [{ path: "$", message: "clarify output must be an object" }] };
  const issues: SchemaIssue[] = [];
  rejectExtra(value, ["question_id", "criterion", "text", "options", "free_text"], "$", issues);
  if (typeof value.question_id !== "string" || value.question_id.trim() === "") {
    issues.push({ path: "question_id", message: "question_id is required" });
  }
  if (typeof value.criterion !== "string" || value.criterion.trim() === "") {
    issues.push({ path: "criterion", message: "criterion is required" });
  }
  if (typeof value.text !== "string" || value.text.trim() === "") {
    issues.push({ path: "text", message: "text is required" });
  }
  if (value.free_text !== true) {
    issues.push({ path: "free_text", message: "free_text must be true so the developer can answer in their own words" });
  }
  const options: ClarifyOptionV1[] = [];
  if (!Array.isArray(value.options)) {
    issues.push({ path: "options", message: "options must be an array" });
  } else {
    value.options.forEach((option, index) => {
      const pathName = `options[${index}]`;
      if (!isRecord(option)) {
        issues.push({ path: pathName, message: "option must be an object" });
        return;
      }
      rejectExtra(option, ["id", "label", "recommended"], pathName, issues);
      if (typeof option.id !== "string" || option.id.trim() === "") {
        issues.push({ path: `${pathName}.id`, message: "id is required" });
      }
      if (typeof option.label !== "string" || option.label.trim() === "") {
        issues.push({ path: `${pathName}.label`, message: "label is required" });
      }
      if (Object.prototype.hasOwnProperty.call(option, "recommended") && typeof option.recommended !== "boolean") {
        issues.push({ path: `${pathName}.recommended`, message: "recommended must be boolean" });
      }
      if (typeof option.id === "string" && typeof option.label === "string") {
        if (typeof option.recommended === "boolean") {
          options.push({ id: option.id, label: option.label, recommended: option.recommended });
        } else {
          options.push({ id: option.id, label: option.label });
        }
      }
    });
  }
  if (issues.length > 0 || typeof value.question_id !== "string" || typeof value.criterion !== "string" || typeof value.text !== "string") {
    return { kind: "invalid", issues };
  }
  return {
    kind: "value",
    value: {
      question_id: value.question_id,
      criterion: value.criterion,
      text: value.text,
      options,
      free_text: true,
    },
  };
}

export const ClarifyV1Schema = SharedClarifyV1Schema;

export function extractSingleJson(text: string): { ok: true; value: unknown } | { ok: false; issues: readonly SchemaIssue[] } {
  const trimmed = text.trim();
  const fences = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  if (fences.length > 1) {
    return { ok: false, issues: [{ path: "$", message: "ambiguous multi-block JSON" }] };
  }
  const body = fences.length === 1 ? (fences[0]?.[1] ?? "").trim() : trimmed;
  if (!(body.startsWith("{") || body.startsWith("["))) {
    return { ok: false, issues: [{ path: "$", message: "no JSON object" }] };
  }
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false, issues: [{ path: "$", message: "invalid JSON" }] };
  }
}

export function escapeUntrusted(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function buildPromptEnvelope(input: {
  readonly promptId: string;
  readonly instruction: string;
  readonly rubricVersion: string;
  readonly ruleIds: readonly string[];
  readonly userText?: string;
  readonly data?: readonly { readonly source: string; readonly text: string }[];
}): PromptEnvelope {
  const version = input.promptId.includes("@") ? (input.promptId.split("@")[1] ?? "1") : "1";
  const instruction = [
    "<instruction>",
    `prompt_id: ${input.promptId}`,
    `prompt_version: ${version}`,
    `rubric_version: ${input.rubricVersion}`,
    `rule_ids: ${input.ruleIds.join(",")}`,
    input.instruction,
    "</instruction>",
  ].join("\n");
  const parts = [instruction];
  if (input.userText !== undefined) {
    parts.push(`<user>\n${escapeUntrusted(input.userText)}\n</user>`);
  }
  for (const block of input.data ?? []) {
    const source = escapeUntrusted(block.source).replaceAll('"', "&quot;");
    parts.push(`<data source="${source}">\n${escapeUntrusted(block.text)}\n</data>`);
  }
  return {
    text: parts.join("\n"),
    promptId: input.promptId,
    promptVersion: version,
    rubricVersion: input.rubricVersion,
    ruleIds: input.ruleIds,
  };
}

export function buildFormatRepairMessage(
  schemaId: string,
  issues: readonly SchemaIssue[],
  invalidOutput: string,
): string {
  return [
    `Format repair for ${schemaId}. Return only one JSON value matching the closed schema.`,
    "Validator errors:",
    ...issues.map((issue) => `${issue.path}: ${issue.message}`),
    "Invalid output follows.",
    invalidOutput,
  ].join("\n");
}

export class FakeModelAdapter implements ModelProtocolAdapter {
  readonly calls: ModelCompletionRequest[] = [];

  constructor(private readonly respond: (request: ModelCompletionRequest) => string) {}

  complete(request: ModelCompletionRequest): Promise<ModelCompletion> {
    this.calls.push(request);
    return Promise.resolve({ text: this.respond(request) });
  }
}

export const OPENING_RUBRIC_MAP_V1 = {
  id: "opening-rubric-map@1",
  rubrics: {
    "opening.1": {
      criteria: ["product.purpose", "delivery.platform"],
      partial: [] as readonly string[],
      delegations: false,
    },
    "opening.2": {
      criteria: ["product.audience", "actors.roles"],
      partial: [] as readonly string[],
      delegations: false,
    },
    "opening.3": {
      criteria: ["workflows.primary", "data.entities"],
      partial: ["data.entities"],
      delegations: false,
    },
    "opening.4": {
      criteria: ["workflows.primary", "product.stage"],
      partial: ["product.stage"],
      delegations: false,
    },
    "opening.5": {
      criteria: ["constraints.stack_preferences", "deploy.target", "constraints.deadline_budget"],
      partial: [] as readonly string[],
      delegations: true,
    },
  },
} as const;

export class InvalidRubricMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRubricMapError";
  }
}

export function openingRubricTargets(rubric: OpeningRubricId): {
  readonly criteria: readonly string[];
  readonly partial: readonly string[];
  readonly delegations: boolean;
} {
  return OPENING_RUBRIC_MAP_V1.rubrics[rubric];
}

export function assertOpeningRubricMap(activeCatalogIds: readonly string[]): void {
  const missing: string[] = [];
  for (const rubric of OPENING_RUBRIC_IDS) {
    for (const criterion of OPENING_RUBRIC_MAP_V1.rubrics[rubric].criteria) {
      if (!activeCatalogIds.includes(criterion)) missing.push(criterion);
    }
  }
  if (missing.length > 0) {
    throw new InvalidRubricMapError(`opening-rubric-map@1 target missing from catalog: ${missing.join(", ")}`);
  }
}

export function repositoryRoot(): string {
  const fromEnv = process.env.EF_HARNESS_RESOURCES_DIR ?? process.env.EF_HARNESS_RESOURCES;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv.trim());
  }
  const resourcesPath = Reflect.get(process, "resourcesPath");
  if (typeof resourcesPath === "string" && resourcesPath.length > 0) {
    if (fs.existsSync(path.join(resourcesPath, "opening-prompts.md"))) return resourcesPath;
  }
  return path.resolve(canonicalAssetAbsolute("inferOrAskSkill"), "..", "..", "..");
}

export function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repositoryRoot(), relativePath), "utf8");
}

export function extractBlockquote(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const at = lines.findIndex((line) => line.trim() === `### ${heading}`);
  if (at < 0) throw new Error(`missing prompt heading ${heading}`);
  const quotes: string[] = [];
  for (let index = at + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("### ")) break;
    if (line.startsWith("> ")) quotes.push(line.slice(2));
    else if (line.startsWith(">")) quotes.push(line.slice(1).trimStart());
    else if (quotes.length > 0 && line.trim() === "") break;
  }
  if (quotes.length === 0) throw new Error(`missing prompt text for ${heading}`);
  return quotes.join(" ").replace(/\s+/g, " ").trim();
}

let openingPrompts: string | null = null;
let skillBody: string | null = null;

export function loadDiscoveryPromptText(promptId: DiscoveryPromptId): string {
  openingPrompts ??= readRepoFile("opening-prompts.md");
  return extractBlockquote(openingPrompts, promptId);
}

export function loadInferOrAskSkillDigest(): string {
  if (skillBody) return skillBody;
  const raw = readRepoFile("skills/infer-or-ask/SKILL.md");
  const version = /^version:\s*(\d+)\s*$/m.exec(raw)?.[1];
  if (version !== "1") {
    throw new Error("infer-or-ask skill is not version 1");
  }
  skillBody = raw.replace(/^---[\s\S]*?---\s*/, "").trim();
  return skillBody;
}

export function interpretModelOutput<T>(text: string, parse: (value: unknown) => ParseHit<T>): {
  readonly hit: ParseHit<T>;
  readonly raw: string;
} {
  const extracted = extractSingleJson(text);
  if (!extracted.ok) return { hit: { kind: "invalid", issues: [...extracted.issues] }, raw: text };
  return { hit: parse(extracted.value), raw: text };
}

export { parseOpening, parseClarify };
export type { ParseHit };
