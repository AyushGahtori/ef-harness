import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import {
  CorpusPackError,
  type BoundRecord,
  type ClauseRecord,
  type CorpusBundle,
  type ElaborationRecord,
  type ExampleNegative,
  type ExamplePositive,
  type OptionRecord,
  type OptionRef,
  type PolicyRecord,
  type QuestionRecord,
  type StageName,
  type StageRecommendation,
  type TagScope,
  type TouchesTag,
  isTouchesTag,
  STAGES,
} from "./corpus-port.js";

export const OWNED_PACK_FILES = [
  "corpus/packs/web-api-cli/web.yaml",
  "corpus/packs/web-api-cli/api.yaml",
  "corpus/packs/web-api-cli/cli.yaml",
] as const;

export const ELABORATION_FILES = [
  "corpus/elaborations/web.yaml",
  "corpus/elaborations/api.yaml",
  "corpus/elaborations/cli.yaml",
  "corpus/elaborations/core-data-auth.yaml",
] as const;

export const POLICY_FILE = "corpus/policies/universal-policies.yaml";
export const MANIFEST_FILE = "corpus/packs/web-api-cli/manifest.yaml";
export const PORT_FILE = "packages/discovery/tests/corpus-web-api-cli/port/task-075-questions.json";
const SIBLING_PACK_DIR = "corpus/packs/core-data-auth";

export function findRepoRoot(start: string): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new CorpusPackError(`Could not find the repo root from ${start}.`);
}

export function readCorpusText(repoRoot: string, relativePath: string): string {
  const full = path.join(repoRoot, relativePath);
  if (!fs.existsSync(full)) {
    throw new CorpusPackError(`Missing corpus file ${relativePath}.`);
  }
  return fs.readFileSync(full, "utf8");
}

