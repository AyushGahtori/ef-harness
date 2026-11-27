import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ActivationRecord,
  ElaborationRecord,
  LoadedSkill,
  OptionRecord,
  QuestionRecord,
  StageName,
  Wave2Bundle,
} from "./ports.js";

export class CorpusPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorpusPackError";
  }
}

interface YamlParse {
  parse: (text: string, options: { uniqueKeys: boolean; strict: boolean }) => unknown;
}

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

function parseYaml(repoRoot: string, relativePath: string): unknown {
  const full = path.join(repoRoot, relativePath);
  const require = createRequire(path.join(repoRoot, "package.json"));
  const yaml = require("yaml") as YamlParse;
  try {
    return yaml.parse(fs.readFileSync(full, "utf8"), { uniqueKeys: true, strict: true });
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

function booleanField(raw: Record<string, unknown>, key: string, file: string): boolean {
  const value = raw[key];
  if (typeof value !== "boolean") fail(file, `missing boolean ${key}`);
  return value;
}

function stringList(raw: Record<string, unknown>, key: string, file: string): string[] {
  const value = raw[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail(file, `missing string list ${key}`);
  }
  return value as string[];
}

function recordList(raw: Record<string, unknown>, key: string, file: string): Record<string, unknown>[] {
  const value = raw[key];
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) fail(file, `missing list ${key}`);
  return value as Record<string, unknown>[];
}

function scope(value: unknown, file: string): { any?: string[]; all?: string[] } {
  if (!isRecord(value)) fail(file, "touches must be a mapping");
  const parsed: { any?: string[]; all?: string[] } = {};
  if (value.any !== undefined) parsed.any = stringList(value, "any", file);
  if (value.all !== undefined) parsed.all = stringList(value, "all", file);
  return parsed;
}

function parseQuestion(raw: Record<string, unknown>, file: string, pack: string): QuestionRecord {
  const options = recordList(raw, "options", file).map((option): OptionRecord => {
    const conflicts = option.conflicts_with === undefined ? [] : recordList(option, "conflicts_with", file);
    const suitability = stringList(option, "stage_suitability", file);
    return {
      id: stringField(option, "id", file),
      label: stringField(option, "label", file),
      meaning: stringField(option, "meaning", file),
      stage_suitability: suitability as StageName[],
      frequency: stringField(option, "frequency", file) === "low" ? "low" : "high",
      conflicts_with: conflicts.map((item) => ({
        question_id: stringField(item, "question_id", file),
        option_id: stringField(item, "option_id", file),
      })),
    };
  });
  const recommendations = raw.stage_recommendations;
  if (!isRecord(recommendations)) fail(file, "missing stage_recommendations");
  const stage = (name: StageName) => {
    const entry = recommendations[name];
    if (!isRecord(entry)) fail(file, `missing ${name} recommendation`);
    return { option: stringField(entry, "option", file), rationale: stringField(entry, "rationale", file) };
  };
  const examples = raw.examples;
  if (!isRecord(examples)) fail(file, "missing examples");
  return {
    id: stringField(raw, "id", file),
    code: stringField(raw, "code", file),
    pack,
    title: stringField(raw, "title", file),
    explain: stringField(raw, "explain", file),
    criteria: stringList(raw, "criteria", file),
    touches: stringList(raw, "touches", file),
    impact: stringField(raw, "impact", file),
    reversibility: stringField(raw, "reversibility", file),
    must_ask: booleanField(raw, "must_ask", file),
    requires: stringList(raw, "requires", file),
    allowed_inference_rules: stringList(raw, "allowed_inference_rules", file),
    options,
    stage_recommendations: {
      prototype: stage("prototype"),
      mvp: stage("mvp"),
      production: stage("production"),
    },
    examples: {
      positive: recordList(examples, "positive", file).map((item) => ({
        utterance: stringField(item, "utterance", file),
        settles: stringField(item, "settles", file),
      })),
      negative: recordList(examples, "negative", file).map((item) => ({
        utterance: stringField(item, "utterance", file),
        why: stringField(item, "why", file),
      })),
    },
    source_file: file,
  };
}

function parseActivation(raw: Record<string, unknown>, file: string): ActivationRecord {
  const refs = (key: string): ActivationRecord["settled_any"] =>
    recordList(raw, key, file).map((item) => ({
      question_id: stringField(item, "question_id", file),
      option_id: stringField(item, "option_id", file),
    }));
  return {
    pack_id: stringField(raw, "pack_id", file),
    explicit_targets: stringList(raw, "explicit_targets", file),
    settled_any: refs("settled_any"),
    settled_all: refs("settled_all"),
    dormant_platforms: stringList(raw, "dormant_platforms", file),
    non_trigger_utterances: stringList(raw, "non_trigger_utterances", file),
    skill_ids: stringList(raw, "skill_ids", file),
    not_applicable_question_ids: stringList(raw, "not_applicable_question_ids", file),
    not_applicable_criteria: stringList(raw, "not_applicable_criteria", file),
    source_file: file,
  };
}

const PACK_FILES = [
  "corpus/packs/wave2-expanded/browser-extension.yaml",
  "corpus/packs/wave2-expanded/mobile.yaml",
  "corpus/packs/wave2-expanded/desktop.yaml",
] as const;

const ELABORATION_FILES = [
  "corpus/elaborations/wave2/browser-extension.yaml",
  "corpus/elaborations/wave2/mobile.yaml",
  "corpus/elaborations/wave2/desktop.yaml",
] as const;

export function loadWave2Bundle(repoRoot: string): Wave2Bundle {
  const questions: QuestionRecord[] = [];
  const activations: ActivationRecord[] = [];
  const elaborations: ElaborationRecord[] = [];
  const files = [...PACK_FILES, ...ELABORATION_FILES];
  for (const file of PACK_FILES) {
    const parsed = parseYaml(repoRoot, file);
    if (!isRecord(parsed)) fail(file, "pack root must be a mapping");
    const pack = stringField(parsed, "pack", file);
    const activation = parsed.activation;
    if (!isRecord(activation)) fail(file, "missing activation");
    activations.push(parseActivation(activation, file));
    for (const raw of recordList(parsed, "questions", file)) questions.push(parseQuestion(raw, file, pack));
  }
  for (const file of ELABORATION_FILES) {
    const parsed = parseYaml(repoRoot, file);
    if (!isRecord(parsed)) fail(file, "elaboration root must be a mapping");
    for (const raw of recordList(parsed, "elaborations", file)) {
      elaborations.push({
        id: stringField(raw, "id", file),
        question_id: stringField(raw, "question_id", file),
        option_id: stringField(raw, "option_id", file),
        summary: stringField(raw, "summary", file),
        touches: scope(raw.touches, file),
        clauses: recordList(raw, "clauses", file).map((clause) => ({
          id: stringField(clause, "id", file),
          text: stringField(clause, "text", file),
          oracle_hint: stringField(clause, "oracle_hint", file),
          touches: scope(clause.touches, file),
        })),
        edge_cases: stringList(raw, "edge_cases", file),
        bounds: recordList(raw, "bounds", file).map((bound) => ({
          key: stringField(bound, "key", file),
          value: numberField(bound, "value", file),
          unit: stringField(bound, "unit", file),
        })),
        oracle_hints: stringList(raw, "oracle_hints", file),
        source_file: file,
      });
    }
  }
  return { questions, elaborations, activations, files };
}

export function readSkillFiles(directory: string): { relativePath: string; bytes: Uint8Array }[] {
  const files: { relativePath: string; bytes: Uint8Array }[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute, relativePath);
      else if (entry.isFile()) files.push({ relativePath: relativePath.replaceAll("\\", "/"), bytes: fs.readFileSync(absolute) });
    }
  };
  walk(directory, "");
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return files;
}

export function loadSkillDir(directory: string, entry: {
  skillId: string;
  version: string;
  tokenCount: number;
  allowedRoles: string[];
  allowedTouches: string[];
  vettingStatus: string;
}): LoadedSkill {
  const files = readSkillFiles(directory);
  const skill = files.find((file) => file.relativePath === "SKILL.md");
  if (!skill) throw new CorpusPackError(`${directory} is missing SKILL.md`);
  return {
    ...entry,
    text: new TextDecoder("utf-8", { fatal: true }).decode(skill.bytes),
    files,
  };
}

export function repoRootFromHere(): string {
  return findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
}
