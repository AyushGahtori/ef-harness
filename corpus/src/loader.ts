import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TouchesTagSchema } from "@ef-harness/shared-contracts";
import { parseDocument } from "yaml";

export const MAX_CORPUS_ALIAS_COUNT = 100;

const CORPUS_SUBTREES = ["packs", "elaborations", "policies", "rules-seams"] as const;
const INDEX_FILES = new Set(["manifest.yaml", "activation-table.yaml"]);
const AUTHORED_CORE_QUESTIONS = "packages/discovery/tests/corpus-web-api-cli/port/task-075-questions.json";

export class CorpusLoadError extends Error {
  readonly filePath: string;
  readonly line?: number;

  constructor(message: string, filePath: string, line?: number) {
    super(message);
    this.name = "CorpusLoadError";
    this.filePath = filePath;
    if (line !== undefined) this.line = line;
  }
}

export interface CatalogOption {
  readonly id: string;
  readonly stageSuitability: readonly string[];
}

export interface CatalogQuestion {
  readonly id: string;
  readonly pack: string;
  readonly title: string;
  readonly mustAsk: boolean;
  readonly criteria: readonly string[];
  readonly touches: readonly string[];
  readonly sourceFile: string;
  readonly options: readonly CatalogOption[];
}

export interface CatalogElaboration {
  readonly id: string;
  readonly questionId: string;
  readonly optionId: string;
  readonly sourceFile: string;
}

export interface CatalogPolicy {
  readonly id: string;
  readonly sourceFile: string;
}

export interface CatalogRule {
  readonly id: string;
  readonly sourceFile: string;
}

export interface CatalogSeam {
  readonly id: string;
  readonly rules: readonly string[];
  readonly sourceFile: string;
}

export interface DanglingOptionRef {
  readonly ownerId: string;
  readonly questionId: string;
  readonly optionId: string;
  readonly sourceFile: string;
}

export interface CorpusFileDigest {
  readonly path: string;
  readonly sha256: string;
}

export interface LoadedCorpusCatalog {
  readonly questions: readonly CatalogQuestion[];
  readonly elaborations: readonly CatalogElaboration[];
  readonly crossCuttingRules: readonly CatalogRule[];
  readonly universalPolicies: readonly CatalogPolicy[];
  readonly seamTemplates: readonly CatalogSeam[];
  readonly danglingOptionIds: readonly DanglingOptionRef[];
  readonly files: readonly CorpusFileDigest[];
  readonly manifestSha256: string;
}

export function bundledCorpusRoot(moduleUrl: string = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..");
}

export class CorpusPackLoader {
  constructor(private readonly corpusRoot: string = bundledCorpusRoot()) {}

  loadAllBundledPacks(): LoadedCorpusCatalog {
    const root = path.resolve(this.corpusRoot);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new CorpusLoadError(`Corpus root is not a directory: ${root}`, root);
    }
    const questions: CatalogQuestion[] = [];
    const elaborations: CatalogElaboration[] = [];
    const universalPolicies: CatalogPolicy[] = [];
    const crossCuttingRules: CatalogRule[] = [];
    const seamTemplates: CatalogSeam[] = [];
    const optionRefs: DanglingOptionRef[] = [];
    const files: CorpusFileDigest[] = [];

    for (const full of collectCorpusFiles(root)) {
      const relative = path.relative(root, full).split(path.sep).join("/");
      const text = fs.readFileSync(full, "utf8");
      files.push({ path: relative, sha256: sha256(text) });
      if (INDEX_FILES.has(path.posix.basename(relative))) continue;
      const document = parseCorpusYaml(text, relative);
      absorbDocument(document, relative, {
        questions,
        elaborations,
        universalPolicies,
        crossCuttingRules,
        seamTemplates,
        optionRefs,
      });
    }

