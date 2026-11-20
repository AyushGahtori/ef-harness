import type { CatalogQuestion, WaveBundle } from "./load.js";
import { isInferenceRule, isTouchesTag, TOUCHES_TAGS } from "./tags.js";

export class CorpusQualityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorpusQualityError";
  }
}

export class UnrecognizedTouchesTagError extends CorpusQualityError {
  constructor(message: string) {
    super(message);
    this.name = "UnrecognizedTouchesTagError";
  }
}

export class InsufficientExamplesError extends CorpusQualityError {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientExamplesError";
  }
}

export class PrerequisiteCycleError extends CorpusQualityError {
  constructor(message: string) {
    super(message);
    this.name = "PrerequisiteCycleError";
  }
}

export class MustAskPolicyFloorError extends CorpusQualityError {
  constructor(message: string) {
    super(message);
    this.name = "MustAskPolicyFloorError";
  }
}

export class AsymmetricConflictError extends CorpusQualityError {
  constructor(message: string) {
    super(message);
    this.name = "AsymmetricConflictError";
  }
}

const ORACLE_HINT = /idempoten|failure|quota|retry|dead-letter|fallback|duplicate/i;

/**
 * Local port of Task 075 CorpusQualityValidator.
 * Swap imports to packages/discovery/src/corpus-loader when that branch is integrated.
 */
export class CorpusQualityValidator {
  validate(bundle: WaveBundle): void {
    const seen = new Set<string>();
    const criteriaOwners = new Map<string, string>();
    for (const question of bundle.questions) {
      if (seen.has(question.id)) {
        throw new CorpusQualityError(`Duplicate question ID ${question.id} in ${question.source_file}`);
      }
      seen.add(question.id);
      this.validateQuestion(question);
      for (const criterion of question.criteria) {
        const owner = criteriaOwners.get(criterion);
        if (owner) {
          throw new CorpusQualityError(`Criterion ${criterion} is owned by both ${owner} and ${question.id}`);
        }
        criteriaOwners.set(criterion, question.id);
      }
    }
    for (const question of bundle.questions) {
      for (const target of question.requires) {
        if (!seen.has(target)) {
          throw new CorpusQualityError(`Question ${question.id} requires missing ${target}`);
        }
      }
      for (const target of question.conflicts_with) {
        if (!seen.has(target)) {
          throw new CorpusQualityError(`Question ${question.id} conflicts with missing ${target}`);
        }
        const other = bundle.questions.find((item) => item.id === target);
        if (!other?.conflicts_with.includes(question.id)) {
          throw new AsymmetricConflictError(
            `conflicts_with is asymmetric: ${question.id} lists ${target} but ${target} omits ${question.id}`,
          );
        }
      }
      for (const clause of question.applies_when) {
        if (!criteriaOwners.has(clause.criterion)) {
          throw new CorpusQualityError(`Orphan criterion ${clause.criterion} on ${question.id}`);
        }
      }
      for (const criterion of question.invalidates_on_change) {
        if (!criteriaOwners.has(criterion)) {
          throw new CorpusQualityError(`Orphan criterion ${criterion} on ${question.id}`);
        }
      }
    }
    const cycle = findCycle(bundle.questions);
    if (cycle) throw new PrerequisiteCycleError(`Prerequisite cycle: ${cycle.join(" -> ")}`);
    for (const elaboration of bundle.elaborations) {
      const question = bundle.questions.find((item) => item.id === elaboration.question);
      if (!question) {
        throw new CorpusQualityError(`Elaboration ${elaboration.id} references missing question ${elaboration.question}`);
      }
      if (!question.options.some((option) => option.id === elaboration.option)) {
        throw new CorpusQualityError(
          `Elaboration ${elaboration.id} references missing option ${elaboration.option} on ${elaboration.question}`,
        );
      }
      const detail =
        elaboration.cells.length +
        elaboration.edge_cases.length +
        elaboration.bounds.length +
        elaboration.oracle_hints.length;
      if (detail === 0) throw new CorpusQualityError(`Elaboration ${elaboration.id} has no behavioral detail`);
    }
  }

