/**
 * Local port of Task 075 `CorpusPackLoader` and `CorpusQualityValidator`.
 * Swap imports to the discovery barrel once Task 075 exports them.
 * Task 010's closed 28 touches tags are copied here for the same reason.
 */

export const TOUCHES_TAGS = [
  "personal_data",
  "credentials",
  "money",
  "user_content",
  "authn",
  "authz",
  "session",
  "scheduling",
  "time_display",
  "file_upload",
  "file_download",
  "external_api",
  "inbound_webhook",
  "outbound_message",
  "background_job",
  "realtime",
  "destructive_write",
  "bulk_write",
  "migration",
  "search",
  "form_input",
  "route",
  "interactive_ui",
  "logging",
  "config_env",
  "caching",
  "rate_limited",
  "concurrent_edit",
] as const;

export type TouchesTag = (typeof TOUCHES_TAGS)[number];

export const STAGES = ["prototype", "mvp", "production"] as const;
export type StageName = (typeof STAGES)[number];

export const IMPACTS = ["low", "medium", "high", "critical"] as const;
export type ImpactClass = (typeof IMPACTS)[number];

export const REVERSIBILITIES = ["easy", "costly", "irreversible"] as const;
export type Reversibility = (typeof REVERSIBILITIES)[number];

export const INFERENCE_RULES = [
  "infer.from_stated_behavior",
  "infer.from_stated_technology",
  "infer.from_repo_dependency",
  "infer.from_explicit_acceptance",
] as const;

export const UI_TOUCH_TAGS = ["form_input", "route", "interactive_ui"] as const;

const FRAMEWORK_PATTERN =
  /\b(express|fastify|koa|nestjs|django|flask|rails|spring|laravel|react|vue|angular|svelte|nextjs|next\.js|jquery|prisma|sqlalchemy|hibernate|actix|gin)\b/i;

export interface TagScope {
  any?: TouchesTag[];
  all?: TouchesTag[];
}

export interface OptionRef {
  question_id: string;
  option_id: string;
}

export interface OptionRecord {
  id: string;
  label: string;
  meaning: string;
  stage_suitability: StageName[];
  frequency: "high" | "low";
  elaboration_exempt_reason?: string;
  conflicts_with: OptionRef[];
}

export interface StageRecommendation {
  option: string;
  rationale: string;
}

export interface ExamplePositive {
  utterance: string;
  settles: string;
}

export interface ExampleNegative {
  utterance: string;
  why: string;
}

export interface QuestionRecord {
  id: string;
  code: string;
  pack: "core" | "data" | "auth" | "web" | "api" | "cli";
  version: number;
  scope: "shared";
  title: string;
  explain: string;
  criteria: string[];
  touches: TouchesTag[];
  impact: ImpactClass;
  reversibility: Reversibility;
  must_ask: boolean;
  requires: string[];
  allowed_inference_rules: string[];
  options: OptionRecord[];
  stage_recommendations: Record<StageName, StageRecommendation>;
  examples: {
    positive: ExamplePositive[];
    negative: ExampleNegative[];
  };
  source_file?: string;
}

export interface BoundRecord {
  key: string;
  value: number;
  unit: string;
}

export interface ClauseRecord {
  id: string;
  text: string;
  touches: TagScope;
  oracle_hint: string;
}

export interface ElaborationRecord {
  id: string;
  question_id: string;
  option_id: string;
  summary: string;
  touches: TagScope;
  clauses: ClauseRecord[];
  edge_cases: string[];
  bounds: BoundRecord[];
  oracle_hints: string[];
  source_file?: string;
}

export interface PolicyRecord {
  id: string;
  title: string;
  statement: string;
  touches: TagScope;
  clauses: ClauseRecord[];
  edge_cases: string[];
  bounds: BoundRecord[];
  oracle_hints: string[];
  source_file?: string;
}

export interface CorpusBundle {
  questions: QuestionRecord[];
  elaborations: ElaborationRecord[];
  policies: PolicyRecord[];
  core_source: "task-075-port" | "sibling-pack";
  files: string[];
}

export interface QualityIssue {
  code: string;
  message: string;
  file?: string;
  questionId?: string;
  elaborationId?: string;
  policyId?: string;
}

export class CorpusPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorpusPackError";
  }
}

export class CorpusQualityError extends Error {
  readonly issues: readonly QualityIssue[];

