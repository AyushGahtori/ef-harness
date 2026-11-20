import { CorpusShapeError } from "./errors.js";
import {
  CORPUS_DOCUMENT_KINDS,
  IMPACT_CLASSES,
  PROJECT_STAGES,
  QUESTION_SCOPES,
  QUESTION_STATUSES,
  REVERSIBILITY_VALUES,
  type AppliesWhenClause,
  type CorpusDocumentKind,
  type CrossCuttingRuleManifest,
  type ElaborationCellManifest,
  type ImpactClass,
  type LoadedQuestion,
  type NegativeExampleManifest,
  type OptionElaborationManifest,
  type OptionManifest,
  type PositiveExampleManifest,
  type ProjectStage,
  type QuestionEvalManifest,
  type QuestionManifest,
  type QuestionScope,
  type QuestionStatus,
  type Reversibility,
  type RuleScopeManifest,
  type SeamTemplateManifest,
  type StageRecommendationManifest,
  type UniversalPolicyManifest,
} from "./types.js";

const QUESTION_ID = /^Q-[A-Z][A-Z0-9]*-\d{2,}$/;
const CRITERION_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const PLAIN_ID = /^[a-z][a-z0-9_-]*$/;
const POLICY_ID = /^UP-\d{2}$/;
const RULE_ID = /^X-\d{2}$/;

const QUESTION_KEYS = new Set([
  "id",
  "version",
  "scope",
  "domains",
  "title",
  "explain",
  "criteria",
  "applies_when",
  "requires",
  "conflicts_with",
  "risk_tier",
  "impact",
  "reversibility",
  "must_ask",
  "touches",
  "options",
  "stage_recommendations",
  "allowed_inference_rules",
  "invalidates_on_change",
  "positive_examples",
  "negative_examples",
  "stage_applicability",
  "status",
  "eval",
  "renamed_from",
]);

export function inferDocumentKind(relativePath: string, declared: unknown): CorpusDocumentKind {
  if (typeof declared === "string" && (CORPUS_DOCUMENT_KINDS as readonly string[]).includes(declared)) {
    return declared as CorpusDocumentKind;
  }
  const posix = relativePath.replaceAll("\\", "/");
  if (posix.includes("/elaborations/") || posix.startsWith("elaborations/")) return "option_elaborations";
  if (posix.includes("/policies/") || posix.startsWith("policies/")) return "universal_policies";
  if (posix.includes("/rules-seams/") || posix.startsWith("rules-seams/")) {
    return posix.includes("seam") ? "seam_templates" : "cross_cutting_rules";
  }
  if (posix.includes("/packs/") || posix.startsWith("packs/")) return "question_pack";
  throw new CorpusShapeError(
    `Cannot tell corpus document kind for ${relativePath}. Set kind to one of ${CORPUS_DOCUMENT_KINDS.join(", ")}.`,
    { filePath: relativePath },
  );
}

export function readQuestionPack(
  document: unknown,
  filePath: string,
): { readonly id: string; readonly version: number; readonly title: string; readonly questions: LoadedQuestion[] } {
  const record = asRecord(document, filePath, "question pack");
  assertKeys(record, new Set(["kind", "id", "version", "title", "questions"]), ["kind", "id", "version", "title", "questions"], filePath);
  if (record.kind !== "question_pack") {
    throw new CorpusShapeError(`Expected kind question_pack in ${filePath}`, { filePath });
  }
  const questions = asArray(record.questions, filePath, "questions").map((item, index) =>
    readQuestion(item, filePath, index),
  );
  return {
    id: readId(record.id, filePath, "pack id"),
    version: readVersion(record.version, filePath),
    title: readText(record.title, filePath, "title"),
    questions,
  };
}

