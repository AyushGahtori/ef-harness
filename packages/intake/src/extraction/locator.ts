import type { EvidenceLocator } from "@ef-harness/shared-contracts";
import { parseEvidenceLocator } from "../evidence-locator.js";
import type { IntakeLocator, NormalizedBlock, NormalizedDocument } from "./types.js";

export function formatDocumentLocator(
  sourceName: string,
  loc: { readonly page: number | null; readonly paragraph: number | null; readonly section: string | null },
): string {
  const page = loc.page ?? 1;
  if (loc.section) return `${sourceName} p.${page} §${loc.section}`;
  if (loc.paragraph) return `${sourceName} p.${page} ¶${loc.paragraph}`;
  return `${sourceName} p.${page}`;
}

export function charRangeOf(locator: IntakeLocator): { readonly start: number; readonly end: number } | null {
  if (locator.kind === "pdf" || locator.kind === "docx" || locator.kind === "text") {
    return { start: locator.char_start, end: locator.char_end };
  }
  return null;
}

export function blockCovering(
  document: NormalizedDocument,
  start: number,
  end: number,
): NormalizedBlock | null {
  for (const block of document.blocks) {
    if (block.kind === "page_break") continue;
    if (block.charStart <= start && end <= block.charEnd) return block;
  }
  return null;
}

export function locateQuote(
  document: NormalizedDocument,
  quote: string,
): {
  readonly charStart: number;
  readonly charEnd: number;
  readonly page: number;
  readonly paragraph: number | null;
  readonly section: string | null;
  readonly line: number;
  readonly label: string;
  readonly blockId: string;
} {
  const start = document.text.indexOf(quote);
  if (start < 0) {
    throw new Error(`Quote is not in ${document.sourceName}.`);
  }
  const end = start + quote.length;
  const block = blockCovering(document, start, end);
  if (!block) {
    throw new Error(`Quote in ${document.sourceName} is not inside one block.`);
  }
  return {
    charStart: start,
    charEnd: end,
    page: block.page,
    paragraph: block.paragraph,
    section: block.section,
    line: block.line,
    blockId: block.id,
    label: formatDocumentLocator(document.sourceName, {
      page: block.page,
      paragraph: block.paragraph,
      section: block.section,
    }),
  };
}

export function pdfLocator(
  located: { readonly page: number; readonly charStart: number; readonly charEnd: number; readonly paragraph: number | null; readonly section: string | null },
): IntakeLocator {
  const base = {
    kind: "pdf" as const,
    page: located.page,
    char_start: located.charStart,
    char_end: located.charEnd,
  };
  if (located.paragraph !== null && located.section) {
    return { ...base, paragraph: located.paragraph, section: located.section };
  }
  if (located.paragraph !== null) return { ...base, paragraph: located.paragraph };
  if (located.section) return { ...base, section: located.section };
  return base;
}

export function claimEvidenceLocator(
  document: NormalizedDocument,
  claim: {
    readonly charStart: number;
    readonly charEnd: number;
    readonly pages: readonly number[];
    readonly paragraph: number | null;
  },
): EvidenceLocator {
  const charStart = claim.charStart;
  const charEnd = claim.charEnd < claim.charStart ? claim.charStart : claim.charEnd;
  const mime = document.mimeType.toLowerCase();
  if ((mime.includes("docx") || mime.includes("wordprocessingml")) && claim.paragraph !== null && claim.paragraph >= 1) {
    return parseEvidenceLocator({
      kind: "docx",
      paragraph: claim.paragraph,
      charStart,
      charEnd,
    });
  }
  const page = claim.pages.find((value) => Number.isInteger(value) && value >= 1) ?? 1;
  return parseEvidenceLocator({ kind: "pdf", page, charStart, charEnd });
}