    questions.push(...readAuthoredCoreQuestions(path.resolve(root, "..")));
    const known = optionIndex(questions);
    const danglingOptionIds = [
      ...optionRefs.filter((ref) => !known.get(ref.questionId)?.has(ref.optionId)),
      ...elaborationDangling(elaborations, known),
    ];
    const ruleIds = new Set(crossCuttingRules.map((rule) => rule.id));
    for (const seam of seamTemplates) {
      for (const ruleId of seam.rules) {
        if (!ruleIds.has(ruleId)) {
          throw new CorpusLoadError(`Seam ${seam.id} activates missing rule ${ruleId}`, seam.sourceFile);
        }
      }
    }

    return {
      questions,
      elaborations,
      crossCuttingRules,
      universalPolicies,
      seamTemplates,
      danglingOptionIds,
      files,
      manifestSha256: manifestSha256(files),
    };
  }
}

interface AbsorbTarget {
  questions: CatalogQuestion[];
  elaborations: CatalogElaboration[];
  universalPolicies: CatalogPolicy[];
  crossCuttingRules: CatalogRule[];
  seamTemplates: CatalogSeam[];
  optionRefs: DanglingOptionRef[];
}

function absorbDocument(document: unknown, relative: string, target: AbsorbTarget): void {
  if (!isRecord(document)) {
    throw new CorpusLoadError(`${relative}: corpus document must be a mapping`, relative);
  }
  if (document.kind === "question_pack" || (typeof document.pack === "string" && Array.isArray(document.questions))) {
    target.questions.push(...readQuestions(document, relative, target.optionRefs));
    return;
  }
  if (Array.isArray(document.elaborations)) {
    target.elaborations.push(...readElaborations(document.elaborations, relative));
    return;
  }
  if (Array.isArray(document.policies)) {
    target.universalPolicies.push(...readPolicies(document.policies, relative));
    return;
  }
  if (Array.isArray(document.rules)) {
    target.crossCuttingRules.push(...readRules(document.rules, relative));
    return;
  }
  if (Array.isArray(document.seams)) {
    target.seamTemplates.push(...readSeams(document.seams, relative));
  }
}

function readQuestions(
  document: Record<string, unknown>,
  relative: string,
  optionRefs: DanglingOptionRef[],
): CatalogQuestion[] {
  const packFallback = typeof document.id === "string" ? document.id : typeof document.pack === "string" ? document.pack : "";
  return asArray(document.questions, relative, "questions").map((item) => {
    const record = asRecord(item, relative, "question");
    const id = readString(record.id, relative, "question id");
    const pack = typeof record.pack === "string" && record.pack.trim() !== "" ? record.pack : packFallback;
    if (pack.trim() === "") throw new CorpusLoadError(`${relative}: question ${id} is missing pack`, relative);
    const options = asArray(record.options, relative, `${id} options`).map((option) => {
      const optionRecord = asRecord(option, relative, `${id} option`);
      const optionId = readString(optionRecord.id, relative, `${id} option id`);
      collectOptionRefs(optionRecord.conflicts_with, relative, optionId, optionRefs);
      return {
        id: optionId,
        stageSuitability: readStringList(optionRecord.stage_suitability, relative, `${optionId} stage_suitability`),
      };
    });
    return {
      id,
      pack,
      title: readString(record.title, relative, `${id} title`),
      mustAsk: readBoolean(record.must_ask, relative, `${id} must_ask`),
      criteria: readStringList(record.criteria, relative, `${id} criteria`),
      touches: readTagList(record.touches, relative, `${id} touches`),
      sourceFile: relative,
      options,
    };
  });
}