export function readQuestion(value: unknown, filePath: string, index: number): LoadedQuestion {
  const record = asRecord(value, filePath, `questions[${index}]`);
  assertKeys(
    record,
    QUESTION_KEYS,
    [
      "id",
      "version",
      "scope",
      "domains",
      "title",
      "explain",
      "criteria",
      "applies_when",
      "requires",
      "conflicts_with",
      "risk_tier",
      "impact",
      "reversibility",
      "must_ask",
      "touches",
      "options",
      "stage_recommendations",
      "allowed_inference_rules",
      "invalidates_on_change",
      "positive_examples",
      "negative_examples",
      "stage_applicability",
      "status",
      "eval",
    ],
    filePath,
  );
  const id = readQuestionId(record.id, filePath);
  const question: QuestionManifest = {
    id,
    version: readVersion(record.version, filePath, id),
    scope: readEnum(record.scope, QUESTION_SCOPES, filePath, id, "scope") as QuestionScope,
    domains: readStringList(record.domains, filePath, id, "domains"),
    title: readText(record.title, filePath, "title", id),
    explain: readText(record.explain, filePath, "explain", id),
    criteria: readCriteria(record.criteria, filePath, id),
    applies_when: readAppliesWhen(record.applies_when, filePath, id),
    requires: readQuestionIdList(record.requires, filePath, id, "requires"),
    conflicts_with: readQuestionIdList(record.conflicts_with, filePath, id, "conflicts_with"),
    risk_tier: readEnum(record.risk_tier, IMPACT_CLASSES, filePath, id, "risk_tier") as ImpactClass,
    impact: readEnum(record.impact, IMPACT_CLASSES, filePath, id, "impact") as ImpactClass,
    reversibility: readEnum(record.reversibility, REVERSIBILITY_VALUES, filePath, id, "reversibility") as Reversibility,
    must_ask: readBoolean(record.must_ask, filePath, id, "must_ask"),
    touches: readStringList(record.touches, filePath, id, "touches"),
    options: readOptions(record.options, filePath, id),
    stage_recommendations: readStageRecommendations(record.stage_recommendations, filePath, id),
    allowed_inference_rules: readStringList(record.allowed_inference_rules, filePath, id, "allowed_inference_rules"),
    invalidates_on_change: readCriteriaList(record.invalidates_on_change, filePath, id, "invalidates_on_change"),
    positive_examples: readPositiveExamples(record.positive_examples, filePath, id),
    negative_examples: readNegativeExamples(record.negative_examples, filePath, id),
    stage_applicability: readStageApplicability(record.stage_applicability, filePath, id),
    status: readEnum(record.status, QUESTION_STATUSES, filePath, id, "status") as QuestionStatus,
    eval: readEval(record.eval, filePath, id),
  };
  if (record.renamed_from !== undefined) {
    const renamed = readQuestionId(record.renamed_from, filePath, id);
    if (renamed === id) {
      throw new CorpusShapeError(`Question ${id} cannot rename from itself in ${filePath}`, {
        filePath,
        questionId: id,
      });
    }
    return { ...question, renamed_from: renamed, source_file: filePath };
  }
  return { ...question, source_file: filePath };
}

export function readElaborationPack(document: unknown, filePath: string): {
  readonly id: string;
  readonly version: number;
  readonly elaborations: OptionElaborationManifest[];
} {
  const record = asRecord(document, filePath, "option elaborations");
  assertKeys(
    record,
    new Set(["kind", "id", "version", "title", "elaborations"]),
    ["kind", "id", "version", "elaborations"],
    filePath,
  );
  if (record.kind !== "option_elaborations") {
    throw new CorpusShapeError(`Expected kind option_elaborations in ${filePath}`, { filePath });
  }
  const elaborations = asArray(record.elaborations, filePath, "elaborations").map((item) =>
    readElaboration(item, filePath),
  );
  return {
    id: readId(record.id, filePath, "pack id"),
    version: readVersion(record.version, filePath),
    elaborations,
  };
}

export function readPolicyPack(document: unknown, filePath: string): {
  readonly id: string;
  readonly version: number;
  readonly policies: UniversalPolicyManifest[];
} {
  const record = asRecord(document, filePath, "universal policies");
  assertKeys(record, new Set(["kind", "id", "version", "title", "policies"]), ["kind", "id", "version", "policies"], filePath);
  if (record.kind !== "universal_policies") {
    throw new CorpusShapeError(`Expected kind universal_policies in ${filePath}`, { filePath });
  }
  return {
    id: readId(record.id, filePath, "pack id"),
    version: readVersion(record.version, filePath),
    policies: asArray(record.policies, filePath, "policies").map((item) => readPolicy(item, filePath)),
  };
}