  constructor(issues: readonly QualityIssue[]) {
    super(issues.map((issue) => issue.message).join("\n"));
    this.name = "CorpusQualityError";
    this.issues = issues;
  }
}

const TAG_SET = new Set<string>(TOUCHES_TAGS);
const STAGE_SET = new Set<string>(STAGES);
const IMPACT_SET = new Set<string>(IMPACTS);
const REVERSIBILITY_SET = new Set<string>(REVERSIBILITIES);
const RULE_SET = new Set<string>(INFERENCE_RULES);

export function isTouchesTag(value: string): value is TouchesTag {
  return TAG_SET.has(value);
}

export function scopeTagList(scope: TagScope | undefined): string[] {
  if (!scope) return [];
  return [...(scope.any ?? []), ...(scope.all ?? [])];
}

export function scopeMatches(scope: TagScope | undefined, tags: readonly string[]): boolean {
  if (!scope) return false;
  const any = scope.any ?? [];
  const all = scope.all ?? [];
  if (any.length === 0 && all.length === 0) return false;
  if (all.some((tag) => !tags.includes(tag))) return false;
  if (any.length > 0 && !any.some((tag) => tags.includes(tag))) return false;
  return true;
}

export function isWebUiOnlyScope(scope: TagScope | undefined): boolean {
  const tags = scopeTagList(scope);
  return tags.length > 0 && tags.every((tag) => (UI_TOUCH_TAGS as readonly string[]).includes(tag));
}

function refKey(questionId: string, optionId: string): string {
  return `${questionId}\u0000${optionId}`;
}

function sameRef(left: OptionRef, questionId: string, optionId: string): boolean {
  return left.question_id === questionId && left.option_id === optionId;
}

export interface ApplicableClause {
  kind: "policy" | "elaboration";
  policyId?: string;
  elaborationId?: string;
  clauseId: string;
  questionId?: string;
  optionId?: string;
  text: string;
}

export interface ApplicableSlice {
  policyIds: string[];
  elaborationIds: string[];
  clauses: ApplicableClause[];
}

export function applicableSlice(
  bundle: CorpusBundle,
  taskTags: readonly string[],
  chosen: readonly OptionRef[],
): ApplicableSlice {
  const chosenKeys = new Set(chosen.map((item) => refKey(item.question_id, item.option_id)));
  const policyIds: string[] = [];
  const elaborationIds: string[] = [];
  const clauses: ApplicableClause[] = [];

  for (const policy of bundle.policies) {
    if (!scopeMatches(policy.touches, taskTags)) continue;
    policyIds.push(policy.id);
    for (const clause of policy.clauses) {
      if (!scopeMatches(clause.touches, taskTags)) continue;
      clauses.push({
        kind: "policy",
        policyId: policy.id,
        clauseId: clause.id,
        text: clause.text,
      });
    }
  }

  for (const elaboration of bundle.elaborations) {
    if (!chosenKeys.has(refKey(elaboration.question_id, elaboration.option_id))) continue;
    const matched = elaboration.clauses.filter((clause) => scopeMatches(clause.touches, taskTags));
    if (matched.length === 0) continue;
    elaborationIds.push(elaboration.id);
    for (const clause of matched) {
      clauses.push({
        kind: "elaboration",
        elaborationId: elaboration.id,
        clauseId: clause.id,
        questionId: elaboration.question_id,
        optionId: elaboration.option_id,
        text: clause.text,
      });
    }
  }

  return { policyIds, elaborationIds, clauses };
}

interface BoundSite {
  origin: string;
  key: string;
  value: number;
  questionId?: string;
  optionId?: string;
  conflicts: OptionRef[];
}

function collectBounds(bundle: CorpusBundle): BoundSite[] {
  const optionConflicts = new Map<string, OptionRef[]>();
  for (const question of bundle.questions) {
    for (const option of question.options) {
      optionConflicts.set(refKey(question.id, option.id), option.conflicts_with);
    }
  }
  const sites: BoundSite[] = [];
  for (const policy of bundle.policies) {
    for (const bound of policy.bounds) {
      sites.push({ origin: policy.id, key: bound.key, value: bound.value, conflicts: [] });
    }
  }
  for (const elaboration of bundle.elaborations) {
    for (const bound of elaboration.bounds) {
      sites.push({
        origin: elaboration.id,
        key: bound.key,
        value: bound.value,
        questionId: elaboration.question_id,
        optionId: elaboration.option_id,
        conflicts: optionConflicts.get(refKey(elaboration.question_id, elaboration.option_id)) ?? [],
      });
    }
  }
  return sites;
}

