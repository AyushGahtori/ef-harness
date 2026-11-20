import type {
  DiscoveryTurn,
  EvidenceSpan,
  QuoteCheckContext,
  QuoteDecisionCode,
  QuoteValidationResult,
  SettledBasis,
} from "./types.js";
import {
  autoRetractedRanges,
  extractCurrencySymbols,
  extractDigitRuns,
  extractNegationTokens,
  governingNegationDropped,
  isEmailChannelQuote,
  isInjectionQuote,
  isMenuPhoneCriterion,
  isPositionalAcceptance,
  isUncertaintyStatement,
  negationGovernsValue,
  normalizeQuoteForMatch,
  phoneClaimIsBroadened,
  quoteIsPhoneLinkOnly,
  quoteNamesRecipient,
  rangesOverlap,
  sameMultiset,
  userConfirmsBaseline,
} from "./text-rules.js";

function result(
  accepted: boolean,
  code: QuoteDecisionCode,
  message: string,
  span: EvidenceSpan,
  criterionId: string | null,
  questionId: string | null,
): QuoteValidationResult {
  return {
    accepted,
    code,
    message,
    turnId: span.turn,
    start: span.start,
    end: span.end,
    quote: span.quote,
    criterionId,
    questionId,
  };
}

/**
 * Pure quote and provenance gate. A claim earns no credit until this accepts it.
 * Assistant turns, edited digits, dropped negations, stale option versions, and
 * ids outside the active list are rejected here.
 */
export class ExactQuoteEvidenceVerifier {
  constructor(private readonly turns: readonly DiscoveryTurn[]) {}

  turnById(id: string): DiscoveryTurn | undefined {
    return this.turns.find((turn) => turn.id === id);
  }

  validateSpan(span: EvidenceSpan, context: QuoteCheckContext = {}): QuoteValidationResult {
    return this.validateClaim([span], context);
  }

  validateClaim(
    spans: readonly EvidenceSpan[],
    context: QuoteCheckContext = {},
  ): QuoteValidationResult {
    const criterionId = context.criterionId ?? null;
    const questionId = context.questionId ?? null;
    if (spans.length === 0) {
      return {
        accepted: false,
        code: "quote_mismatch",
        message: "A settled claim needs a developer quote span.",
        turnId: "",
        start: 0,
        end: 0,
        quote: "",
        criterionId,
        questionId,
      };
    }
    for (const span of spans) {
      const checked = this.checkSpan(span, criterionId, questionId);
      if (!checked.accepted) return checked;
    }
    const meaning = this.checkMeaning(spans, context, criterionId, questionId);
    if (meaning) return meaning;
    const first = spans[0];
    if (!first) {
      return {
        accepted: false,
        code: "quote_mismatch",
        message: "A settled claim needs a developer quote span.",
        turnId: "",
        start: 0,
        end: 0,
        quote: "",
        criterionId,
        questionId,
      };
    }
    return result(true, "accepted", "Quote span matches the developer turn.", first, criterionId, questionId);
  }

  private checkSpan(
    span: EvidenceSpan,
    criterionId: string | null,
    questionId: string | null,
  ): QuoteValidationResult {
    const turn = this.turnById(span.turn);
    if (!turn) {
      return result(false, "turn_not_found", `Turn ${span.turn} is not in state.db.turns.`, span, criterionId, questionId);
    }
    if (turn.author !== "developer") {
      return result(
        false,
        "assistant_author",
        "turns.author must be developer. A harness message is never user evidence.",
        span,
        criterionId,
        questionId,
      );
    }
    if (
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      span.start < 0 ||
      span.end <= span.start ||
      span.end > turn.text.length
    ) {
      return result(false, "out_of_bounds", "Span [start, end) is outside the turn text.", span, criterionId, questionId);
    }
    if (turn.retracted) {
      return result(false, "retracted", "The cited turn is retracted.", span, criterionId, questionId);
    }
    if (turn.superseded) {
      return result(false, "superseded", "The cited turn is superseded.", span, criterionId, questionId);
    }
    for (const range of turn.retractedSpans ?? []) {
      if (rangesOverlap(span.start, span.end, range)) {
        return result(false, "retracted", "The cited span overlaps a retracted range.", span, criterionId, questionId);
      }
    }
    for (const range of turn.supersededSpans ?? []) {
      if (rangesOverlap(span.start, span.end, range)) {
        return result(false, "superseded", "The cited span overlaps a superseded range.", span, criterionId, questionId);
      }
    }
    for (const range of autoRetractedRanges(turn.text)) {
      if (rangesOverlap(span.start, span.end, range)) {
        return result(
          false,
          "retracted",
          "This turn scraps the cited topic, so the span cannot earn credit.",
          span,
          criterionId,
          questionId,
        );
      }
    }
    const slice = turn.text.slice(span.start, span.end);
    const sliceDigits = extractDigitRuns(slice);
    const quoteDigits = extractDigitRuns(span.quote);
    if (!sameMultiset(sliceDigits, quoteDigits)) {
      return result(
        false,
        "digit_altered",
        "Quote digits do not match the turn. Digits such as 10:45 and 11:00 are never normalized away.",
        span,
        criterionId,
        questionId,
      );
    }
    if (!sameMultiset(extractCurrencySymbols(slice), extractCurrencySymbols(span.quote))) {
      return result(
        false,
        "currency_altered",
        "Quote currency symbols do not match the turn.",
        span,
        criterionId,
        questionId,
      );
    }
    if (!sameMultiset(extractNegationTokens(slice), extractNegationTokens(span.quote))) {
      return result(
        false,
        "negation_dropped",
        "Quote dropped or invented a negation token (not, never, no, without, don't, scrap).",
        span,
        criterionId,
        questionId,
      );
    }
    if (normalizeQuoteForMatch(slice) !== normalizeQuoteForMatch(span.quote)) {
      return result(
        false,
        "quote_mismatch",
        "Quote does not match the turn span after whitespace and punctuation normalization.",
        span,
        criterionId,
        questionId,
      );
    }
    if (governingNegationDropped(turn.text, span.start, span.end)) {
      return result(
        false,
        "negation_dropped",
        "The span drops a governing negation that sits earlier in the same sentence.",
        span,
        criterionId,
        questionId,
      );
    }
    return result(true, "accepted", "Span matches.", span, criterionId, questionId);
  }