export function readRulePack(document: unknown, filePath: string): {
  readonly id: string;
  readonly version: number;
  readonly rules: CrossCuttingRuleManifest[];
} {
  const record = asRecord(document, filePath, "cross-cutting rules");
  assertKeys(record, new Set(["kind", "id", "version", "title", "rules"]), ["kind", "id", "version", "rules"], filePath);
  if (record.kind !== "cross_cutting_rules") {
    throw new CorpusShapeError(`Expected kind cross_cutting_rules in ${filePath}`, { filePath });
  }
  return {
    id: readId(record.id, filePath, "pack id"),
    version: readVersion(record.version, filePath),
    rules: asArray(record.rules, filePath, "rules").map((item) => readRule(item, filePath)),
  };
}

export function readSeamPack(document: unknown, filePath: string): {
  readonly id: string;
  readonly version: number;
  readonly seams: SeamTemplateManifest[];
} {
  const record = asRecord(document, filePath, "seam templates");
  assertKeys(record, new Set(["kind", "id", "version", "title", "seams"]), ["kind", "id", "version", "seams"], filePath);
  if (record.kind !== "seam_templates") {
    throw new CorpusShapeError(`Expected kind seam_templates in ${filePath}`, { filePath });
  }
  return {
    id: readId(record.id, filePath, "pack id"),
    version: readVersion(record.version, filePath),
    seams: asArray(record.seams, filePath, "seams").map((item) => readSeam(item, filePath)),
  };
}

function readElaboration(value: unknown, filePath: string): OptionElaborationManifest {
  const record = asRecord(value, filePath, "elaboration");
  assertKeys(
    record,
    new Set(["id", "question", "option", "cells", "edge_cases", "bounds", "oracle_hints"]),
    ["id", "question", "option", "cells", "edge_cases", "bounds", "oracle_hints"],
    filePath,
  );
  const cells = asArray(record.cells, filePath, "cells").map((item) => readCell(item, filePath));
  return {
    id: readText(record.id, filePath, "elaboration id"),
    question: readQuestionId(record.question, filePath),
    option: readText(record.option, filePath, "option"),
    cells,
    edge_cases: readStringList(record.edge_cases, filePath, undefined, "edge_cases"),
    bounds: readStringList(record.bounds, filePath, undefined, "bounds"),
    oracle_hints: readStringList(record.oracle_hints, filePath, undefined, "oracle_hints"),
    source_file: filePath,
  };
}

function readCell(value: unknown, filePath: string): ElaborationCellManifest {
  const record = asRecord(value, filePath, "elaboration cell");
  assertKeys(record, new Set(["cell", "value"]), ["cell", "value"], filePath);
  return {
    cell: readText(record.cell, filePath, "cell"),
    value: readText(record.value, filePath, "value"),
  };
}

function readPolicy(value: unknown, filePath: string): UniversalPolicyManifest {
  const record = asRecord(value, filePath, "policy");
  assertKeys(record, new Set(["id", "cell", "value"]), ["id", "cell", "value"], filePath);
  const id = readText(record.id, filePath, "policy id");
  if (!POLICY_ID.test(id)) {
    throw new CorpusShapeError(`Policy id ${id} must look like UP-01 in ${filePath}`, { filePath });
  }
  return {
    id,
    cell: readText(record.cell, filePath, "cell"),
    value: readText(record.value, filePath, "value"),
    source_file: filePath,
  };
}

function readRule(value: unknown, filePath: string): CrossCuttingRuleManifest {
  const record = asRecord(value, filePath, "rule");
  assertKeys(record, new Set(["id", "rule", "scope", "check_kind"]), ["id", "rule", "scope", "check_kind"], filePath);
  const id = readText(record.id, filePath, "rule id");
  if (!RULE_ID.test(id)) {
    throw new CorpusShapeError(`Rule id ${id} must look like X-01 in ${filePath}`, { filePath });
  }
  return {
    id,
    rule: readText(record.rule, filePath, "rule"),
    scope: readRuleScope(record.scope, filePath, id),
    check_kind: readText(record.check_kind, filePath, "check_kind"),
    source_file: filePath,
  };
}

