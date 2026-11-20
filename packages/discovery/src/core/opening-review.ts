import type { OpeningRubricId } from "./opening-prompts.js";

export interface ReviewSpan {
  readonly rubricId: OpeningRubricId;
  readonly quote: string;
  readonly start: number;
  readonly end: number;
}

export interface ExplicitSettlement {
  readonly criterionId: string;
  readonly value: string;
  readonly quote: string;
  readonly start: number;
  readonly end: number;
  readonly rubricId: OpeningRubricId;
}

export interface OpeningReview {
  readonly evidence: readonly ReviewSpan[];
  readonly rubricsCovered: readonly OpeningRubricId[];
  readonly explicitValues: readonly ExplicitSettlement[];
  readonly partialCriteria: readonly string[];
  readonly acceptanceExamples: readonly ReviewSpan[];
  readonly needsConfirmation: readonly string[];
  readonly delegation: { readonly scope: string; readonly limits: readonly string[] } | null;
}

export interface OpeningReviewer {
  review(text: string, target: string | null): OpeningReview;
}

const DATABASE_DELEGATION = "Choose a free local database for the demo";

/**
 * Deterministic stand-in for Task 070 `opening-review@1`.
 * The presentation target is ignored: one pipeline reads the whole turn,
 * so an answer shown under prompt 3 can still credit opening.4.
 */
export class DeterministicOpeningReviewer implements OpeningReviewer {
  review(text: string, target: string | null): OpeningReview {
    void target;
    const evidence: ReviewSpan[] = [];
    const explicitValues: ExplicitSettlement[] = [];
    const acceptanceExamples: ReviewSpan[] = [];
    const add = (rubricId: OpeningRubricId, pattern: RegExp): ReviewSpan | null => {
      const span = firstMatch(text, pattern);
      if (!span) return null;
      const reviewSpan = { rubricId, ...span };
      evidence.push(reviewSpan);
      return reviewSpan;
    };

    const purpose = add("opening.1", /\bi would like to build\b[^.]*/i);
    if (purpose) {
      explicitValues.push({
        criterionId: "product.purpose",
        value: purpose.quote,
        quote: purpose.quote,
        start: purpose.start,
        end: purpose.end,
        rubricId: "opening.1",
      });
    }

    const audience = add("opening.2", /\bour office manager\b[^.]*/i);
    if (audience) {
      for (const criterionId of ["product.audience", "actors.roles"]) {
        explicitValues.push({
          criterionId,
          value: audience.quote,
          quote: audience.quote,
          start: audience.start,
          end: audience.end,
          rubricId: "opening.2",
        });
      }
    }

    const workflow = add("opening.3", /\bstaff submit\b[^.]*/i);
    if (workflow) {
      explicitValues.push({
        criterionId: "workflows.primary",
        value: workflow.quote,
        quote: workflow.quote,
        start: workflow.start,
        end: workflow.end,
        rubricId: "opening.3",
      });
    }

    const demo = add("opening.4", /two soup orders\b(?:(?!\.)[\s\S]){0,160}?soup\s*[×x]\s*2/i);
    if (demo) {
      acceptanceExamples.push(demo);
    }

    const repo = add("opening.5", /\buse our existing web repo\b[^.]*/i);
    if (repo) {
      explicitValues.push({
        criterionId: "deploy.target",
        value: "existing web repo",
        quote: repo.quote,
        start: repo.start,
        end: repo.end,
        rubricId: "opening.5",
      });
    }

    const delegationSpan = firstMatch(text, /choose a free local database for the demo/i);
    let delegation: OpeningReview["delegation"] = null;
    if (delegationSpan) {
      evidence.push({ rubricId: "opening.5", ...delegationSpan });
      delegation = {
        scope: DATABASE_DELEGATION,
        limits: ["free", "local"],
      };
    }

    const rubricsCovered = uniqueRubrics(evidence);
    return {
      evidence,
      rubricsCovered,
      explicitValues,
      partialCriteria: workflow ? ["data.entities"] : [],
      acceptanceExamples,
      needsConfirmation: demo ? ["product.stage"] : [],
      delegation,
    };
  }
}

function firstMatch(
  text: string,
  pattern: RegExp,
): { quote: string; start: number; end: number } | null {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const global = new RegExp(pattern.source, flags);
  const match = global.exec(text);
  if (!match || match.index === undefined) return null;
  const quote = match[0];
  return { quote, start: match.index, end: match.index + quote.length };
}

function uniqueRubrics(evidence: readonly ReviewSpan[]): OpeningRubricId[] {
  const ids: OpeningRubricId[] = [];
  for (const span of evidence) {
    if (!ids.includes(span.rubricId)) ids.push(span.rubricId);
  }
  return ids;
}
