import type { CatalogQuestion, CriterionState, QuestionOption } from "./types.js";
import { plainLabel } from "./plain-english.js";

export interface ClarifyRequest {
  readonly questionId: string;
  readonly criterionId: string;
  readonly criterionLabel: string;
  readonly previousText: string;
  readonly options: readonly QuestionOption[];
}

export interface ClarifyResponse {
  readonly text: string;
  readonly options: readonly QuestionOption[];
}

/**
 * Local port for Task 070 `clarify@1`.
 * Swap `DeterministicClarifyRephraser` for `DiscoveryPromptOrchestrator` when that branch is wired.
 */
export interface ClarifyPort {
  rephrase(request: ClarifyRequest): ClarifyResponse;
}

export class DeterministicClarifyRephraser implements ClarifyPort {
  rephrase(request: ClarifyRequest): ClarifyResponse {
    const label = request.criterionLabel.trim().length > 0 ? request.criterionLabel.trim() : "this product choice";
    let text = `Let's decide this with a concrete choice: ${label}.`;
    if (text === request.previousText.trim()) {
      text = `${text} Pick one option.`;
    }
    return { text, options: request.options };
  }
}

export interface NagAdjustment {
  readonly text: string;
  readonly options: readonly QuestionOption[];
  readonly rephrased: boolean;
  readonly offerDefaultOrDefer: boolean;
}

export class AntiNagGuard {
  constructor(private readonly clarify: ClarifyPort) {}

  adjust(
    question: CatalogQuestion,
    covered: readonly CriterionState[],
    criterionIds: readonly string[],
  ): NagAdjustment {
    const skipCount = covered.reduce((max, criterion) => Math.max(max, criterion.skipCount), 0);
    const ambiguous = covered.some((criterion) => criterion.ambiguous);
    const mustAsk = question.mustAsk || covered.some((criterion) => criterion.mustAsk);
    const primary = covered[0];
    const label = plainLabel(primary?.label ?? "this product choice", criterionIds);
    let text = question.text;
    let options = [...question.options];
    let rephrased = false;

    if (skipCount >= 1 || ambiguous) {
      const response = this.clarify.rephrase({
        questionId: question.id,
        criterionId: primary?.id ?? question.id,
        criterionLabel: label,
        previousText: question.text,
        options,
      });
      text = response.text;
      options = [...response.options];
      rephrased = true;
      if (text.trim() === question.text.trim()) {
        text = `Let's decide this with a concrete choice: ${label}. Pick one option.`;
      }
    }

    if (skipCount >= 2 && !mustAsk) {
      return {
        text,
        rephrased: true,
        offerDefaultOrDefer: true,
        options: [
          { id: "use_recommended_default", label: "Use recommended default", recommended: true },
          { id: "defer_for_later", label: "Defer for later", recommended: false },
        ],
      };
    }

    return { text, options, rephrased, offerDefaultOrDefer: false };
  }
}