function readRuleScope(value: unknown, filePath: string, ruleId: string): RuleScopeManifest {
  const record = asRecord(value, filePath, "scope", ruleId);
  assertKeys(record, new Set(["any", "all"]), [], filePath, ruleId);
  const scope: { any?: string[]; all?: string[] } = {};
  if (record.any !== undefined) scope.any = readStringList(record.any, filePath, ruleId, "any");
  if (record.all !== undefined) scope.all = readStringList(record.all, filePath, ruleId, "all");
  if ((scope.any === undefined || scope.any.length === 0) && (scope.all === undefined || scope.all.length === 0)) {
    throw new CorpusShapeError(`Rule ${ruleId} has an empty scope in ${filePath}`, {
      filePath,
      questionId: ruleId,
    });
  }
  return scope;
}

function readSeam(value: unknown, filePath: string): SeamTemplateManifest {
  const record = asRecord(value, filePath, "seam");
  assertKeys(
    record,
    new Set(["id", "title", "activates_when", "contract_template", "edge_cases", "rules_activated"]),
    ["id", "title", "activates_when", "contract_template", "edge_cases", "rules_activated"],
    filePath,
  );
  return {
    id: readText(record.id, filePath, "seam id"),
    title: readText(record.title, filePath, "title"),
    activates_when: readStringList(record.activates_when, filePath, undefined, "activates_when"),
    contract_template: readText(record.contract_template, filePath, "contract_template"),
    edge_cases: readStringList(record.edge_cases, filePath, undefined, "edge_cases"),
    rules_activated: readStringList(record.rules_activated, filePath, undefined, "rules_activated"),
    source_file: filePath,
  };
}

function readOptions(value: unknown, filePath: string, questionId: string): OptionManifest[] {
  const options = asArray(value, filePath, "options", questionId).map((item) => {
    const record = asRecord(item, filePath, "option", questionId);
    assertKeys(
      record,
      new Set(["id", "label", "meaning", "stage_suitability", "consequences"]),
      ["id", "label", "meaning", "stage_suitability", "consequences"],
      filePath,
      questionId,
    );
    return {
      id: readText(record.id, filePath, "option id", questionId),
      label: readText(record.label, filePath, "label", questionId),
      meaning: readText(record.meaning, filePath, "meaning", questionId),
      stage_suitability: readStages(record.stage_suitability, filePath, questionId),
      consequences: readText(record.consequences, filePath, "consequences", questionId),
    };
  });
  const seen = new Set<string>();
  for (const option of options) {
    if (seen.has(option.id)) {
      throw new CorpusShapeError(`Duplicate option id ${option.id} on ${questionId} in ${filePath}`, {
        filePath,
        questionId,
      });
    }
    seen.add(option.id);
  }
  return options;
}

function readStageRecommendations(
  value: unknown,
  filePath: string,
  questionId: string,
): Record<ProjectStage, StageRecommendationManifest> {
  const record = asRecord(value, filePath, "stage_recommendations", questionId);
  assertKeys(record, new Set(PROJECT_STAGES), [...PROJECT_STAGES], filePath, questionId);
  const recommendations = {} as Record<ProjectStage, StageRecommendationManifest>;
  for (const stage of PROJECT_STAGES) {
    const entry = asRecord(record[stage], filePath, `stage_recommendations.${stage}`, questionId);
    assertKeys(entry, new Set(["option", "rationale"]), ["option", "rationale"], filePath, questionId);
    recommendations[stage] = {
      option: readText(entry.option, filePath, `${stage} option`, questionId),
      rationale: readText(entry.rationale, filePath, `${stage} rationale`, questionId),
    };
  }
  return recommendations;
}

function readStageApplicability(
  value: unknown,
  filePath: string,
  questionId: string,
): Record<ProjectStage, boolean> {
  const record = asRecord(value, filePath, "stage_applicability", questionId);
  assertKeys(record, new Set(PROJECT_STAGES), [...PROJECT_STAGES], filePath, questionId);
  const applicability = {} as Record<ProjectStage, boolean>;
  for (const stage of PROJECT_STAGES) {
    applicability[stage] = readBoolean(record[stage], filePath, questionId, `stage_applicability.${stage}`);
  }
  return applicability;
}

