import { createHash } from "node:crypto";
import type { NormalizedBlock, NormalizedDocument } from "./types.js";

export interface AssembledParagraph {
  readonly text: string;
  readonly page?: number;
}

export interface AssembledSection {
  readonly heading: string;
  readonly level?: number;
  readonly page: number;
  readonly endPage?: number;
  readonly section?: string;
  readonly paragraphs: readonly (string | AssembledParagraph)[];
  readonly tables?: readonly string[];
}

export interface AssembleInput {
  readonly sourceId?: string;
  readonly sourceName: string;
  readonly sourceHash?: string;
  readonly mimeType?: string;
  readonly pageCount: number;
  readonly ocrDerived?: boolean;
  readonly sections: readonly AssembledSection[];
}

function paragraphText(value: string | AssembledParagraph): string {
  return typeof value === "string" ? value : value.text;
}

function paragraphPage(value: string | AssembledParagraph, fallback: number): number {
  return typeof value === "string" ? fallback : (value.page ?? fallback);
}

/**
 * Builds a NormalizedDocument whose block offsets match `text` exactly.
 * This is the local stand-in for a Task 097 converter result.
 */
export function assembleNormalizedDocument(input: AssembleInput): NormalizedDocument {
  const blocks: NormalizedBlock[] = [];
  const pieces: string[] = [];
  let cursor = 0;
  let line = 1;
  let serial = 0;
  let paragraphOnPage = 0;
  let lastParagraphPage = 0;

  const push = (
    text: string,
    partial: Omit<NormalizedBlock, "id" | "text" | "charStart" | "charEnd" | "line">,
  ): void => {
    if (pieces.length > 0) {
      pieces.push("\n");
      cursor += 1;
      line += 1;
    }
    const start = cursor;
    pieces.push(text);
    cursor += text.length;
    serial += 1;
    blocks.push({
      id: `b${serial}`,
      text,
      charStart: start,
      charEnd: start + text.length,
      ...partial,
      line,
    });
  };

  const markPageBreak = (page: number, section: string | null): void => {
    serial += 1;
    blocks.push({
      id: `b${serial}`,
      kind: "page_break",
      level: null,
      text: "",
      page,
      paragraph: null,
      line,
      section,
      charStart: cursor,
      charEnd: cursor,
    });
  };

  for (const section of input.sections) {
    const sectionLabel = section.section ?? null;
    const level = section.level ?? 1;
    push(section.heading, {
      kind: "heading",
      level,
      page: section.page,
      paragraph: null,
      section: sectionLabel,
    });
    const body = section.paragraphs.length > 0 ? section.paragraphs : [];
    const lastIndex = body.length - 1;
    body.forEach((paragraph, index) => {
      const page =
        section.endPage !== undefined && index === lastIndex ? section.endPage : paragraphPage(paragraph, section.page);
      if (lastParagraphPage !== 0 && page !== lastParagraphPage) {
        markPageBreak(page, sectionLabel);
      }
      if (page !== lastParagraphPage) {
        paragraphOnPage = 0;
        lastParagraphPage = page;
      }
      paragraphOnPage += 1;
      push(paragraphText(paragraph), {
        kind: "paragraph",
        level: null,
        page,
        paragraph: paragraphOnPage,
        section: sectionLabel,
      });
    });
    for (const table of section.tables ?? []) {
      push(table, {
        kind: "table",
        level: null,
        page: section.endPage ?? section.page,
        paragraph: null,
        section: sectionLabel,
      });
    }
  }

  const text = pieces.join("");
  const digest = createHash("sha256").update(text).digest("hex");
  return {
    sourceId: input.sourceId ?? "SRC-1",
    sourceName: input.sourceName,
    sourceHash: input.sourceHash ?? `sha256:${digest}`,
    mimeType: input.mimeType ?? "application/pdf",
    pageCount: input.pageCount,
    text,
    blocks,
    ocrDerived: input.ocrDerived ?? false,
  };
}
