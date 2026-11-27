import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export interface AppliesWhen {
  readonly criterion: string;
  readonly equals?: string;
}

export interface CatalogOption {
  readonly id: string;
  readonly label: string;
  readonly meaning: string;
  readonly stage_suitability: readonly string[];
  readonly consequences: string;
}

export interface StageRecommendation {
  readonly option: string;
  readonly rationale: string;
}

export interface PositiveExample {
  readonly utterance: string;
  readonly style?: string;
  readonly settles: Readonly<Record<string, string>>;
}

export interface NegativeExample {
  readonly utterance: string;
  readonly must_not_settle: readonly string[];
  readonly reason: string;
}

export interface CatalogQuestion {
  readonly id: string;
  readonly packId: string;
  readonly packTitle: string;
  readonly source_file: string;
  readonly criteria: readonly string[];
  readonly applies_when: readonly AppliesWhen[];
  readonly requires: readonly string[];
  readonly conflicts_with: readonly string[];
  readonly risk_tier: string;
  readonly impact: string;
  readonly reversibility: string;
  readonly must_ask: boolean;
  readonly touches: readonly string[];
  readonly options: readonly CatalogOption[];
  readonly stage_recommendations: Readonly<Record<string, StageRecommendation>>;
  readonly allowed_inference_rules: readonly string[];
  readonly invalidates_on_change: readonly string[];
  readonly positive_examples: readonly PositiveExample[];
  readonly negative_examples: readonly NegativeExample[];
  readonly stage_applicability: Readonly<Record<string, boolean>>;
}

export interface ElaborationCell {
  readonly cell: string;
  readonly value: string;
}

export interface Elaboration {
  readonly id: string;
  readonly question: string;
  readonly option: string;
  readonly cells: readonly ElaborationCell[];
  readonly edge_cases: readonly string[];
  readonly bounds: readonly string[];
  readonly oracle_hints: readonly string[];
  readonly source_file: string;
}

export interface WaveBundle {
  readonly questions: readonly CatalogQuestion[];
  readonly elaborations: readonly Elaboration[];
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a sequence`);
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value;
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

function stringList(value: unknown, label: string): string[] {
  return asArray(value, label).map((item) => asString(item, label));
}

export function repositoryRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let hop = 0; hop < 8; hop += 1) {
    if (fs.existsSync(path.join(dir, "corpus", "packs", "wave1-expanded"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("wave1 corpus root not found");
}

function readQuestion(value: unknown, packId: string, packTitle: string, sourceFile: string): CatalogQuestion {
  const record = asRecord(value, "question");
  const recommendations = asRecord(record.stage_recommendations, "stage_recommendations");
  const stageRecommendations: Record<string, StageRecommendation> = {};
  for (const stage of ["prototype", "mvp", "production"]) {
    const entry = asRecord(recommendations[stage], stage);
    stageRecommendations[stage] = {
      option: asString(entry.option, `${stage} option`),
      rationale: asString(entry.rationale, `${stage} rationale`),
    };
  }
  const applicability = asRecord(record.stage_applicability, "stage_applicability");
  return {
    id: asString(record.id, "id"),
    packId,
    packTitle,
    source_file: sourceFile,
    criteria: stringList(record.criteria, "criteria"),
    applies_when: asArray(record.applies_when, "applies_when").map((item) => {
      const clause = asRecord(item, "applies_when");
      const next: AppliesWhen = { criterion: asString(clause.criterion, "criterion") };
      if (clause.equals !== undefined) return { ...next, equals: asString(clause.equals, "equals") };
      return next;
    }),
    requires: stringList(record.requires, "requires"),
    conflicts_with: stringList(record.conflicts_with, "conflicts_with"),
    risk_tier: asString(record.risk_tier, "risk_tier"),
    impact: asString(record.impact, "impact"),
    reversibility: asString(record.reversibility, "reversibility"),
    must_ask: asBoolean(record.must_ask, "must_ask"),
    touches: stringList(record.touches, "touches"),
    options: asArray(record.options, "options").map((item) => {
      const option = asRecord(item, "option");
      return {
        id: asString(option.id, "option id"),
        label: asString(option.label, "label"),
        meaning: asString(option.meaning, "meaning"),
        stage_suitability: stringList(option.stage_suitability, "stage_suitability"),
        consequences: asString(option.consequences, "consequences"),
      };
    }),
    stage_recommendations: stageRecommendations,
    allowed_inference_rules: stringList(record.allowed_inference_rules, "allowed_inference_rules"),
    invalidates_on_change: stringList(record.invalidates_on_change, "invalidates_on_change"),
    positive_examples: asArray(record.positive_examples, "positive_examples").map((item) => {
      const example = asRecord(item, "positive example");
      const settles = asRecord(example.settles, "settles");
      const mapped: Record<string, string> = {};
      for (const [key, raw] of Object.entries(settles)) mapped[key] = asString(raw, key);
      const next: PositiveExample = { utterance: asString(example.utterance, "utterance"), settles: mapped };
      if (example.style !== undefined) return { ...next, style: asString(example.style, "style") };
      return next;
    }),
    negative_examples: asArray(record.negative_examples, "negative_examples").map((item) => {
      const example = asRecord(item, "negative example");
      return {
        utterance: asString(example.utterance, "utterance"),
        must_not_settle: stringList(example.must_not_settle, "must_not_settle"),
        reason: asString(example.reason, "reason"),
      };
    }),
    stage_applicability: {
      prototype: asBoolean(applicability.prototype, "prototype"),
      mvp: asBoolean(applicability.mvp, "mvp"),
      production: asBoolean(applicability.production, "production"),
    },
  };
}

function readElaboration(value: unknown, sourceFile: string): Elaboration {
  const record = asRecord(value, "elaboration");
  return {
    id: asString(record.id, "elaboration id"),
    question: asString(record.question, "question"),
    option: asString(record.option, "option"),
    cells: asArray(record.cells, "cells").map((item) => {
      const cell = asRecord(item, "cell");
      return { cell: asString(cell.cell, "cell"), value: asString(cell.value, "value") };
    }),
    edge_cases: stringList(record.edge_cases, "edge_cases"),
    bounds: stringList(record.bounds, "bounds"),
    oracle_hints: stringList(record.oracle_hints, "oracle_hints"),
    source_file: sourceFile,
  };
}

export function loadWave1Bundle(root = repositoryRoot()): WaveBundle {
  const packDir = path.join(root, "corpus", "packs", "wave1-expanded");
  const elabDir = path.join(root, "corpus", "elaborations", "wave1");
  const questions: CatalogQuestion[] = [];
  const elaborations: Elaboration[] = [];
  for (const name of fs.readdirSync(packDir).sort()) {
    if (!name.endsWith(".yaml")) continue;
    const full = path.join(packDir, name);
    const document = asRecord(parse(fs.readFileSync(full, "utf8"), { uniqueKeys: true, strict: true }), name);
    const packId = asString(document.id, "pack id");
    const packTitle = asString(document.title, "title");
    for (const item of asArray(document.questions, "questions")) {
      questions.push(readQuestion(item, packId, packTitle, full));
    }
  }
  for (const name of fs.readdirSync(elabDir).sort()) {
    if (!name.endsWith(".yaml")) continue;
    const full = path.join(elabDir, name);
    const document = asRecord(parse(fs.readFileSync(full, "utf8"), { uniqueKeys: true, strict: true }), name);
    for (const item of asArray(document.elaborations, "elaborations")) {
      elaborations.push(readElaboration(item, full));
    }
  }
  return { questions, elaborations };
}