function readPositiveExamples(value: unknown, filePath: string, questionId: string): PositiveExampleManifest[] {
  return asArray(value, filePath, "positive_examples", questionId).map((item) => {
    const record = asRecord(item, filePath, "positive example", questionId);
    assertKeys(record, new Set(["utterance", "style", "settles"]), ["utterance", "settles"], filePath, questionId);
    const example: PositiveExampleManifest = {
      utterance: readText(record.utterance, filePath, "utterance", questionId),
      settles: readSettles(record.settles, filePath, questionId),
    };
    if (record.style !== undefined) {
      if (record.style !== "spoken_dictation" && record.style !== "plain") {
        throw new CorpusShapeError(`Invalid example style on ${questionId} in ${filePath}`, {
          filePath,
          questionId,
        });
      }
      return { ...example, style: record.style };
    }
    return example;
  });
}

function readNegativeExamples(value: unknown, filePath: string, questionId: string): NegativeExampleManifest[] {
  return asArray(value, filePath, "negative_examples", questionId).map((item) => {
    const record = asRecord(item, filePath, "negative example", questionId);
    assertKeys(
      record,
      new Set(["utterance", "must_not_settle", "reason"]),
      ["utterance", "must_not_settle", "reason"],
      filePath,
      questionId,
    );
    const blocked = readStringList(record.must_not_settle, filePath, questionId, "must_not_settle");
    if (blocked.length === 0) {
      throw new CorpusShapeError(`Negative example on ${questionId} has no must_not_settle entries in ${filePath}`, {
        filePath,
        questionId,
      });
    }
    return {
      utterance: readText(record.utterance, filePath, "utterance", questionId),
      must_not_settle: blocked,
      reason: readText(record.reason, filePath, "reason", questionId),
    };
  });
}

function readSettles(value: unknown, filePath: string, questionId: string): Record<string, string> {
  const record = asRecord(value, filePath, "settles", questionId);
  const settles: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (!CRITERION_ID.test(key)) {
      throw new CorpusShapeError(`Invalid criterion key ${key} on ${questionId} in ${filePath}`, {
        filePath,
        questionId,
      });
    }
    settles[key] = readText(raw, filePath, `settles.${key}`, questionId);
  }
  return settles;
}

function readEval(value: unknown, filePath: string, questionId: string): QuestionEvalManifest {
  const record = asRecord(value, filePath, "eval", questionId);
  assertKeys(
    record,
    new Set(["asked", "changed_build_decision", "user_marked_unhelpful"]),
    ["asked", "changed_build_decision", "user_marked_unhelpful"],
    filePath,
    questionId,
  );
  return {
    asked: readCount(record.asked, filePath, questionId, "asked"),
    changed_build_decision: readCount(record.changed_build_decision, filePath, questionId, "changed_build_decision"),
    user_marked_unhelpful: readCount(record.user_marked_unhelpful, filePath, questionId, "user_marked_unhelpful"),
  };
}

function readAppliesWhen(value: unknown, filePath: string, questionId: string): AppliesWhenClause[] {
  return asArray(value, filePath, "applies_when", questionId).map((item) => {
    const record = asRecord(item, filePath, "applies_when", questionId);
    assertKeys(record, new Set(["criterion", "equals"]), ["criterion"], filePath, questionId);
    const clause: AppliesWhenClause = {
      criterion: readCriterion(record.criterion, filePath, questionId),
    };
    if (record.equals !== undefined) {
      return { ...clause, equals: readText(record.equals, filePath, "equals", questionId) };
    }
    return clause;
  });
}

function readCriteria(value: unknown, filePath: string, questionId: string): string[] {
  const criteria = readCriteriaList(value, filePath, questionId, "criteria");
  if (criteria.length === 0) {
    throw new CorpusShapeError(`Question ${questionId} has no criteria in ${filePath}`, {
      filePath,
      questionId,
    });
  }
  return criteria;
}

function readCriterion(value: unknown, filePath: string, questionId: string): string {
  const criterion = readText(value, filePath, "criterion", questionId);
  if (!CRITERION_ID.test(criterion)) {
    throw new CorpusShapeError(`Invalid criterion key ${criterion} on ${questionId} in ${filePath}`, {
      filePath,
      questionId,
    });
  }
  return criterion;
}