function readElaborations(value: unknown[], relative: string): CatalogElaboration[] {
  return value.map((item) => {
    const record = asRecord(item, relative, "elaboration");
    const id = readString(record.id, relative, "elaboration id");
    readOptionalTouches(record.touches, relative, `${id} touches`);
    if (Array.isArray(record.clauses)) {
      for (const clause of record.clauses) {
        const clauseRecord = asRecord(clause, relative, `${id} clause`);
        readScopeTags(clauseRecord.touches, relative, `${readString(clauseRecord.id, relative, "clause id")} touches`);
      }
    }
    const questionId = typeof record.question_id === "string" ? record.question_id : record.question;
    const optionId = typeof record.option_id === "string" ? record.option_id : record.option;
    return {
      id,
      questionId: readString(questionId, relative, `${id} question`),
      optionId: readString(optionId, relative, `${id} option`),
      sourceFile: relative,
    };
  });
}

function readPolicies(value: unknown[], relative: string): CatalogPolicy[] {
  return value.map((item) => {
    const record = asRecord(item, relative, "policy");
    const id = readString(record.id, relative, "policy id");
    readScopeTags(record.touches, relative, `${id} touches`);
    if (Array.isArray(record.clauses)) {
      for (const clause of record.clauses) {
        const clauseRecord = asRecord(clause, relative, `${id} clause`);
        if (clauseRecord.touches !== undefined) {
          readScopeTags(clauseRecord.touches, relative, `${id} clause touches`);
        }
      }
    }
    return { id, sourceFile: relative };
  });
}

function readRules(value: unknown[], relative: string): CatalogRule[] {
  return value.map((item) => {
    const record = asRecord(item, relative, "rule");
    const id = readString(record.id, relative, "rule id");
    readScopeTags(record.scope, relative, `${id} scope`);
    if (Array.isArray(record.match_cases)) {
      for (const match of record.match_cases) {
        const matchRecord = asRecord(match, relative, `${id} match`);
        readTagList(matchRecord.tags, relative, `${id} match tags`);
      }
    }
    return { id, sourceFile: relative };
  });
}

function readSeams(value: unknown[], relative: string): CatalogSeam[] {
  return value.map((item) => {
    const record = asRecord(item, relative, "seam");
    const id = readString(record.id, relative, "seam id");
    const activation = isRecord(record.activation) ? record.activation : undefined;
    if (activation?.scope !== undefined) readScopeTags(activation.scope, relative, `${id} activation`);
    if (Array.isArray(record.match_cases)) {
      for (const match of record.match_cases) {
        const matchRecord = asRecord(match, relative, `${id} match`);
        readTagList(matchRecord.tags, relative, `${id} match tags`);
      }
    }
    return {
      id,
      rules: readStringList(record.rules, relative, `${id} rules`),
      sourceFile: relative,
    };
  });
}