function boundsCoSelectable(left: BoundSite, right: BoundSite): boolean {
  const leftPolicy = left.questionId === undefined;
  const rightPolicy = right.questionId === undefined;
  if (leftPolicy || rightPolicy) return true;
  if (left.questionId === right.questionId) return false;
  if (left.conflicts.some((item) => sameRef(item, right.questionId ?? "", right.optionId ?? ""))) {
    return false;
  }
  if (right.conflicts.some((item) => sameRef(item, left.questionId ?? "", left.optionId ?? ""))) {
    return false;
  }
  return true;
}

export function numericBoundConflicts(bundle: CorpusBundle): QualityIssue[] {
  const sites = collectBounds(bundle);
  const issues: QualityIssue[] = [];
  for (let i = 0; i < sites.length; i += 1) {
    const left = sites[i];
    if (!left) continue;
    for (let j = i + 1; j < sites.length; j += 1) {
      const right = sites[j];
      if (!right) continue;
      if (left.key !== right.key || left.value === right.value) continue;
      if (left.origin === right.origin) {
        issues.push({
          code: "numeric_bound_conflict",
          message: `${left.origin} sets ${left.key} to both ${left.value} and ${right.value}.`,
        });
        continue;
      }
      if (!boundsCoSelectable(left, right)) continue;
      issues.push({
        code: "numeric_bound_conflict",
        message: `${left.origin} sets ${left.key}=${left.value} but compatible ${right.origin} sets ${left.key}=${right.value}.`,
        elaborationId: left.questionId ? left.origin : right.origin,
      });
    }
  }
  return issues;
}

function findCycle(questions: readonly QuestionRecord[]): string[] | null {
  const requires = new Map(questions.map((question) => [question.id, question.requires]));
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    const state = color.get(id) ?? 0;
    if (state === 1) {
      const start = stack.indexOf(id);
      return stack.slice(start);
    }
    if (state === 2) return null;
    color.set(id, 1);
    stack.push(id);
    for (const next of requires.get(id) ?? []) {
      if (!requires.has(next)) continue;
      const found = visit(next);
      if (found) return found;
    }
    stack.pop();
    color.set(id, 2);
    return null;
  };

  for (const question of questions) {
    const found = visit(question.id);
    if (found) return found;
  }
  return null;
}

function scanFramework(text: string): string | null {
  const match = FRAMEWORK_PATTERN.exec(text);
  return match?.[0] ?? null;
}

function scopeIssues(
  scope: TagScope | undefined,
  label: string,
  file: string | undefined,
  extra: Partial<QualityIssue>,
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const tags = scopeTagList(scope);
  if (!scope || tags.length === 0) {
    issues.push({
      code: "empty_scope",
      message: `${label} has an empty touches scope. Bind any or all to closed tags.`,
      file,
      ...extra,
    });
    return issues;
  }
  for (const tag of tags) {
    if (!isTouchesTag(tag)) {
      issues.push({
        code: "bad_touches_tag",
        message: `${file ?? "bundle"} ${label} has touches tag "${tag}". Valid tags: ${TOUCHES_TAGS.join(", ")}.`,
        file,
        ...extra,
      });
    }
  }
  return issues;
}

function expectedPolicyIds(): string[] {
  return ["UP-01", "UP-02", "UP-03", "UP-04", "UP-05", "UP-06", "UP-07", "UP-08"];
}