function readCriteriaList(value: unknown, filePath: string, questionId: string, label: string): string[] {
  const items = readStringList(value, filePath, questionId, label);
  for (const item of items) {
    if (!CRITERION_ID.test(item)) {
      throw new CorpusShapeError(`Invalid criterion key ${item} on ${questionId} in ${filePath}`, {
        filePath,
        questionId,
      });
    }
  }
  return items;
}

function readStages(value: unknown, filePath: string, questionId: string): ProjectStage[] {
  const items = readStringList(value, filePath, questionId, "stage_suitability");
  if (items.length === 0) {
    throw new CorpusShapeError(`Option on ${questionId} has no stage suitability in ${filePath}`, {
      filePath,
      questionId,
    });
  }
  const stages: ProjectStage[] = [];
  for (const item of items) {
    if (!(PROJECT_STAGES as readonly string[]).includes(item)) {
      throw new CorpusShapeError(`Invalid stage ${item} on ${questionId} in ${filePath}`, {
        filePath,
        questionId,
      });
    }
    stages.push(item as ProjectStage);
  }
  return stages;
}

function readQuestionIdList(value: unknown, filePath: string, questionId: string, label: string): string[] {
  return readStringList(value, filePath, questionId, label).map((item) => {
    if (!QUESTION_ID.test(item)) {
      throw new CorpusShapeError(`Invalid question id ${item} in ${label} of ${questionId} in ${filePath}`, {
        filePath,
        questionId,
      });
    }
    return item;
  });
}

function readQuestionId(value: unknown, filePath: string, questionId?: string): string {
  const id = readText(value, filePath, "id", questionId);
  if (!QUESTION_ID.test(id)) {
    throw new CorpusShapeError(`Invalid question id ${id} in ${filePath}`, { filePath, questionId: questionId ?? id });
  }
  return id;
}

function readId(value: unknown, filePath: string, label: string): string {
  const id = readText(value, filePath, label);
  if (!PLAIN_ID.test(id)) {
    throw new CorpusShapeError(`Invalid ${label} ${id} in ${filePath}`, { filePath });
  }
  return id;
}

function readVersion(value: unknown, filePath: string, questionId?: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new CorpusShapeError(`version must be an integer >= 1 in ${filePath}`, { filePath, questionId });
  }
  return value;
}

function readCount(value: unknown, filePath: string, questionId: string, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new CorpusShapeError(`${label} must be a non-negative integer on ${questionId} in ${filePath}`, {
      filePath,
      questionId,
    });
  }
  return value;
}

function readBoolean(value: unknown, filePath: string, questionId: string | undefined, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new CorpusShapeError(`${label} must be boolean in ${filePath}`, { filePath, questionId });
  }
  return value;
}

function readEnum(
  value: unknown,
  allowed: readonly string[],
  filePath: string,
  questionId: string,
  label: string,
): string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new CorpusShapeError(
      `${label} must be one of ${allowed.join(", ")} on ${questionId} in ${filePath}`,
      { filePath, questionId },
    );
  }
  return value;
}

function readText(value: unknown, filePath: string, label: string, questionId?: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CorpusShapeError(`${label} must be a non-empty string in ${filePath}`, { filePath, questionId });
  }
  return value;
}

function readStringList(value: unknown, filePath: string, questionId: string | undefined, label: string): string[] {
  return asArray(value, filePath, label, questionId).map((item) => readText(item, filePath, label, questionId));
}

function asArray(value: unknown, filePath: string, label: string, questionId?: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new CorpusShapeError(`${label} must be an array in ${filePath}`, { filePath, questionId });
  }
  return value;
}

function asRecord(value: unknown, filePath: string, label: string, questionId?: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CorpusShapeError(`${label} must be a mapping in ${filePath}`, { filePath, questionId });
  }
  return value as Record<string, unknown>;
}

function assertKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: readonly string[],
  filePath: string,
  questionId?: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new CorpusShapeError(`Unknown key ${key} in ${filePath}`, { filePath, questionId });
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      throw new CorpusShapeError(`Missing key ${key} in ${filePath}`, { filePath, questionId });
    }
  }
}
