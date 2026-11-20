import { blockCovering, charRangeOf, formatDocumentLocator } from "./locator.js";
import {
  extractCurrencySymbols,
  extractDigitRuns,
  extractNegationTokens,
  isInjectionText,
  sameMultiset,
} from "./text-rules.js";
import type { IntakeLocator, NormalizedDocument, QuoteDecisionCode, QuoteValidationResult } from "./types.js";

function result(
  accepted: boolean,
  code: QuoteDecisionCode,
  message: string,
  quote: string,
  locatorLabel: string,
): QuoteValidationResult {
  return { accepted, code, message, quote, locatorLabel };
}

/**
 * Document-span port of Task 070 `ExactQuoteEvidenceVerifier`.
 * A quote earns credit only when `[char_start, char_end)` is verbatim in the
 * NormalizedDocument and digits, currency, and negation tokens are unchanged.
 */
export class ExactQuoteEvidenceVerifier {
  verifyDocumentQuote(
    document: NormalizedDocument,
    quote: string,
    locator: IntakeLocator,
  ): QuoteValidationResult {
    const label = this.labelFor(document, locator);
    if (isInjectionText(quote)) {
      return result(
        false,
        "injection_not_evidence",
        "Text addressed to an AI or tool is not evidence about the product.",
        quote,
        label,
      );
    }
    if (locator.kind === "image") {
      if (locator.ocr_text !== null && locator.ocr_text.normalize("NFC") === quote.normalize("NFC")) {
        return result(true, "accepted", "OCR text matches the quoted region.", quote, label);
      }
      return result(false, "quote_mismatch", "Image quote does not match the OCR text.", quote, label);
    }
    if (locator.kind === "spec") {
      if (!locator.pointer.startsWith("/")) {
        return result(false, "locator_mismatch", "Spec locator must be a JSON pointer.", quote, label);
      }
      if (!document.text.includes(quote)) {
        return result(false, "quote_mismatch", "Spec quote is not in the normalized document.", quote, label);
      }
      return result(true, "accepted", "Spec quote is present and the pointer is well formed.", quote, label);
    }
    const range = charRangeOf(locator);
    if (!range) {
      return result(false, "locator_mismatch", "Locator has no character range.", quote, label);
    }
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end <= range.start ||
      range.end > document.text.length
    ) {
      return result(false, "out_of_bounds", "Span [char_start, char_end) is outside the document.", quote, label);
    }
    const slice = document.text.slice(range.start, range.end);
    if (!sameMultiset(extractDigitRuns(slice), extractDigitRuns(quote))) {
      return result(
        false,
        "digit_altered",
        "Quote digits do not match the document. Digits such as 10:00 and 11:00 are never normalized away.",
        quote,
        label,
      );
    }
    if (!sameMultiset(extractCurrencySymbols(slice), extractCurrencySymbols(quote))) {
      return result(false, "currency_altered", "Quote currency symbols do not match the document.", quote, label);
    }
    if (!sameMultiset(extractNegationTokens(slice), extractNegationTokens(quote))) {
      return result(
        false,
        "negation_dropped",
        "Quote dropped or invented a negation token (not, never, no, without, don't, scrap).",
        quote,
        label,
      );
    }
    if (slice.normalize("NFC") !== quote.normalize("NFC")) {
      return result(false, "quote_mismatch", "Quote is not a verbatim span of the normalized document.", quote, label);
    }
    const block = blockCovering(document, range.start, range.end);
    if (!block) {
      return result(false, "locator_mismatch", "Character span is not inside a document block.", quote, label);
    }
    if (locator.kind === "pdf" && locator.page !== block.page) {
      return result(false, "locator_mismatch", "PDF page does not match the block that owns the span.", quote, label);
    }
    if (locator.kind === "pdf" && locator.paragraph !== undefined && locator.paragraph !== block.paragraph) {
      return result(false, "locator_mismatch", "Paragraph number does not match the block that owns the span.", quote, label);
    }
    if (locator.kind === "docx" && locator.paragraph !== block.paragraph) {
      return result(false, "locator_mismatch", "DOCX paragraph does not match the block that owns the span.", quote, label);
    }
    return result(true, "accepted", "Quote span matches the normalized document.", quote, label);
  }

  private labelFor(document: NormalizedDocument, locator: IntakeLocator): string {
    if (locator.kind === "pdf") {
      return formatDocumentLocator(document.sourceName, {
        page: locator.page,
        paragraph: locator.paragraph ?? null,
        section: locator.section ?? null,
      });
    }
    if (locator.kind === "docx") {
      return `${document.sourceName} ¶${locator.paragraph}`;
    }
    if (locator.kind === "text") {
      return `${document.sourceName} L${locator.line_start}`;
    }
    if (locator.kind === "spec") return `${document.sourceName} ${locator.pointer}`;
    return `${document.sourceName} image`;
  }
}
