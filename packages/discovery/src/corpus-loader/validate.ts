import {
  AsymmetricConflictError,
  CorpusShapeError,
  InsufficientExamplesError,
  MustAskPolicyFloorError,
  UnrecognizedTouchesTagError,
} from "./errors.js";
import { assertAcyclic, assertCriterionIntegrity, assertGraphTargets } from "./graph.js";
import { isInferenceRuleId } from "./inference-rules.js";
import { violatesMustAskPolicyFloor } from "./must-ask-floor.js";
import { PROJECT_STAGES, type CorpusBundle, type LoadedQuestion } from "./types.js";
import { formatTouchesTagList, isTouchesTag, TOUCHES_TAGS } from "./touches-tags.js";

export interface CorpusQualityValidatorOptions {
  readonly strictConflicts?: boolean;
}

export class CorpusQualityValidator {
  private readonly strictConflicts: boolean;

  constructor(options: CorpusQualityValidatorOptions = {}) {
    this.strictConflicts = options.strictConflicts ?? true;
  }

  validate(bundle: CorpusBundle): void {
    for (const question of bundle.questions) {
      this.validateQuestion(question);
    }
    assertGraphTargets(bundle.questions);
    assertAcyclic(bundle.questions);
    assertCriterionIntegrity(bundle.questions);
    this.assertSymmetric(bundle.questions);
    if (this.strictConflicts && bundle.conflictAsymmetries.length > 0) {
      const first = bundle.conflictAsymmetries[0];
      if (first) {
        throw new AsymmetricConflictError(
          `conflicts_with is asymmetric: ${first.leftId} lists ${first.rightId} but ${first.rightId} omits ${first.leftId} in ${first.leftFile}. Strict CI lint normalized the pair and still rejects the asymmetry.`,
          { filePath: first.leftFile, questionId: first.leftId },
        );
      }
    }
    this.validateAttachments(bundle);
  }

  private validateQuestion(question: LoadedQuestion): void {
    if (question.positive_examples.length < 5 || question.negative_examples.length < 2) {
      throw new InsufficientExamplesError(
        `Question ${question.id} has ${question.positive_examples.length} positive examples (minimum 5) and ${question.negative_examples.length} negative examples (minimum 2) in ${question.source_file}`,
        { filePath: question.source_file, questionId: question.id },
      );
    }
    const spoken = question.positive_examples.some((example) => example.style === "spoken_dictation");
    if (!spoken) {
      throw new InsufficientExamplesError(
        `Question ${question.id} is missing an informal spoken dictation positive example in ${question.source_file}`,
        { filePath: question.source_file, questionId: question.id },
      );
    }
    if (question.touches.length === 0) {
      throw new UnrecognizedTouchesTagError(
        `Question ${question.id} has no touches tags in ${question.source_file}. Valid tags (${TOUCHES_TAGS.length}): ${formatTouchesTagList()}`,
        { filePath: question.source_file, questionId: question.id, validTags: TOUCHES_TAGS },
      );
    }
    const invalidTags = question.touches.filter((tag) => !isTouchesTag(tag));
    if (invalidTags.length > 0) {
      const listed = invalidTags.map((tag) => `"${tag}"`).join(", ");
      throw new UnrecognizedTouchesTagError(
        `Unrecognized touches tag ${listed} on ${question.id} in ${question.source_file}. Valid tags (${TOUCHES_TAGS.length}): ${formatTouchesTagList()}`,
        { filePath: question.source_file, questionId: question.id, validTags: TOUCHES_TAGS },
      );
    }
    if (violatesMustAskPolicyFloor(question)) {
      throw new MustAskPolicyFloorError(
        `Question ${question.id} is ${question.reversibility} and must_ask must be true (MustAskPolicyFloor) in ${question.source_file}`,
        { filePath: question.source_file, questionId: question.id },
      );
    }
    if (question.options.length < 2) {
      throw new CorpusShapeError(
        `Question ${question.id} needs at least two plain-English options in ${question.source_file}`,
        { filePath: question.source_file, questionId: question.id },
      );
    }
    const optionIds = new Set(question.options.map((option) => option.id));
    for (const option of question.options) {
      if (option.label.trim() === "" || option.meaning.trim() === "" || option.stage_suitability.length === 0) {
        throw new CorpusShapeError(
          `Option ${option.id} on ${question.id} is missing a plain-English label, behavioral meaning, or stage suitability in ${question.source_file}`,
          { filePath: question.source_file, questionId: question.id },
        );
      }
    }
    for (const stage of PROJECT_STAGES) {
      const recommendation = question.stage_recommendations[stage];
      if (recommendation.rationale.trim() === "") {
        throw new CorpusShapeError(
          `Question ${question.id} is missing a ${stage} rationale in ${question.source_file}`,
          { filePath: question.source_file, questionId: question.id },
        );
      }
      if (!optionIds.has(recommendation.option)) {
        throw new CorpusShapeError(
          `Question ${question.id} recommends unknown option ${recommendation.option} for ${stage} in ${question.source_file}`,
          { filePath: question.source_file, questionId: question.id },
        );
      }
      const option = question.options.find((item) => item.id === recommendation.option);
      if (!option?.stage_suitability.includes(stage)) {
        throw new CorpusShapeError(
          `Question ${question.id} recommends ${recommendation.option} for ${stage}, which is outside that option's stage suitability, in ${question.source_file}`,
          { filePath: question.source_file, questionId: question.id },
        );
      }
    }
    const rules = new Set<string>();
    for (const rule of question.allowed_inference_rules) {
      if (!isInferenceRuleId(rule)) {
        throw new CorpusShapeError(
          `Question ${question.id} allows unknown inference rule ${rule} in ${question.source_file}`,
          { filePath: question.source_file, questionId: question.id },
        );
      }
      if (rules.has(rule)) {
        throw new CorpusShapeError(
          `Question ${question.id} repeats inference rule ${rule} in ${question.source_file}`,
          { filePath: question.source_file, questionId: question.id },
        );
      }
      rules.add(rule);
    }
  }