  private validateQuestion(question: CatalogQuestion): void {
    if (question.positive_examples.length < 5 || question.negative_examples.length < 2) {
      throw new InsufficientExamplesError(
        `Question ${question.id} has ${question.positive_examples.length} positive examples (minimum 5) and ${question.negative_examples.length} negative examples (minimum 2)`,
      );
    }
    if (!question.positive_examples.some((example) => example.style === "spoken_dictation")) {
      throw new InsufficientExamplesError(`Question ${question.id} is missing a spoken dictation example`);
    }
    if (question.touches.length === 0) {
      throw new UnrecognizedTouchesTagError(`Question ${question.id} has no touches tags. Valid tags: ${TOUCHES_TAGS.join(", ")}`);
    }
    const invalid = question.touches.filter((tag) => !isTouchesTag(tag));
    if (invalid.length > 0) {
      throw new UnrecognizedTouchesTagError(
        `Unrecognized touches tag ${invalid.map((tag) => `"${tag}"`).join(", ")} on ${question.id}. Valid tags (${TOUCHES_TAGS.length}): ${TOUCHES_TAGS.join(", ")}`,
      );
    }
    if (
      question.must_ask === false &&
      (question.reversibility === "costly" || question.reversibility === "irreversible")
    ) {
      throw new MustAskPolicyFloorError(
        `Question ${question.id} is ${question.reversibility} and must_ask must be true`,
      );
    }
    if (question.options.length < 2) throw new CorpusQualityError(`Question ${question.id} needs at least two options`);
    for (const stage of ["prototype", "mvp", "production"]) {
      const recommendation = question.stage_recommendations[stage];
      if (!recommendation || recommendation.rationale.trim() === "") {
        throw new CorpusQualityError(`Question ${question.id} is missing a ${stage} rationale`);
      }
      const option = question.options.find((item) => item.id === recommendation.option);
      if (!option || !option.stage_suitability.includes(stage)) {
        throw new CorpusQualityError(`Question ${question.id} recommends unknown option for ${stage}`);
      }
    }
    const rules = new Set<string>();
    for (const rule of question.allowed_inference_rules) {
      if (!isInferenceRule(rule)) throw new CorpusQualityError(`Question ${question.id} allows unknown inference rule ${rule}`);
      if (rules.has(rule)) throw new CorpusQualityError(`Question ${question.id} repeats inference rule ${rule}`);
      rules.add(rule);
    }
    for (const example of question.positive_examples) {
      for (const key of Object.keys(example.settles)) {
        if (!question.criteria.includes(key)) {
          throw new CorpusQualityError(`Orphan criterion ${key} on ${question.id}`);
        }
      }
    }
  }
}

function findCycle(questions: readonly CatalogQuestion[]): string[] | null {
  const requires = new Map(questions.map((question) => [question.id, question.requires]));
  const color = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    const state = color.get(id);
    if (state === "done") return null;
    if (state === "visiting") {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    color.set(id, "visiting");
    stack.push(id);
    for (const next of requires.get(id) ?? []) {
      if (!requires.has(next)) continue;
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    color.set(id, "done");
    return null;
  };
  for (const question of questions) {
    const cycle = visit(question.id);
    if (cycle) return cycle;
  }
  return null;
}

const ORACLE_PACKS = new Set(["payments", "notifications", "ai-llm"]);

export function assertDomainOracles(bundle: WaveBundle): void {
  const webhook = bundle.elaborations.find((item) => item.option === "signed_webhook_fulfillment");
  if (!webhook) throw new CorpusQualityError("Missing webhook fulfillment elaboration");
  const hint = webhook.oracle_hints.join(" ");
  if (!/duplicate/i.test(hint) || !/idempoten/i.test(hint)) {
    throw new CorpusQualityError("Webhook fulfillment elaboration omits the duplicate-event idempotency oracle");
  }
  const packs = new Map(bundle.questions.map((question) => [question.id, question.packId]));
  for (const elaboration of bundle.elaborations) {
    const packId = packs.get(elaboration.question);
    if (!packId || !ORACLE_PACKS.has(packId)) continue;
    const text = elaboration.oracle_hints.join(" ");
    if (!ORACLE_HINT.test(text)) {
      throw new CorpusQualityError(
        `Elaboration ${elaboration.id} is missing a failure, idempotency, or quota oracle hint`,
      );
    }
  }
}
