import { createHash } from "node:crypto";
import { canonicalJson } from "./hash.js";
import type { CorpusBundle, ImpactClass, Reversibility } from "./types.js";

export interface CorpusEvalCase {
  readonly questionId: string;
  readonly sourceFile: string;
  readonly criterionIds: readonly string[];
  readonly polarity: "positive" | "negative";
  readonly index: number;
  readonly utterance: string;
  readonly settles: Readonly<Record<string, string>> | null;
  readonly mustNotSettle: readonly string[] | null;
  readonly reason: string | null;
  readonly allowedInferenceRules: readonly string[];
  readonly mustAsk: boolean;
  readonly reversibility: Reversibility;
  readonly impact: ImpactClass;
  readonly optionIds: readonly string[];
}

export interface CorpusEvalDataset {
  readonly schemaVersion: 1;
  readonly corpusBundleHash: string;
  readonly caseCount: number;
  readonly positiveCount: number;
  readonly negativeCount: number;
  readonly cases: readonly CorpusEvalCase[];
  readonly datasetHash: string;
}

export function exportCorpusEvalDataset(bundle: CorpusBundle): CorpusEvalDataset {
  const cases: CorpusEvalCase[] = [];
  for (const question of bundle.questions) {
    question.positive_examples.forEach((example, index) => {
      cases.push({
        questionId: question.id,
        sourceFile: question.source_file,
        criterionIds: question.criteria,
        polarity: "positive",
        index,
        utterance: example.utterance,
        settles: example.settles,
        mustNotSettle: null,
        reason: null,
        allowedInferenceRules: question.allowed_inference_rules,
        mustAsk: question.must_ask,
        reversibility: question.reversibility,
        impact: question.impact,
        optionIds: question.options.map((option) => option.id),
      });
    });
    question.negative_examples.forEach((example, index) => {
      cases.push({
        questionId: question.id,
        sourceFile: question.source_file,
        criterionIds: question.criteria,
        polarity: "negative",
        index,
        utterance: example.utterance,
        settles: null,
        mustNotSettle: example.must_not_settle,
        reason: example.reason,
        allowedInferenceRules: question.allowed_inference_rules,
        mustAsk: question.must_ask,
        reversibility: question.reversibility,
        impact: question.impact,
        optionIds: question.options.map((option) => option.id),
      });
    });
  }
  cases.sort((left, right) => {
    if (left.questionId !== right.questionId) return left.questionId < right.questionId ? -1 : 1;
    if (left.polarity !== right.polarity) return left.polarity === "negative" ? -1 : 1;
    return left.index - right.index;
  });
  const positiveCount = cases.filter((item) => item.polarity === "positive").length;
  const negativeCount = cases.filter((item) => item.polarity === "negative").length;
  return {
    schemaVersion: 1,
    corpusBundleHash: bundle.corpusBundleHash,
    caseCount: cases.length,
    positiveCount,
    negativeCount,
    cases,
    datasetHash: createHash("sha256").update(canonicalJson(cases)).digest("hex"),
  };
}
