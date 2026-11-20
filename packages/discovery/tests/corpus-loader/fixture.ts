import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { QuestionManifest } from "../../src/corpus-loader/types.js";

export function slugCriterion(id: string): string {
  return `fixture.${id.toLowerCase().replaceAll("-", "_")}`;
}

export function buildQuestion(id: string, patch: Partial<QuestionManifest> = {}): QuestionManifest {
  const criteria = patch.criteria ? [...patch.criteria] : [slugCriterion(id)];
  const settles = Object.fromEntries(criteria.map((criterion) => [criterion, "chosen"]));
  const positives = [0, 1, 2, 3, 4].map((index) => ({
    utterance:
      index === 0
        ? `yeah so for ${id} the answer is the chosen one, that's the job`
        : `The choice for ${id} example ${index + 1} is the chosen option.`,
    style: index === 0 ? ("spoken_dictation" as const) : ("plain" as const),
    settles,
  }));
  const base: QuestionManifest = {
    id,
    version: 1,
    scope: "shared",
    domains: ["fixture"],
    title: `Fixture question ${id}`,
    explain: `This fixture question ${id} exists so tests can load a valid pack.`,
    criteria,
    applies_when: [],
    requires: [],
    conflicts_with: [],
    risk_tier: "low",
    impact: "low",
    reversibility: "easy",
    must_ask: false,
    touches: ["user_content"],
    options: [
      {
        id: "chosen",
        label: "The chosen option",
        meaning: "This option is the one the examples settle.",
        stage_suitability: ["prototype", "mvp", "production"],
        consequences: "The product follows the chosen option.",
      },
      {
        id: "other",
        label: "The other option",
        meaning: "This option is a real alternative with different behavior.",
        stage_suitability: ["prototype", "mvp", "production"],
        consequences: "The product follows the other option instead.",
      },
    ],
    stage_recommendations: {
      prototype: { option: "chosen", rationale: "A prototype can take the chosen option." },
      mvp: { option: "chosen", rationale: "An MVP can keep the chosen option." },
      production: { option: "chosen", rationale: "Production keeps the chosen option until you say otherwise." },
    },
    allowed_inference_rules: ["infer.from_explicit_user_span"],
    invalidates_on_change: [],
    positive_examples: positives,
    negative_examples: [
      {
        utterance: `A near miss for ${id} that sounds related.`,
        must_not_settle: ["unrelated_guess"],
        reason: "A nearby phrase does not settle this question.",
      },
      {
        utterance: `Another near miss for ${id} with a different lure.`,
        must_not_settle: ["second_lure"],
        reason: "The second lure is not evidence for this question.",
      },
    ],
    stage_applicability: { prototype: true, mvp: true, production: true },
    status: "active",
    eval: { asked: 0, changed_build_decision: 0, user_marked_unhelpful: 0 },
  };
  return { ...base, ...patch, id, criteria: patch.criteria ?? base.criteria };
}

export function writeCorpus(
  files: readonly { readonly relativePath: string; readonly document: unknown }[],
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-corpus-"));
  for (const file of files) {
    const full = path.join(root, file.relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `${JSON.stringify(file.document, null, 2)}\n`, "utf8");
  }
  return root;
}

export function questionPack(id: string, questions: readonly QuestionManifest[]): unknown {
  return {
    kind: "question_pack",
    id,
    version: 1,
    title: id,
    questions,
  };
}
