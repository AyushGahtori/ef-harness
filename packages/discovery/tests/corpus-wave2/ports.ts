/**
 * Local ports for sibling contracts that are not on this base.
 * Swap these for the barrel exports named in the task-104 handoff.
 */

import { createHash } from "node:crypto";

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

export const INFERENCE_RULES = [
  "infer.from_stated_behavior",
  "infer.from_stated_technology",
  "infer.from_repo_dependency",
  "infer.from_explicit_acceptance",
] as const;

export const TOKENIZER_ID = "cl100k-o200k-upper-bound-v1" as const;
export const SKILL_TOKEN_CAP = 2000;
export const TASK_SKILL_COUNT_CAP = 2;
export const TASK_SKILL_TOKEN_CAP = 3500;
export const STAGE_CATALOG_SOURCE = "local-port:task-075-076-077-103" as const;
export const M2_SKILL_SOURCE = "local-port:task-078" as const;

const TAG_SET = new Set<string>(TOUCHES_TAGS);
const STAGE_SET = new Set<string>(STAGES);
const RULE_SET = new Set<string>(INFERENCE_RULES);
const IMPACTS = new Set(["low", "medium", "high", "critical"]);
const REVERSIBILITIES = new Set(["easy", "costly", "irreversible"]);

const CL100K_PATTERN =
  /'(?:[sSdDtT]|[lL][lL]|[vV][eE]|[rR][eE])|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;
const O200K_PATTERN =
  /[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?:'[sSdDtT]|'[lL][lL]|'[vV][eE]|'[rR][eE]|'[mM]|'[lL])?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?:'[sSdDtT]|'[lL][lL]|'[vV][eE]|'[rR][eE]|'[mM]|'[lL])?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n/]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;

function pretokenCost(piece: string): number {
  if (piece.length === 0) return 0;
  let nonAscii = false;
  for (const char of piece) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && codePoint > 0x7f) {
      nonAscii = true;
      break;
    }
  }
  const bytes = Buffer.byteLength(piece, "utf8");
  if (nonAscii) return bytes;
  return Math.max(1, Math.ceil(bytes / 4));
}

function estimate(pattern: RegExp, text: string): number {
  const expression = new RegExp(pattern.source, pattern.flags);
  const parts: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(expression)) {
    const index = match.index;
    const piece = match[0];
    if (index === undefined || piece.length === 0) break;
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(piece);
    cursor = index + piece.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  let total = 0;
  for (const piece of parts) total += pretokenCost(piece);
  return total;
}

export function countSkillTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(estimate(CL100K_PATTERN, text), estimate(O200K_PATTERN, text));
}

export function asciiRunOfTokenCount(target: number): string {
  const exact = target * 4;
  const candidate = "a".repeat(exact);
  if (countSkillTokens(candidate) === target) return candidate;
  for (let length = Math.max(1, exact - 8); length <= exact + 8; length += 1) {
    const text = "a".repeat(length);
    if (countSkillTokens(text) === target) return text;
  }
  throw new Error(`cannot materialize an ASCII run of ${target} tokens`);
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
  conflicts_with: OptionRef[];
}

export interface QuestionRecord {
  id: string;
  code: string;
  pack: string;
  title: string;
  explain: string;
  criteria: string[];
  touches: string[];
  impact: string;
  reversibility: string;
  must_ask: boolean;
  requires: string[];
  allowed_inference_rules: string[];
  options: OptionRecord[];
  stage_recommendations: Record<StageName, { option: string; rationale: string }>;
  examples: {
    positive: { utterance: string; settles: string }[];
    negative: { utterance: string; why: string }[];
  };
  source_file: string;
}

export interface ElaborationRecord {
  id: string;
  question_id: string;
  option_id: string;
  summary: string;
  touches: { any?: string[]; all?: string[] };
  clauses: { id: string; text: string; oracle_hint: string; touches: { any?: string[]; all?: string[] } }[];
  edge_cases: string[];
  bounds: { key: string; value: number; unit: string }[];
  oracle_hints: string[];
  source_file: string;
}