  private checkMeaning(
    spans: readonly EvidenceSpan[],
    context: QuoteCheckContext,
    criterionId: string | null,
    questionId: string | null,
  ): QuoteValidationResult | null {
    const head = spans[0];
    if (!head) return null;
    const quotes = spans.map((span) => span.quote);
    const basis: SettledBasis | null = context.basis ?? null;
    const settling = basis === "explicit" || basis === "derived";

    if (quotes.some((quote) => isInjectionQuote(quote))) {
      return result(
        false,
        "injection_not_evidence",
        "Instructional text inside a transcript cannot authorize a credit.",
        head,
        criterionId,
        questionId,
      );
    }

    if (context.activeCriteria && criterionId && !context.activeCriteria.includes(criterionId)) {
      return result(
        false,
        "unknown_criterion",
        `Criterion ${criterionId} is not on the active list.`,
        head,
        criterionId,
        questionId,
      );
    }
    if (context.activeQuestions && questionId && !context.activeQuestions.includes(questionId)) {
      return result(
        false,
        "unknown_question",
        `Question ${questionId} is not on the active list.`,
        head,
        criterionId,
        questionId,
      );
    }

    const positional = quotes.some((quote) => isPositionalAcceptance(quote));
    if (positional) {
      const binding = context.binding ?? null;
      if (!binding || binding.turnId !== head.turn || (questionId !== null && binding.questionId !== questionId)) {
        return result(
          false,
          "positional_unbound",
          "A direct reply such as \"yes\" or \"use the second one\" needs a bound developer turn.",
          head,
          criterionId,
          questionId,
        );
      }
      if (binding.optionsVersionAtInputStart !== binding.replyOptionsVersion) {
        return result(
          false,
          "stale_options_version",
          "options_version at acceptance does not match the options shown at input start.",
          head,
          criterionId,
          questionId,
        );
      }
    }

    if (basis === "explicit" && quotes.some((quote) => isUncertaintyStatement(quote))) {
      return result(
        false,
        "uncertainty_not_explicit",
        "\"I don't know\" invites a recommendation. It is not explicit evidence.",
        head,
        criterionId,
        questionId,
      );
    }

    if (basis === "explicit" && context.value && context.recommended && context.recommended.length > 0) {
      const matched = context.recommended.find(
        (option) => option.id === context.value || option.label.toLowerCase() === context.value?.toLowerCase(),
      );
      const acceptedByReply =
        positional &&
        context.binding !== null &&
        context.binding !== undefined &&
        context.binding.optionsVersionAtInputStart === context.binding.replyOptionsVersion;
      const quoteStatesLabel =
        matched !== undefined &&
        quotes.some((quote) => normalizeQuoteForMatch(quote).includes(normalizeQuoteForMatch(matched.label)));
      if (matched && !acceptedByReply && !quoteStatesLabel) {
        return result(
          false,
          "recommendation_not_evidence",
          "A recommended option is not explicit evidence until the developer accepts it.",
          head,
          criterionId,
          questionId,
        );
      }
    }

    if (settling && context.value && quotes.some((quote) => negationGovernsValue(quote, context.value ?? ""))) {
      return result(
        false,
        "negation_blocks_value",
        "A negation governs the proposed value, so the span does not establish it.",
        head,
        criterionId,
        questionId,
      );
    }

    if (
      settling &&
      criterionId &&
      quotes.some((quote) => phoneClaimIsBroadened(quote, criterionId, context.value ?? null))
    ) {
      return result(
        false,
        "broadened_inference",
        "Opening a link on a phone does not establish offline support, a native app, or phone checkout.",
        head,
        criterionId,
        questionId,
      );
    }
    if (
      settling &&
      criterionId &&
      quotes.every((quote) => quoteIsPhoneLinkOnly(quote)) &&
      !isMenuPhoneCriterion(criterionId, context.value ?? null)
    ) {
      return result(
        false,
        "broadened_inference",
        "A phone-link quote only covers opening the menu on a phone browser.",
        head,
        criterionId,
        questionId,
      );
    }

    if (
      settling &&
      criterionId &&
      criterionId.toLowerCase().includes("recipient") &&
      !quotes.some((quote) => quoteNamesRecipient(quote)) &&
      quotes.every((quote) => isEmailChannelQuote(quote) || !quoteNamesRecipient(quote))
    ) {
      return result(
        false,
        "recipient_not_established",
        "\"Email the totals\" settles the channel and leaves the recipient missing.",
        head,
        criterionId,
        questionId,
      );
    }

    if (
      basis === "explicit" &&
      context.value &&
      context.repoBaselineValue &&
      context.value === context.repoBaselineValue &&
      !quotes.some((quote) => userConfirmsBaseline(quote))
    ) {
      return result(
        false,
        "baseline_is_not_a_requirement",
        "Repository behavior is the baseline. A mismatch stays a planned change until the developer confirms it.",
        head,
        criterionId,
        questionId,
      );
    }

    return null;
  }
}