export class CorpusQualityValidator {
  validate(bundle: CorpusBundle): QualityIssue[] {
    const issues: QualityIssue[] = [];
    const questions = bundle.questions;
    const byId = new Map<string, QuestionRecord>();
    const codes = new Map<string, string>();

    for (const question of questions) {
      const file = question.source_file;
      if (byId.has(question.id)) {
        issues.push({
          code: "duplicate_id",
          message: `${file ?? "bundle"} reuses question id ${question.id}.`,
          file,
          questionId: question.id,
        });
      } else {
        byId.set(question.id, question);
      }
      const priorCode = codes.get(question.code);
      if (priorCode) {
        issues.push({
          code: "duplicate_id",
          message: `${file ?? "bundle"} reuses question code ${question.code} (${priorCode} and ${question.id}).`,
          file,
          questionId: question.id,
        });
      } else {
        codes.set(question.code, question.id);
      }

      if (question.examples.positive.length < 5 || question.examples.negative.length < 2) {
        issues.push({
          code: "insufficient_examples",
          message: `${file ?? "bundle"} question ${question.id} needs >= 5 positive and >= 2 negative examples (has ${question.examples.positive.length} positive, ${question.examples.negative.length} negative).`,
          file,
          questionId: question.id,
        });
      }
      const optionIds = new Set(question.options.map((option) => option.id));
      for (const example of question.examples.positive) {
        if (!optionIds.has(example.settles)) {
          issues.push({
            code: "dangling_example",
            message: `${question.id} positive example settles unknown option ${example.settles}.`,
            file,
            questionId: question.id,
          });
        }
      }
      for (const tag of question.touches) {
        if (!isTouchesTag(tag)) {
          issues.push({
            code: "bad_touches_tag",
            message: `${file ?? "bundle"} question ${question.id} has touches tag "${tag}". Valid tags: ${TOUCHES_TAGS.join(", ")}.`,
            file,
            questionId: question.id,
          });
        }
      }
      if (question.touches.length === 0) {
        issues.push({
          code: "bad_touches_tag",
          message: `${question.id} has no touches tags.`,
          file,
          questionId: question.id,
        });
      }
      for (const stage of STAGES) {
        const recommendation = question.stage_recommendations[stage];
        if (!recommendation || recommendation.rationale.trim() === "") {
          issues.push({
            code: "missing_stage_recommendation",
            message: `${question.id} is missing a ${stage} recommendation with a plain-English rationale.`,
            file,
            questionId: question.id,
          });
          continue;
        }
        if (!optionIds.has(recommendation.option)) {
          issues.push({
            code: "missing_stage_recommendation",
            message: `${question.id} ${stage} recommendation names unknown option ${recommendation.option}.`,
            file,
            questionId: question.id,
          });
        }
      }
      if (!IMPACT_SET.has(question.impact)) {
        issues.push({
          code: "bad_impact",
          message: `${question.id} has impact ${question.impact}.`,
          file,
          questionId: question.id,
        });
      }
      if (!REVERSIBILITY_SET.has(question.reversibility)) {
        issues.push({
          code: "bad_reversibility",
          message: `${question.id} has reversibility ${question.reversibility}.`,
          file,
          questionId: question.id,
        });
      }
      if (question.must_ask && question.impact !== "high" && question.impact !== "critical") {
        issues.push({
          code: "must_ask_impact",
          message: `${question.id} sets must_ask on impact ${question.impact}. must_ask is only valid for high or critical.`,
          file,
          questionId: question.id,
        });
      }
      if ((question.reversibility === "costly" || question.reversibility === "irreversible") && !question.must_ask) {
        issues.push({
          code: "costly_must_ask",
          message: `${question.id} is ${question.reversibility} but must_ask is false.`,
          file,
          questionId: question.id,
        });
      }
      if (question.allowed_inference_rules.length === 0) {
        issues.push({
          code: "empty_inference_rules",
          message: `${question.id} has an empty allowed_inference_rules list.`,
          file,
          questionId: question.id,
        });
      }
      for (const rule of question.allowed_inference_rules) {
        if (!RULE_SET.has(rule)) {
          issues.push({
            code: "bad_inference_rule",
            message: `${question.id} allows unknown inference rule ${rule}.`,
            file,
            questionId: question.id,
          });
        }
      }
      for (const required of question.requires) {
        if (!questions.some((candidate) => candidate.id === required)) {
          issues.push({
            code: "dangling_requires",
            message: `${question.id} requires missing question ${required}.`,
            file,
            questionId: question.id,
          });
        }
      }
      for (const option of question.options) {
        if (option.label.trim() === "" || option.meaning.trim() === "") {
          issues.push({
            code: "missing_option_meaning",
            message: `${question.id} option ${option.id} needs a plain-English label and behavioral meaning.`,
            file,
            questionId: question.id,
          });
        }
        if (option.stage_suitability.length === 0 || option.stage_suitability.some((stage) => !STAGE_SET.has(stage))) {
          issues.push({
            code: "missing_option_meaning",
            message: `${question.id} option ${option.id} needs stage suitability.`,
            file,
            questionId: question.id,
          });
        }
        for (const conflict of option.conflicts_with) {
          const other = questions.find((candidate) => candidate.id === conflict.question_id);
          const otherOption = other?.options.find((candidate) => candidate.id === conflict.option_id);
          if (!other || !otherOption) {
            issues.push({
              code: "dangling_conflict",
              message: `${question.id}/${option.id} conflicts_with missing ${conflict.question_id}/${conflict.option_id}.`,
              file,
              questionId: question.id,
            });
            continue;
          }
          const mirrored = otherOption.conflicts_with.some((item) => sameRef(item, question.id, option.id));
          if (!mirrored) {
            issues.push({
              code: "asymmetric_conflict",
              message: `${question.id}/${option.id} conflicts_with ${conflict.question_id}/${conflict.option_id}, but the other side does not declare it.`,
              file,
              questionId: question.id,
            });
          }
        }
      }
    }

    const cycle = findCycle(questions);
    if (cycle) {
      issues.push({
        code: "requires_cycle",
        message: `requires graph has a cycle: ${cycle.join(" -> ")}.`,
      });
    }

    const elaborated = new Set(bundle.elaborations.map((item) => refKey(item.question_id, item.option_id)));
    for (const question of questions) {
      for (const option of question.options) {
        const linked = elaborated.has(refKey(question.id, option.id));
        const exempt = (option.elaboration_exempt_reason ?? "").trim() !== "";
        if (option.frequency === "high" && !linked && !exempt) {
          issues.push({
            code: "unreferenced_high_frequency_option",
            message: `${question.id}/${option.id} is high-frequency and has neither an elaboration nor an elaboration_exempt_reason.`,
            file: question.source_file,
            questionId: question.id,
          });
        }
      }
    }

    const elaborationIds = new Set<string>();
    const clauseIds = new Set<string>();
    for (const elaboration of bundle.elaborations) {
      if (elaborationIds.has(elaboration.id)) {
        issues.push({
          code: "duplicate_id",
          message: `Duplicate elaboration id ${elaboration.id}.`,
          file: elaboration.source_file,
          elaborationId: elaboration.id,
        });
      }
      elaborationIds.add(elaboration.id);
      const question = byId.get(elaboration.question_id);
      const option = question?.options.find((candidate) => candidate.id === elaboration.option_id);
      if (!question || !option) {
        issues.push({
          code: "dangling_elaboration",
          message: `${elaboration.source_file ?? "elaborations"} ${elaboration.id} references missing (${elaboration.question_id}, ${elaboration.option_id}).`,
          file: elaboration.source_file,
          elaborationId: elaboration.id,
        });
      }
      issues.push(
        ...scopeIssues(elaboration.touches, elaboration.id, elaboration.source_file, {
          elaborationId: elaboration.id,
        }),
      );
      if (elaboration.clauses.length === 0 || elaboration.edge_cases.length === 0 || elaboration.bounds.length === 0) {
        issues.push({
          code: "incomplete_elaboration",
          message: `${elaboration.id} needs behavioral clauses, edge cases, and default bounds.`,
          file: elaboration.source_file,
          elaborationId: elaboration.id,
        });
      }
      if (elaboration.oracle_hints.length === 0 || elaboration.oracle_hints.some((hint) => hint.trim() === "")) {
        issues.push({
          code: "missing_oracle",
          message: `${elaboration.id} needs at least one oracle hint.`,
          file: elaboration.source_file,
          elaborationId: elaboration.id,
        });
      }
      const parentTags = new Set(scopeTagList(elaboration.touches));
      for (const clause of elaboration.clauses) {
        if (clauseIds.has(clause.id)) {
          issues.push({
            code: "duplicate_id",
            message: `Duplicate clause id ${clause.id}.`,
            elaborationId: elaboration.id,
          });
        }
        clauseIds.add(clause.id);
        issues.push(
          ...scopeIssues(clause.touches, clause.id, elaboration.source_file, {
            elaborationId: elaboration.id,
          }),
        );
        for (const tag of scopeTagList(clause.touches)) {
          if (!parentTags.has(tag)) {
            issues.push({
              code: "clause_scope_escape",
              message: `${clause.id} uses tag ${tag}, which is outside ${elaboration.id}'s touches.`,
              elaborationId: elaboration.id,
            });
          }
        }
        if (clause.oracle_hint.trim() === "" || clause.text.trim() === "") {
          issues.push({
            code: "missing_oracle",
            message: `${clause.id} needs text and an oracle hint.`,
            elaborationId: elaboration.id,
          });
        }
      }
      const framework = [elaboration.summary, ...elaboration.clauses.map((clause) => clause.text), ...elaboration.edge_cases, ...elaboration.oracle_hints]
        .map((text) => scanFramework(text))
        .find((hit) => hit !== null);
      if (framework) {
        issues.push({
          code: "framework_syntax",
          message: `${elaboration.id} embeds framework-specific syntax "${framework}". Elaborations stay behavioral unless the option is an explicit stack choice.`,
          file: elaboration.source_file,
          elaborationId: elaboration.id,
        });
      }
    }

    const policyIds = bundle.policies.map((policy) => policy.id);
    const expected = expectedPolicyIds();
    if (policyIds.length !== expected.length || expected.some((id, index) => policyIds[index] !== id)) {
      issues.push({
        code: "policy_inventory",
        message: `Universal policies must be exactly ${expected.join(", ")} in order. Found ${policyIds.join(", ") || "(none)"}.`,
      });
    }
    for (const policy of bundle.policies) {
      issues.push(
        ...scopeIssues(policy.touches, policy.id, policy.source_file, { policyId: policy.id }),
      );
      if (policy.oracle_hints.length === 0 || policy.statement.trim() === "") {
        issues.push({
          code: "missing_oracle",
          message: `${policy.id} needs a statement and at least one oracle hint.`,
          file: policy.source_file,
          policyId: policy.id,
        });
      }
      const parentTags = new Set(scopeTagList(policy.touches));
      for (const clause of policy.clauses) {
        issues.push(
          ...scopeIssues(clause.touches, clause.id, policy.source_file, { policyId: policy.id }),
        );
        for (const tag of scopeTagList(clause.touches)) {
          if (!parentTags.has(tag)) {
            issues.push({
              code: "clause_scope_escape",
              message: `${clause.id} uses tag ${tag}, which is outside ${policy.id}'s touches.`,
              policyId: policy.id,
            });
          }
        }
        if (clause.oracle_hint.trim() === "") {
          issues.push({
            code: "missing_oracle",
            message: `${clause.id} needs an oracle hint.`,
            policyId: policy.id,
          });
        }
      }
      const framework = [policy.statement, ...policy.clauses.map((clause) => clause.text), ...policy.oracle_hints]
        .map((text) => scanFramework(text))
        .find((hit) => hit !== null);
      if (framework) {
        issues.push({
          code: "framework_syntax",
          message: `${policy.id} embeds framework-specific syntax "${framework}".`,
          file: policy.source_file,
          policyId: policy.id,
        });
      }
    }

    issues.push(...numericBoundConflicts(bundle));
    return issues;
  }