export interface SettledRef {
  question_id: string;
  option_id: string;
}

export interface ActivationRecord {
  pack_id: string;
  explicit_targets: string[];
  settled_any: SettledRef[];
  settled_all: SettledRef[];
  dormant_platforms: string[];
  non_trigger_utterances: string[];
  skill_ids: string[];
  not_applicable_question_ids: string[];
  not_applicable_criteria: string[];
  source_file: string;
}

export interface Wave2Bundle {
  questions: QuestionRecord[];
  elaborations: ElaborationRecord[];
  activations: ActivationRecord[];
  files: string[];
}

export interface QualityIssue {
  code: string;
  message: string;
  file?: string;
  questionId?: string;
}

export class CorpusQualityError extends Error {
  readonly issues: readonly QualityIssue[];

  constructor(issues: readonly QualityIssue[]) {
    super(issues.map((issue) => issue.message).join("\n"));
    this.name = "CorpusQualityError";
    this.issues = issues;
  }
}

function refKey(questionId: string, optionId: string): string {
  return `${questionId}\0${optionId}`;
}

function findCycle(questions: readonly QuestionRecord[]): string[] | null {
  const requires = new Map(questions.map((question) => [question.id, question.requires]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    const mark = state.get(id);
    if (mark === "done") return null;
    if (mark === "visiting") {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const next of requires.get(id) ?? []) {
      if (!requires.has(next)) continue;
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };

  for (const id of requires.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

export class CorpusQualityValidator {
  validate(bundle: Wave2Bundle): QualityIssue[] {
    const issues: QualityIssue[] = [];
    const byId = new Map<string, QuestionRecord>();
    const codes = new Map<string, string>();

    for (const question of bundle.questions) {
      const file = question.source_file;
      if (byId.has(question.id)) {
        issues.push({
          code: "duplicate_id",
          message: `${file} reuses question id ${question.id}.`,
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
          message: `${file} reuses question code ${question.code} (${priorCode} and ${question.id}).`,
          file,
          questionId: question.id,
        });
      } else {
        codes.set(question.code, question.id);
      }
      if (question.examples.positive.length < 5 || question.examples.negative.length < 2) {
        issues.push({
          code: "insufficient_examples",
          message: `${file} question ${question.id} needs >= 5 positive and >= 2 negative examples (has ${question.examples.positive.length} positive, ${question.examples.negative.length} negative).`,
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
      if (question.touches.length === 0) {
        issues.push({
          code: "bad_touches_tag",
          message: `${question.id} has no touches tags.`,
          file,
          questionId: question.id,
        });
      }
      for (const tag of question.touches) {
        if (!TAG_SET.has(tag)) {
          issues.push({
            code: "bad_touches_tag",
            message: `${file} question ${question.id} has touches tag "${tag}". Valid tags: ${TOUCHES_TAGS.join(", ")}.`,
            file,
            questionId: question.id,
          });
        }
      }
      for (const stage of STAGES) {
        const recommendation = question.stage_recommendations[stage];
        if (!recommendation || recommendation.rationale.trim() === "" || !optionIds.has(recommendation.option)) {
          issues.push({
            code: "missing_stage_recommendation",
            message: `${question.id} is missing a ${stage} recommendation with a plain-English rationale.`,
            file,
            questionId: question.id,
          });
        }
      }
      if (!IMPACTS.has(question.impact)) {
        issues.push({
          code: "bad_impact",
          message: `${question.id} has impact ${question.impact}.`,
          file,
          questionId: question.id,
        });
      }
      if (!REVERSIBILITIES.has(question.reversibility)) {
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
        if (!bundle.questions.some((candidate) => candidate.id === required)) {
          issues.push({
            code: "dangling_requires",
            message: `${question.id} requires missing question ${required}.`,
            file,
            questionId: question.id,
          });
        }
      }
      for (const option of question.options) {
        if (option.stage_suitability.length === 0 || option.stage_suitability.some((stage) => !STAGE_SET.has(stage))) {
          issues.push({
            code: "missing_option_meaning",
            message: `${question.id} option ${option.id} needs stage suitability.`,
            file,
            questionId: question.id,
          });
        }
        for (const conflict of option.conflicts_with) {
          const other = bundle.questions.find((candidate) => candidate.id === conflict.question_id);
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
          const mirrored = otherOption.conflicts_with.some(
            (item) => item.question_id === question.id && item.option_id === option.id,
          );
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

    const cycle = findCycle(bundle.questions);
    if (cycle) {
      issues.push({
        code: "requires_cycle",
        message: `requires graph has a cycle: ${cycle.join(" -> ")}.`,
      });
    }

    const elaborated = new Set(bundle.elaborations.map((item) => refKey(item.question_id, item.option_id)));
    for (const question of bundle.questions) {
      for (const option of question.options) {
        if (option.frequency === "high" && !elaborated.has(refKey(question.id, option.id))) {
          issues.push({
            code: "unreferenced_high_frequency_option",
            message: `${question.id}/${option.id} is high-frequency and has no elaboration.`,
            file: question.source_file,
            questionId: question.id,
          });
        }
      }
    }

    const elaborationIds = new Set<string>();
    for (const elaboration of bundle.elaborations) {
      if (elaborationIds.has(elaboration.id)) {
        issues.push({
          code: "duplicate_id",
          message: `Duplicate elaboration id ${elaboration.id}.`,
          file: elaboration.source_file,
        });
      }
      elaborationIds.add(elaboration.id);
      const question = byId.get(elaboration.question_id);
      const option = question?.options.find((candidate) => candidate.id === elaboration.option_id);
      if (!question || !option) {
        issues.push({
          code: "dangling_elaboration",
          message: `${elaboration.id} references missing (${elaboration.question_id}, ${elaboration.option_id}).`,
          file: elaboration.source_file,
        });
      }
      const tags = [...(elaboration.touches.any ?? []), ...(elaboration.touches.all ?? [])];
      if (tags.length === 0 || tags.some((tag) => !TAG_SET.has(tag))) {
        issues.push({
          code: "bad_touches_tag",
          message: `${elaboration.id} has a touches tag outside the closed 28.`,
          file: elaboration.source_file,
        });
      }
      if (elaboration.clauses.length === 0 || elaboration.oracle_hints.length === 0 || elaboration.edge_cases.length === 0) {
        issues.push({
          code: "thin_elaboration",
          message: `${elaboration.id} needs clauses, an edge case, and an oracle hint.`,
          file: elaboration.source_file,
        });
      }
      if (elaboration.bounds.length === 0 || elaboration.bounds.some((bound) => !Number.isFinite(bound.value))) {
        issues.push({
          code: "missing_bound",
          message: `${elaboration.id} needs a numeric bound.`,
          file: elaboration.source_file,
        });
      }
    }
    return issues;
  }
}

export const STAGE_PRESETS = ["Prototype", "MVP", "Production"] as const;
export type StagePreset = (typeof STAGE_PRESETS)[number];

export interface StageOptionRef {
  questionId: string;
  optionId: string;
}

export interface StageElaboration {
  cell: string;
  value: string;
  numeric?: number;
}

export interface StageOption {
  id: string;
  label: string;
  conflictsWith: StageOptionRef[];
  requires: StageOptionRef[];
  elaborations: StageElaboration[];
}

export interface StageQuestion {
  id: string;
  pack: string;
  options: StageOption[];
  recommend: Record<StageName, string>;
}

export interface StageCatalog {
  source: typeof STAGE_CATALOG_SOURCE;
  questions: StageQuestion[];
}

export interface PresetCoherence {
  preset: StagePreset;
  conflicts: { left: string; right: string }[];
  unsatisfiedRequires: {
    questionId: string;
    optionId: string;
    missingQuestionId: string;
    missingOptionId: string;
  }[];
  numericConflicts: { cell: string; values: { questionId: string; optionId: string; numeric: number }[] }[];
}

export interface StageCoherenceReport {
  ok: boolean;
  source: string;
  questionCount: number;
  presets: PresetCoherence[];
}

function presetKey(preset: StagePreset): StageName {
  if (preset === "Prototype") return "prototype";
  if (preset === "MVP") return "mvp";
  return "production";
}

export class StageCoherenceSelfTest {
  constructor(private readonly catalog: StageCatalog) {}

  run(): StageCoherenceReport {
    const presets = STAGE_PRESETS.map((preset) => this.runPreset(preset));
    return {
      ok: presets.every(
        (preset) =>
          preset.conflicts.length === 0 &&
          preset.unsatisfiedRequires.length === 0 &&
          preset.numericConflicts.length === 0,
      ),
      source: this.catalog.source,
      questionCount: this.catalog.questions.length,
      presets,
    };
  }

  private runPreset(preset: StagePreset): PresetCoherence {
    const key = presetKey(preset);
    const selected = new Map<string, StageOption>();
    for (const question of this.catalog.questions) {
      const optionId = question.recommend[key];
      const option = question.options.find((item) => item.id === optionId);
      if (!option) throw new Error(`${question.id} has no option ${optionId} for ${preset}`);
      selected.set(question.id, option);
    }
    const conflicts: PresetCoherence["conflicts"] = [];
    const ids = [...selected.keys()];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const leftId = ids[i];
        const rightId = ids[j];
        if (!leftId || !rightId) continue;
        const left = selected.get(leftId);
        const right = selected.get(rightId);
        if (!left || !right) continue;
        const leftHits = left.conflictsWith.some((item) => item.questionId === rightId && item.optionId === right.id);
        const rightHits = right.conflictsWith.some((item) => item.questionId === leftId && item.optionId === left.id);
        if (leftHits || rightHits) {
          conflicts.push({ left: `${leftId}=${left.id}`, right: `${rightId}=${right.id}` });
        }
      }
    }
    const unsatisfiedRequires: PresetCoherence["unsatisfiedRequires"] = [];
    for (const [questionId, option] of selected) {
      for (const requirement of option.requires) {
        const chosen = selected.get(requirement.questionId);
        if (!chosen || chosen.id !== requirement.optionId) {
          unsatisfiedRequires.push({
            questionId,
            optionId: option.id,
            missingQuestionId: requirement.questionId,
            missingOptionId: requirement.optionId,
          });
        }
      }
    }
    const groups = new Map<string, { questionId: string; optionId: string; numeric: number }[]>();
    for (const [questionId, option] of selected) {
      for (const elaboration of option.elaborations) {
        if (elaboration.numeric === undefined) continue;
        const group = groups.get(elaboration.cell) ?? [];
        group.push({ questionId, optionId: option.id, numeric: elaboration.numeric });
        groups.set(elaboration.cell, group);
      }
    }
    const numericConflicts: PresetCoherence["numericConflicts"] = [];
    for (const [cell, values] of groups) {
      const distinct = new Set(values.map((value) => value.numeric));
      if (distinct.size > 1) numericConflicts.push({ cell, values });
    }
    return { preset, conflicts, unsatisfiedRequires, numericConflicts };
  }
}

export function assertStageCatalogShape(catalog: StageCatalog): string[] {
  const issues: string[] = [];
  const ids = catalog.questions.map((question) => question.id);
  if (new Set(ids).size !== ids.length) issues.push("duplicate question ids");
  const byId = new Map(catalog.questions.map((question) => [question.id, question]));
  for (const question of catalog.questions) {
    for (const key of STAGES) {
      if (!question.options.some((option) => option.id === question.recommend[key])) {
        issues.push(`${question.id} recommend.${key} is not an option`);
      }
    }
    for (const option of question.options) {
      for (const ref of [...option.conflictsWith, ...option.requires]) {
        const target = byId.get(ref.questionId);
        if (!target || !target.options.some((item) => item.id === ref.optionId)) {
          issues.push(`${question.id}:${option.id} references missing ${ref.questionId}:${ref.optionId}`);
        }
      }
    }
  }
  return issues;
}

export function toStageQuestion(question: QuestionRecord, elaborations: readonly ElaborationRecord[]): StageQuestion {
  return {
    id: question.id,
    pack: question.pack,
    recommend: {
      prototype: question.stage_recommendations.prototype.option,
      mvp: question.stage_recommendations.mvp.option,
      production: question.stage_recommendations.production.option,
    },
    options: question.options.map((option) => ({
      id: option.id,
      label: option.label,
      conflictsWith: option.conflicts_with.map((item) => ({
        questionId: item.question_id,
        optionId: item.option_id,
      })),
      requires: [],
      elaborations: elaborations
        .filter((item) => item.question_id === question.id && item.option_id === option.id)
        .flatMap((item) =>
          item.bounds.map((bound) => ({
            cell: bound.key,
            value: String(bound.value),
            numeric: bound.value,
          })),
        ),
    })),
  };
}

export interface ProjectInput {
  platforms: string[];
  explicitTargets: string[];
  settled: Record<string, string>;
  utterances: string[];
}

export interface UtteranceReading {
  surface: "mobile_web" | "unspecified";
  activatesNativeMobile: boolean;
  settled: Record<string, string>;
}

export interface LoadedSkill {
  skillId: string;
  version: string;
  tokenCount: number;
  allowedRoles: string[];
  allowedTouches: string[];
  vettingStatus: string;
  text: string;
  files: { relativePath: string; bytes: Uint8Array }[];
}

export interface SkillSelection {
  selected: LoadedSkill[];
  totalTokens: number;
  rankedCount: number;
}

export interface ActivationDecision {
  activePacks: string[];
  questions: QuestionRecord[];
  notApplicableQuestionIds: string[];
  notApplicableCriteria: string[];
  reading: UtteranceReading;
  skills: SkillSelection;
}

const PHONE_LINK = /open a link on their phones|on their phones/i;
const NATIVE_REQUEST = /native app|app store|react native|expo|ios app|android app|in-app purchase/i;

export function settleUtterance(text: string): UtteranceReading {
  if (PHONE_LINK.test(text) && !NATIVE_REQUEST.test(text)) {
    return {
      surface: "mobile_web",
      activatesNativeMobile: false,
      settled: {
        "delivery.platform": "web_browser",
        "ui.responsive_targets": "mobile_first",
      },
    };
  }
  return { surface: "unspecified", activatesNativeMobile: false, settled: {} };
}

function packIsActive(activation: ActivationRecord, project: ProjectInput): boolean {
  if (activation.explicit_targets.some((target) => project.explicitTargets.includes(target))) return true;
  if (
    activation.settled_all.length > 0 &&
    activation.settled_all.every((item) => project.settled[item.question_id] === item.option_id)
  ) {
    return true;
  }
  return activation.settled_any.some((item) => project.settled[item.question_id] === item.option_id);
}

export class SkillTokenBudgetEnforcer {
  count(text: string): number {
    return countSkillTokens(text);
  }

  assertWithinCap(text: string, label: string): number {
    const tokenCount = countSkillTokens(text);
    if (tokenCount > SKILL_TOKEN_CAP) {
      throw new Error(`skill ${label} is ${tokenCount} tokens (${tokenCount} > ${SKILL_TOKEN_CAP})`);
    }
    return tokenCount;
  }

  selectForTask(input: {
    role: string;
    touches: readonly string[];
    skills: readonly LoadedSkill[];
    boostedSkillIds?: readonly string[];
  }): SkillSelection {
    const boosted = new Set(input.boostedSkillIds ?? []);
    const ranked = input.skills
      .map((skill) => {
        const overlap = skill.allowedTouches.filter((tag) => input.touches.includes(tag)).length;
        const packBoost = boosted.has(`${skill.skillId}@${skill.version}`) || boosted.has(skill.skillId) ? 1 : 0;
        const eligible = overlap > 0 || packBoost === 1;
        return {
          skill,
          eligible,
          packBoost,
          roleExact: skill.allowedRoles.includes(input.role) ? 1 : 0,
          specificity: skill.allowedTouches.length === 0 ? 0 : overlap / skill.allowedTouches.length,
          overlap,
        };
      })
      .filter((row) => row.eligible && row.skill.vettingStatus === "vetted" && row.skill.tokenCount <= SKILL_TOKEN_CAP);
    ranked.sort((left, right) => {
      if (right.packBoost !== left.packBoost) return right.packBoost - left.packBoost;
      if (right.roleExact !== left.roleExact) return right.roleExact - left.roleExact;
      if (right.specificity !== left.specificity) return right.specificity - left.specificity;
      if (right.overlap !== left.overlap) return right.overlap - left.overlap;
      if (left.skill.tokenCount !== right.skill.tokenCount) return left.skill.tokenCount - right.skill.tokenCount;
      return left.skill.skillId.localeCompare(right.skill.skillId);
    });
    const selected: LoadedSkill[] = [];
    let totalTokens = 0;
    for (const row of ranked) {
      if (selected.length >= TASK_SKILL_COUNT_CAP) break;
      if (totalTokens + row.skill.tokenCount > TASK_SKILL_TOKEN_CAP) continue;
      selected.push(row.skill);
      totalTokens += row.skill.tokenCount;
    }
    return { selected, totalTokens, rankedCount: ranked.length };
  }
}

export class PlatformActivationGate {
  constructor(
    private readonly bundle: Wave2Bundle,
    private readonly skills: readonly LoadedSkill[],
    private readonly budget = new SkillTokenBudgetEnforcer(),
  ) {}

  evaluate(project: ProjectInput, task: { role: string; touches: readonly string[] } = { role: "worker", touches: [] }): ActivationDecision {
    const reading = project.utterances.map(settleUtterance).find((item) => item.surface === "mobile_web") ?? settleUtterance("");
    const settled = { ...reading.settled, ...project.settled };
    const view: ProjectInput = { ...project, settled };
    const active = this.bundle.activations.filter((activation) => packIsActive(activation, view));
    const activePacks = active.map((activation) => activation.pack_id);
    const questions = this.bundle.questions.filter((question) => activePacks.includes(question.pack));
    const boosted = active.flatMap((activation) => activation.skill_ids);
    return {
      activePacks,
      questions,
      notApplicableQuestionIds: [...new Set(active.flatMap((activation) => activation.not_applicable_question_ids))],
      notApplicableCriteria: [...new Set(active.flatMap((activation) => activation.not_applicable_criteria))],
      reading,
      skills: this.budget.selectForTask({
        role: task.role,
        touches: task.touches,
        skills: this.skills,
        boostedSkillIds: boosted,
      }),
    };
  }
}

export interface SecurityFinding {
  code: string;
  path: string;
  detail: string;
}

export class SkillSecurityRejection extends Error {
  readonly findings: readonly SecurityFinding[];

  constructor(findings: readonly SecurityFinding[]) {
    super(findings.map((finding) => `${finding.path}: ${finding.detail}`).join("\n"));
    this.name = "SkillSecurityRejection";
    this.findings = findings;
  }
}

function findStealthCodePoint(text: string): number | null {
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint >= 0x200b && codePoint <= 0x200f) return codePoint;
    if (codePoint >= 0x202a && codePoint <= 0x202e) return codePoint;
    if (codePoint >= 0xe0000 && codePoint <= 0xe007f) return codePoint;
    if (codePoint === 0xfeff || codePoint === 0x2060) return codePoint;
    if (codePoint >= 0x2066 && codePoint <= 0x2069) return codePoint;
  }
  return null;
}

const HOME_MUTATION = /~\/\.config\b|%USERPROFILE%|\$HOME\b|%APPDATA%/i;

export class StaticSkillSecurityVetter {
  scan(files: readonly { relativePath: string; text: string }[]): SecurityFinding[] {
    const findings: SecurityFinding[] = [];
    for (const file of files) {
      const stealth = findStealthCodePoint(file.text);
      if (stealth !== null) {
        findings.push({
          code: "hidden_unicode",
          path: file.relativePath,
          detail: `hidden unicode U+${stealth.toString(16).toUpperCase()}`,
        });
      }
      if (HOME_MUTATION.test(file.text) || /~\/\.(?:ssh|aws|claude|codex|gemini)\b/i.test(file.text)) {
        findings.push({
          code: "home_dir_mutation",
          path: file.relativePath,
          detail: "instruction writes or references a home or global config path",
        });
      }
      if (/<!--[\s\S]*?-->/.test(file.text)) {
        findings.push({ code: "html_comment", path: file.relativePath, detail: "HTML comment" });
      }
      if (/curl\s*\|\s*(?:sh|bash)\b/i.test(file.text) || /\biex\b/.test(file.text) || /ignore\s+previous\s+instructions/i.test(file.text)) {
        findings.push({ code: "exfiltration", path: file.relativePath, detail: "rejected instruction" });
      }
      if (/--no-verify/i.test(file.text) || /\bskipTests\b/.test(file.text)) {
        findings.push({ code: "verification_weaken", path: file.relativePath, detail: "weakens verification" });
      }
    }
    return findings;
  }

  assertClean(files: readonly { relativePath: string; text: string }[]): void {
    const findings = this.scan(files);
    if (findings.length > 0) throw new SkillSecurityRejection(findings);
  }
}

export interface QuarantineReceipt {
  skillId: string;
  toStatus: "vetted" | "rejected";
  canaryAccesses: number;
  hiddenUnicode: number;
  globalConfigWrites: number;
  unauthorizedNetworkCalls: number;
  smokePassed: boolean;
  tokenCount: number;
}

const SMOKE_PHRASES: Readonly<Record<string, readonly string[]>> = {
  "infer-or-ask": ["explicit", "derived", "delegated", "missing"],
  "systematic-debugging": ["root cause", "reproduce", "hypothesis"],
  "test-driven-verification": ["failing test", "red", "edge case"],
  "frontend-accessibility-ui": ["semantic", "keyboard", "contrast", "design token"],
  "sql-migrations-safety": ["expand", "contract", "idempotent", "index"],
  "api-security-hardening": ["authorization", "validation", "structured error", "idempotency"],
};

function smokePassed(skillId: string, text: string): boolean {
  const phrases = SMOKE_PHRASES[skillId];
  if (!phrases) return /^##\s+Smoke check\b/m.test(text);
  const haystack = text.toLowerCase();
  return phrases.every((phrase) => haystack.includes(phrase.toLowerCase()));
}

export class CanarySkillQuarantineHarness {
  constructor(
    private readonly vetter = new StaticSkillSecurityVetter(),
    private readonly budget = new SkillTokenBudgetEnforcer(),
  ) {}

  evaluate(skill: LoadedSkill): QuarantineReceipt {
    const files = skill.files.map((file) => ({
      relativePath: file.relativePath,
      text: new TextDecoder("utf-8", { fatal: true }).decode(file.bytes),
    }));
    const findings = this.vetter.scan(files);
    const hiddenUnicode = findings.filter((finding) => finding.code === "hidden_unicode").length;
    const globalConfigWrites = findings.filter((finding) => finding.code === "home_dir_mutation").length;
    const tokenCount = this.budget.count(skill.text);
    const overCap = tokenCount > SKILL_TOKEN_CAP;
    const leaked = skill.text.includes("CANARY_STRIPE_KEY") || /print\s+process\.env/i.test(skill.text);
    const clean = findings.length === 0 && !overCap && !leaked && smokePassed(skill.skillId, skill.text);
    return {
      skillId: skill.skillId,
      toStatus: clean ? "vetted" : "rejected",
      canaryAccesses: leaked ? 1 : 0,
      hiddenUnicode,
      globalConfigWrites,
      unauthorizedNetworkCalls: 0,
      smokePassed: smokePassed(skill.skillId, skill.text),
      tokenCount,
    };
  }
}

export function hashSkillPayload(files: readonly { relativePath: string; bytes: Uint8Array }[]): string {
  const hashed = files
    .filter((file) => file.relativePath !== "quarantine-report.json")
    .slice()
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const hash = createHash("sha256");
  for (const file of hashed) {
    hash.update(file.relativePath, "utf8");
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function gitBlobSha1(bytes: Uint8Array): string {
  const header = Buffer.from(`blob ${bytes.byteLength}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}
