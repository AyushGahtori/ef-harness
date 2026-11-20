import fs from "node:fs";
import path from "node:path";
import { CorpusShapeError } from "./errors.js";
import { normalizeQuestionGraph } from "./graph.js";
import { corpusBundleHash } from "./hash.js";
import { parseStrictJson } from "./json-document.js";
import {
  inferDocumentKind,
  readElaborationPack,
  readPolicyPack,
  readQuestionPack,
  readRulePack,
  readSeamPack,
} from "./interpret.js";
import {
  PACK_MANIFEST_SCHEMA_VERSION,
  type CorpusBundle,
  type CrossCuttingRuleManifest,
  type LoadedQuestion,
  type OptionElaborationManifest,
  type ParsedCorpusFile,
  type SeamTemplateManifest,
  type UniversalPolicyManifest,
} from "./types.js";
import { CorpusQualityValidator } from "./validate.js";
import { parseStrictYaml, STRICT_YAML_PARSE_OPTIONS } from "./yaml.js";

export interface CorpusPackLoaderOptions {
  readonly validate?: boolean;
  readonly strictConflicts?: boolean;
  readonly uniqueKeys?: boolean;
}

export class CorpusPackLoader {
  private readonly shouldValidate: boolean;
  private readonly strictConflicts: boolean;
  private readonly uniqueKeys: boolean;

  constructor(
    private readonly corpusRoot: string,
    options: CorpusPackLoaderOptions = {},
  ) {
    this.shouldValidate = options.validate ?? true;
    this.strictConflicts = options.strictConflicts ?? true;
    this.uniqueKeys = options.uniqueKeys ?? STRICT_YAML_PARSE_OPTIONS.uniqueKeys;
  }

  load(): CorpusBundle {
    const root = path.resolve(this.corpusRoot);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new CorpusShapeError(`Corpus root is not a directory: ${root}`, { filePath: root });
    }
    const files = collectCorpusFiles(root).map((full) => {
      const relative = path.relative(root, full).split(path.sep).join("/");
      const text = fs.readFileSync(full, "utf8");
      const document = relative.endsWith(".json")
        ? parseStrictJson(text, full)
        : parseStrictYaml(text, full, { uniqueKeys: this.uniqueKeys });
      const kind = inferDocumentKind(relative, isRecord(document) ? document.kind : undefined);
      return { path: relative, full, kind, document };
    });
    const parsed: ParsedCorpusFile[] = files.map((file) => ({
      path: file.path,
      kind: file.kind,
      document: file.document,
    }));
    const questions: LoadedQuestion[] = [];
    const elaborations: OptionElaborationManifest[] = [];
    const policies: UniversalPolicyManifest[] = [];
    const rules: CrossCuttingRuleManifest[] = [];
    const seams: SeamTemplateManifest[] = [];
    for (const file of files) {
      if (file.kind === "question_pack") {
        questions.push(...readQuestionPack(file.document, file.full).questions);
      } else if (file.kind === "option_elaborations") {
        elaborations.push(...readElaborationPack(file.document, file.full).elaborations);
      } else if (file.kind === "universal_policies") {
        policies.push(...readPolicyPack(file.document, file.full).policies);
      } else if (file.kind === "cross_cutting_rules") {
        rules.push(...readRulePack(file.document, file.full).rules);
      } else {
        seams.push(...readSeamPack(file.document, file.full).seams);
      }
    }
    const graph = normalizeQuestionGraph(questions);
    const bundle: CorpusBundle = {
      corpusRoot: root,
      formatVersion: PACK_MANIFEST_SCHEMA_VERSION,
      files: parsed,
      questions: graph.questions,
      elaborations,
      policies,
      rules,
      seams,
      corpusBundleHash: corpusBundleHash(parsed),
      conflictAsymmetries: graph.asymmetries,
    };
    if (this.shouldValidate) {
      new CorpusQualityValidator({ strictConflicts: this.strictConflicts }).validate(bundle);
    }
    return bundle;
  }
}

export function loadCorpusPacks(corpusRoot: string, options?: CorpusPackLoaderOptions): CorpusBundle {
  return new CorpusPackLoader(corpusRoot, options).load();
}

const CORPUS_SUBTREES = ["packs", "elaborations", "policies", "rules-seams", "seams"] as const;

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
      else if (entry.isFile() && /\.(yaml|yml|json)$/i.test(entry.name)) found.push(full);
    }
  };
  for (const subtree of CORPUS_SUBTREES) {
    const directory = path.join(root, subtree);
    if (fs.existsSync(directory) && fs.statSync(directory).isDirectory()) walk(directory);
  }
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