export function parseCorpusYaml(text: string, relativePath: string): unknown {
  try {
    return parse(text, { uniqueKeys: true, strict: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CorpusPackError(`${relativePath}: ${message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(file: string, message: string): never {
  throw new CorpusPackError(`${file}: ${message}`);
}

function stringField(raw: Record<string, unknown>, key: string, file: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.trim() === "") fail(file, `missing string ${key}`);
  return value;
}

function numberField(raw: Record<string, unknown>, key: string, file: string): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value)) fail(file, `missing number ${key}`);
  return value;
}

function stringList(raw: Record<string, unknown>, key: string, file: string): string[] {
  const value = raw[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail(file, `missing string list ${key}`);
  }
  return value as string[];
}

function tagList(values: string[], file: string, label: string): TouchesTag[] {
  for (const tag of values) {
    if (!isTouchesTag(tag)) fail(file, `${label} has unknown touches tag ${tag}`);
  }
  return values as TouchesTag[];
}

function parseScope(value: unknown, file: string, label: string): TagScope {
  if (!isRecord(value)) fail(file, `${label} touches must be a mapping`);
  const scope: TagScope = {};
  if (value.any !== undefined) scope.any = tagList(stringList(value, "any", file), file, label);
  if (value.all !== undefined) scope.all = tagList(stringList(value, "all", file), file, label);
  return scope;
}

function parseRefs(value: unknown, file: string): OptionRef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(file, "conflicts_with must be a list");
  return value.map((item) => {
    if (!isRecord(item)) fail(file, "conflicts_with entry must be a mapping");
    return {
      question_id: stringField(item, "question_id", file),
      option_id: stringField(item, "option_id", file),
    };
  });
}

function parseOption(value: unknown, file: string): OptionRecord {
  if (!isRecord(value)) fail(file, "option must be a mapping");
  const frequency = stringField(value, "frequency", file);
  if (frequency !== "high" && frequency !== "low") fail(file, `bad frequency ${frequency}`);
  const suitability = stringList(value, "stage_suitability", file);
  const stages: StageName[] = [];
  for (const stage of suitability) {
    if (stage !== "prototype" && stage !== "mvp" && stage !== "production") {
      fail(file, `bad stage suitability ${stage}`);
    }
    stages.push(stage);
  }
  const option: OptionRecord = {
    id: stringField(value, "id", file),
    label: stringField(value, "label", file),
    meaning: stringField(value, "meaning", file),
    stage_suitability: stages,
    frequency,
    conflicts_with: parseRefs(value.conflicts_with, file),
  };
  if (value.elaboration_exempt_reason !== undefined) {
    option.elaboration_exempt_reason = stringField(value, "elaboration_exempt_reason", file);
  }
  return option;
}

function parseRecommendations(value: unknown, file: string): Record<StageName, StageRecommendation> {
  if (!isRecord(value)) fail(file, "stage_recommendations must be a mapping");
  const result = {} as Record<StageName, StageRecommendation>;
  for (const stage of STAGES) {
    const entry = value[stage];
    if (!isRecord(entry)) fail(file, `missing stage recommendation ${stage}`);
    result[stage] = {
      option: stringField(entry, "option", file),
      rationale: stringField(entry, "rationale", file),
    };
  }
  return result;
}

function parseExamples(value: unknown, file: string): QuestionRecord["examples"] {
  if (!isRecord(value)) fail(file, "examples must be a mapping");
  const positiveRaw = value.positive;
  const negativeRaw = value.negative;
  if (!Array.isArray(positiveRaw) || !Array.isArray(negativeRaw)) fail(file, "examples need positive and negative lists");
  const positive: ExamplePositive[] = positiveRaw.map((item) => {
    if (!isRecord(item)) fail(file, "positive example must be a mapping");
    return { utterance: stringField(item, "utterance", file), settles: stringField(item, "settles", file) };
  });
  const negative: ExampleNegative[] = negativeRaw.map((item) => {
    if (!isRecord(item)) fail(file, "negative example must be a mapping");
    return { utterance: stringField(item, "utterance", file), why: stringField(item, "why", file) };
  });
  return { positive, negative };
}

export function parseQuestion(value: unknown, file: string): QuestionRecord {
  if (!isRecord(value)) fail(file, "question must be a mapping");
  const pack = stringField(value, "pack", file);
  if (pack !== "core" && pack !== "data" && pack !== "auth" && pack !== "web" && pack !== "api" && pack !== "cli") {
    fail(file, `bad pack ${pack}`);
  }
  const impact = stringField(value, "impact", file);
  if (impact !== "low" && impact !== "medium" && impact !== "high" && impact !== "critical") {
    fail(file, `bad impact ${impact}`);
  }
  const reversibility = stringField(value, "reversibility", file);
  if (reversibility !== "easy" && reversibility !== "costly" && reversibility !== "irreversible") {
    fail(file, `bad reversibility ${reversibility}`);
  }
  if (typeof value.must_ask !== "boolean") fail(file, "must_ask must be boolean");
  const scope = stringField(value, "scope", file);
  if (scope !== "shared") fail(file, "scope must be shared");
  const optionsRaw = value.options;
  if (!Array.isArray(optionsRaw) || optionsRaw.length === 0) fail(file, "options must be a non-empty list");
  return {
    id: stringField(value, "id", file),
    code: stringField(value, "code", file),
    pack,
    version: numberField(value, "version", file),
    scope,
    title: stringField(value, "title", file),
    explain: stringField(value, "explain", file),
    criteria: stringList(value, "criteria", file),
    touches: tagList(stringList(value, "touches", file), file, stringField(value, "id", file)),
    impact,
    reversibility,
    must_ask: value.must_ask,
    requires: stringList(value, "requires", file),
    allowed_inference_rules: stringList(value, "allowed_inference_rules", file),
    options: optionsRaw.map((option) => parseOption(option, file)),
    stage_recommendations: parseRecommendations(value.stage_recommendations, file),
    examples: parseExamples(value.examples, file),
    source_file: file,
  };
}

function parseBounds(value: unknown, file: string): BoundRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(file, "bounds must be a list");
  return value.map((item) => {
    if (!isRecord(item)) fail(file, "bound must be a mapping");
    return {
      key: stringField(item, "key", file),
      value: numberField(item, "value", file),
      unit: stringField(item, "unit", file),
    };
  });
}

function parseClauses(value: unknown, file: string): ClauseRecord[] {
  if (!Array.isArray(value) || value.length === 0) fail(file, "clauses must be a non-empty list");
  return value.map((item) => {
    if (!isRecord(item)) fail(file, "clause must be a mapping");
    return {
      id: stringField(item, "id", file),
      text: stringField(item, "text", file),
      touches: parseScope(item.touches, file, stringField(item, "id", file)),
      oracle_hint: stringField(item, "oracle_hint", file),
    };
  });
}

export function parseElaboration(value: unknown, file: string): ElaborationRecord {
  if (!isRecord(value)) fail(file, "elaboration must be a mapping");
  return {
    id: stringField(value, "id", file),
    question_id: stringField(value, "question_id", file),
    option_id: stringField(value, "option_id", file),
    summary: stringField(value, "summary", file),
    touches: parseScope(value.touches, file, stringField(value, "id", file)),
    clauses: parseClauses(value.clauses, file),
    edge_cases: stringList(value, "edge_cases", file),
    bounds: parseBounds(value.bounds, file),
    oracle_hints: stringList(value, "oracle_hints", file),
    source_file: file,
  };
}

export function parsePolicy(value: unknown, file: string): PolicyRecord {
  if (!isRecord(value)) fail(file, "policy must be a mapping");
  return {
    id: stringField(value, "id", file),
    title: stringField(value, "title", file),
    statement: stringField(value, "statement", file),
    touches: parseScope(value.touches, file, stringField(value, "id", file)),
    clauses: parseClauses(value.clauses, file),
    edge_cases: stringList(value, "edge_cases", file),
    bounds: parseBounds(value.bounds, file),
    oracle_hints: stringList(value, "oracle_hints", file),
    source_file: file,
  };
}

function listFrom(doc: unknown, key: string, file: string): unknown[] {
  if (!isRecord(doc) || !Array.isArray(doc[key])) fail(file, `missing list ${key}`);
  return doc[key] as unknown[];
}

function loadQuestionFile(repoRoot: string, relativePath: string): QuestionRecord[] {
  const doc = parseCorpusYaml(readCorpusText(repoRoot, relativePath), relativePath);
  return listFrom(doc, "questions", relativePath).map((item) => parseQuestion(item, relativePath));
}

function loadElaborationFile(repoRoot: string, relativePath: string): ElaborationRecord[] {
  const doc = parseCorpusYaml(readCorpusText(repoRoot, relativePath), relativePath);
  return listFrom(doc, "elaborations", relativePath).map((item) => parseElaboration(item, relativePath));
}

function siblingQuestionFiles(repoRoot: string): string[] {
  const dir = path.join(repoRoot, SIBLING_PACK_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .map((name) => path.posix.join(SIBLING_PACK_DIR, name))
    .sort();
}

export class CorpusPackLoader {
  constructor(private readonly repoRoot: string) {}

  load(): CorpusBundle {
    const files: string[] = [];
    const questions: QuestionRecord[] = [];
    for (const relativePath of OWNED_PACK_FILES) {
      files.push(relativePath);
      questions.push(...loadQuestionFile(this.repoRoot, relativePath));
    }

    const sibling = siblingQuestionFiles(this.repoRoot);
    let coreSource: CorpusBundle["core_source"];
    if (sibling.length > 0) {
      coreSource = "sibling-pack";
      for (const relativePath of sibling) {
        files.push(relativePath);
        questions.push(...loadQuestionFile(this.repoRoot, relativePath));
      }
    } else {
      coreSource = "task-075-port";
      files.push(PORT_FILE);
      const parsed: unknown = JSON.parse(readCorpusText(this.repoRoot, PORT_FILE));
      questions.push(...listFrom(parsed, "questions", PORT_FILE).map((item) => parseQuestion(item, PORT_FILE)));
    }

    const elaborations: ElaborationRecord[] = [];
    for (const relativePath of ELABORATION_FILES) {
      files.push(relativePath);
      elaborations.push(...loadElaborationFile(this.repoRoot, relativePath));
    }

    files.push(POLICY_FILE);
    const policyDoc = parseCorpusYaml(readCorpusText(this.repoRoot, POLICY_FILE), POLICY_FILE);
    const policies = listFrom(policyDoc, "policies", POLICY_FILE).map((item) => parsePolicy(item, POLICY_FILE));

    return { questions, elaborations, policies, core_source: coreSource, files };
  }

  bundleHash(bundle: CorpusBundle): string {
    const hash = createHash("sha256");
    const ordered = [...bundle.files].sort();
    for (const relativePath of ordered) {
      hash.update(relativePath);
      hash.update("\0");
      hash.update(readCorpusText(this.repoRoot, relativePath));
      hash.update("\0");
    }
    hash.update(bundle.core_source);
    return hash.digest("hex");
  }
}