  private assertSymmetric(questions: readonly LoadedQuestion[]): void {
    const byId = new Map(questions.map((question) => [question.id, question]));
    for (const question of questions) {
      for (const otherId of question.conflicts_with) {
        const other = byId.get(otherId);
        if (!other?.conflicts_with.includes(question.id)) {
          throw new AsymmetricConflictError(
            `conflicts_with remained asymmetric after normalization: ${question.id} and ${otherId}`,
            { filePath: question.source_file, questionId: question.id },
          );
        }
      }
    }
  }

  private validateAttachments(bundle: CorpusBundle): void {
    const questions = new Map(bundle.questions.map((question) => [question.id, question]));
    for (const elaboration of bundle.elaborations) {
      const question = questions.get(elaboration.question);
      if (!question) {
        throw new CorpusShapeError(
          `Elaboration ${elaboration.id} references missing question ${elaboration.question} in ${elaboration.source_file}`,
          { filePath: elaboration.source_file, questionId: elaboration.question },
        );
      }
      if (!question.options.some((option) => option.id === elaboration.option)) {
        throw new CorpusShapeError(
          `Elaboration ${elaboration.id} references missing option ${elaboration.option} on ${elaboration.question} in ${elaboration.source_file}`,
          { filePath: elaboration.source_file, questionId: elaboration.question },
        );
      }
      const detailCount =
        elaboration.cells.length +
        elaboration.edge_cases.length +
        elaboration.bounds.length +
        elaboration.oracle_hints.length;
      if (detailCount === 0) {
        throw new CorpusShapeError(`Elaboration ${elaboration.id} has no behavioral detail in ${elaboration.source_file}`, {
          filePath: elaboration.source_file,
        });
      }
    }
    const ruleIds = new Set<string>();
    for (const rule of bundle.rules) {
      if (ruleIds.has(rule.id)) {
        throw new CorpusShapeError(`Duplicate rule id ${rule.id} in ${rule.source_file}`, { filePath: rule.source_file });
      }
      ruleIds.add(rule.id);
      for (const tag of [...(rule.scope.any ?? []), ...(rule.scope.all ?? [])]) {
        if (!isTouchesTag(tag)) {
          throw new UnrecognizedTouchesTagError(
            `Unrecognized touches tag "${tag}" on ${rule.id} in ${rule.source_file}. Valid tags (${TOUCHES_TAGS.length}): ${formatTouchesTagList()}`,
            { filePath: rule.source_file, questionId: rule.id, validTags: TOUCHES_TAGS },
          );
        }
      }
    }
    if (bundle.rules.length > 0) {
      for (const seam of bundle.seams) {
        for (const ruleId of seam.rules_activated) {
          if (!ruleIds.has(ruleId)) {
            throw new CorpusShapeError(
              `Seam ${seam.id} activates missing rule ${ruleId} in ${seam.source_file}`,
              { filePath: seam.source_file },
            );
          }
        }
      }
    }
    const policyIds = new Set<string>();
    for (const policy of bundle.policies) {
      if (policyIds.has(policy.id)) {
        throw new CorpusShapeError(`Duplicate policy id ${policy.id} in ${policy.source_file}`, {
          filePath: policy.source_file,
        });
      }
      policyIds.add(policy.id);
    }
  }
}