function readAuthoredCoreQuestions(repoRoot: string): CatalogQuestion[] {
  const relative = AUTHORED_CORE_QUESTIONS;
  const full = path.join(repoRoot, relative);
  if (!fs.existsSync(full)) return [];
  const parsed: unknown = JSON.parse(fs.readFileSync(full, "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.questions)) return [];
  return parsed.questions.map((item) => {
    const record = asRecord(item, relative, "authored question");
    const id = readString(record.id, relative, "authored question id");
    const options = asArray(record.options, relative, `${id} options`).map((option) => {
      const optionRecord = asRecord(option, relative, `${id} option`);
      return {
        id: readString(optionRecord.id, relative, `${id} option id`),
        stageSuitability: readStringList(optionRecord.stage_suitability, relative, `${id} stage_suitability`),
      };
    });
    return {
      id,
      pack: readString(record.pack, relative, `${id} pack`),
      title: readString(record.title, relative, `${id} title`),
      mustAsk: readBoolean(record.must_ask, relative, `${id} must_ask`),
      criteria: readStringList(record.criteria, relative, `${id} criteria`),
      touches: readTagList(record.touches, relative, `${id} touches`),
      sourceFile: relative,
      options,
    };
  });
}

function collectOptionRefs(
  value: unknown,
  relative: string,
  ownerId: string,
  optionRefs: DanglingOptionRef[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.question_id !== "string" || typeof item.option_id !== "string") continue;
    optionRefs.push({
      ownerId,
      questionId: item.question_id,
      optionId: item.option_id,
      sourceFile: relative,
    });
  }
}

function optionIndex(questions: readonly CatalogQuestion[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const question of questions) {
    const options = index.get(question.id) ?? new Set<string>();
    for (const option of question.options) options.add(option.id);
    index.set(question.id, options);
  }
  return index;
}

function elaborationDangling(
  elaborations: readonly CatalogElaboration[],
  known: ReadonlyMap<string, ReadonlySet<string>>,
): DanglingOptionRef[] {
  const dangling: DanglingOptionRef[] = [];
  for (const elaboration of elaborations) {
    if (!known.get(elaboration.questionId)?.has(elaboration.optionId)) {
      dangling.push({
        ownerId: elaboration.id,
        questionId: elaboration.questionId,
        optionId: elaboration.optionId,
        sourceFile: elaboration.sourceFile,
      });
    }
  }
  return dangling;
}

function parseCorpusYaml(source: string, filePath: string): unknown {
  const doc = parseDocument(source, {
    uniqueKeys: true,
    strict: true,
    merge: true,
  });
  const error = doc.errors[0];
  if (error) {
    const line = error.linePos?.[0]?.line;
    const message = `${filePath}: ${error.message}`;
    if (typeof line === "number") throw new CorpusLoadError(message, filePath, line);
    throw new CorpusLoadError(message, filePath);
  }
  try {
    return doc.toJS({ maxAliasCount: MAX_CORPUS_ALIAS_COUNT });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CorpusLoadError(`${filePath}: ${detail}`, filePath);
  }
}

function collectCorpusFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => {
      if (left.name < right.name) return -1;
      if (left.name > right.name) return 1;
      return 0;
    });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(yaml|yml)$/i.test(entry.name)) found.push(full);
    }
  };
  for (const subtree of CORPUS_SUBTREES) {
    const directory = path.join(root, subtree);
    if (fs.existsSync(directory) && fs.statSync(directory).isDirectory()) walk(directory);
  }
  return found;
}

function readOptionalTouches(value: unknown, filePath: string, label: string): void {
  if (value === undefined) return;
  if (Array.isArray(value)) {
    readTagList(value, filePath, label);
    return;
  }
  readScopeTags(value, filePath, label);
}

function readScopeTags(value: unknown, filePath: string, label: string): void {
  const record = asRecord(value, filePath, label);
  if (record.any !== undefined) readTagList(record.any, filePath, `${label} any`);
  if (record.all !== undefined) readTagList(record.all, filePath, `${label} all`);
}

function readTagList(value: unknown, filePath: string, label: string): string[] {
  const tags = readStringList(value, filePath, label);
  for (const tag of tags) {
    if (!TouchesTagSchema.safeParse(tag).success) {
      throw new CorpusLoadError(`${filePath}: ${label} has unknown touches tag ${tag}`, filePath);
    }
  }
  return tags;
}

function readStringList(value: unknown, filePath: string, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new CorpusLoadError(`${filePath}: ${label} must be a list of strings`, filePath);
  }
  return value;
}

function readBoolean(value: unknown, filePath: string, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new CorpusLoadError(`${filePath}: ${label} must be a boolean`, filePath);
  }
  return value;
}

function readString(value: unknown, filePath: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CorpusLoadError(`${filePath}: missing string ${label}`, filePath);
  }
  return value;
}

function asArray(value: unknown, filePath: string, label: string): unknown[] {
  if (!Array.isArray(value)) throw new CorpusLoadError(`${filePath}: missing list ${label}`, filePath);
  return value;
}

function asRecord(value: unknown, filePath: string, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new CorpusLoadError(`${filePath}: ${label} must be a mapping`, filePath);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function manifestSha256(files: readonly CorpusFileDigest[]): string {
  const body = [...files]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map((file) => `${file.path}\0${file.sha256}\0`)
    .join("");
  return sha256(body);
}