  validateOrThrow(bundle: CorpusBundle): void {
    const issues = this.validate(bundle);
    if (issues.length > 0) throw new CorpusQualityError(issues);
  }
}

export function inventoryIssues(bundle: CorpusBundle): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const count = (pack: QuestionRecord["pack"]) => bundle.questions.filter((question) => question.pack === pack).length;
  const expected: Array<[QuestionRecord["pack"], number]> = [
    ["core", 18],
    ["data", 6],
    ["auth", 5],
    ["web", 6],
    ["api", 5],
    ["cli", 4],
  ];
  for (const [pack, size] of expected) {
    const actual = count(pack);
    if (actual !== size) {
      issues.push({
        code: "inventory_count",
        message: `${pack} question count is ${actual}, expected ${size}.`,
      });
    }
  }
  if (bundle.questions.length !== 44) {
    issues.push({
      code: "inventory_count",
      message: `Combined M2 question count is ${bundle.questions.length}, expected 44.`,
    });
  }
  if (bundle.elaborations.length < 60) {
    issues.push({
      code: "inventory_count",
      message: `Option elaborations are ${bundle.elaborations.length}, expected at least 60.`,
    });
  }
  return issues;
}

export function stageDefaultConflicts(bundle: CorpusBundle, stage: StageName): OptionRef[] {
  const chosen: Array<{ questionId: string; optionId: string; conflicts: OptionRef[] }> = [];
  for (const question of bundle.questions) {
    const optionId = question.stage_recommendations[stage].option;
    const option = question.options.find((candidate) => candidate.id === optionId);
    if (!option) continue;
    chosen.push({ questionId: question.id, optionId, conflicts: option.conflicts_with });
  }
  const hits: OptionRef[] = [];
  for (const item of chosen) {
    for (const conflict of item.conflicts) {
      if (chosen.some((other) => other.questionId === conflict.question_id && other.optionId === conflict.option_id)) {
        hits.push({ question_id: item.questionId, option_id: item.optionId });
      }
    }
  }
  return hits;
}
