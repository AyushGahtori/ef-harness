import { toPrefixedSha256, type EvidenceLocator, type Sha256Prefixed } from "@ef-harness/shared-contracts";
import type { DocumentLocator, NormalizedBlock as ConverterBlock, NormalizedDocument as ConverterDocument } from "./converters/types.js";
import { parseEvidenceLocator } from "./evidence-locator.js";
import type { BlockKind, NormalizedBlock as ExtractionBlock, NormalizedDocument as ExtractionDocument } from "./extraction/types.js";

/**
 * One document shape produced by `SandboxedDocumentConverter` and consumed by
 * `IntakeSemanticChunker` and `ExactSchemaImporter`.
 */
export interface NormalizedSection {
  readonly id: string;
  readonly kind: BlockKind;
  readonly text: string;
  readonly charStart: number;
  readonly charEnd: number;
  readonly page: number;
  readonly paragraph: number | null;
  readonly line: number;
  readonly level: number | null;
  readonly section: string | null;
  readonly locator: EvidenceLocator;
}

export interface NormalizedDocument {
  readonly docId: string;
  readonly sourcePath: string;
  readonly mimeType: string;
  readonly rawCasSha256: Sha256Prefixed;
  readonly sections: readonly NormalizedSection[];
  readonly strippedHiddenSpansCount: number;
  readonly warnings: readonly string[];
  readonly text: string;
  readonly ocrDerived: boolean;
  readonly pageCount: number;
}

export function publishNormalizedDocument(document: ConverterDocument): NormalizedDocument {
  const rawCasSha256 = toPrefixedSha256(document.sourceHash);
  const sections = document.blocks.map((block, index) => sectionFromBlock(block, index));
  const pageCount = document.stats.pageCount ?? sections.reduce((max, section) => Math.max(max, section.page), 1);
  return {
    docId: document.sourceHash,
    sourcePath: document.fileName,
    mimeType: document.mediaType,
    rawCasSha256,
    sections,
    strippedHiddenSpansCount: document.warnings.filter((warning) => warning.code === "hidden_text_detected").length,
    warnings: document.warnings.map((warning) => `${warning.code}: ${warning.message}`),
    text: document.text,
    ocrDerived: document.ocrDerived,
    pageCount: pageCount > 0 ? pageCount : 1,
  };
}

export function extractionDocumentFrom(document: NormalizedDocument): ExtractionDocument {
  return {
    sourceId: document.docId,
    sourceName: document.sourcePath,
    sourceHash: document.rawCasSha256,
    mimeType: document.mimeType,
    pageCount: document.pageCount,
    text: document.text,
    blocks: document.sections.map((section) => extractionBlock(section)),
    ocrDerived: document.ocrDerived,
  };
}

function extractionBlock(section: NormalizedSection): ExtractionBlock {
  return {
    id: section.id,
    kind: section.kind,
    level: section.level,
    text: section.text,
    page: section.page,
    paragraph: section.paragraph,
    line: section.line,
    section: section.section,
    charStart: section.charStart,
    charEnd: section.charEnd,
  };
}

function sectionFromBlock(block: ConverterBlock, index: number): NormalizedSection {
  const placed = placement(block.locator);
  return {
    id: block.id || `b${index + 1}`,
    kind: extractionKind(block.kind),
    text: block.text,
    charStart: block.charStart,
    charEnd: block.charEnd >= block.charStart ? block.charEnd : block.charStart,
    page: placed.page,
    paragraph: placed.paragraph,
    line: placed.line,
    level: block.kind === "heading" ? 1 : null,
    section: placed.section,
    locator: evidenceLocator(block, placed.page),
  };
}

function extractionKind(kind: ConverterBlock["kind"]): BlockKind {
  switch (kind) {
    case "heading":
      return "heading";
    case "list_item":
      return "list";
    case "table_cell":
      return "table";
    case "paragraph":
    case "figure":
    case "schema":
      return "paragraph";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function placement(locator: DocumentLocator): {
  readonly page: number;
  readonly paragraph: number | null;
  readonly line: number;
  readonly section: string | null;
} {
  switch (locator.type) {
    case "pdf":
      return { page: locator.page, paragraph: locator.lineStart, line: locator.lineStart, section: null };
    case "pdf_ocr":
      return { page: locator.page, paragraph: null, line: 1, section: null };
    case "docx":
      return {
        page: 1,
        paragraph: locator.paragraphIndex,
        line: locator.paragraphIndex,
        section: locator.sectionHeading.length > 0 ? locator.sectionHeading : null,
      };
    case "markdown":
    case "html":
      return { page: 1, paragraph: null, line: locator.lineStart, section: null };
    case "csv":
      return { page: 1, paragraph: null, line: locator.rowStart, section: locator.sheet ?? null };
    case "image":
      return { page: 1, paragraph: null, line: 1, section: null };
    default: {
      const unreachable: never = locator;
      return unreachable;
    }
  }
}

function evidenceLocator(block: ConverterBlock, page: number): EvidenceLocator {
  const charStart = block.charStart;
  const charEnd = block.charEnd >= block.charStart ? block.charEnd : block.charStart;
  const locator = block.locator;
  switch (locator.type) {
    case "pdf":
    case "pdf_ocr": {
      const bbox = locator.bbox;
      if (bbox && bbox[2] > 0 && bbox[3] > 0) {
        return parseEvidenceLocator({ kind: "pdf", page, charStart, charEnd, bbox });
      }
      return parseEvidenceLocator({ kind: "pdf", page, charStart, charEnd });
    }
    case "docx":
      return parseEvidenceLocator({
        kind: "docx",
        paragraph: Math.max(1, locator.paragraphIndex),
        charStart,
        charEnd,
      });
    case "markdown":
    case "html":
      return parseEvidenceLocator({
        kind: "text",
        lineStart: Math.max(1, locator.lineStart),
        lineEnd: Math.max(Math.max(1, locator.lineStart), locator.lineEnd),
        charStart,
        charEnd,
      });
    case "csv":
      return parseEvidenceLocator({
        kind: "text",
        lineStart: Math.max(1, locator.rowStart),
        lineEnd: Math.max(Math.max(1, locator.rowStart), locator.rowEnd),
        charStart,
        charEnd,
      });
    case "image": {
      const width = locator.width > 0 ? locator.width : 1;
      const height = locator.height > 0 ? locator.height : 1;
      const region = locator.ocrBlocks[0]?.bbox;
      const box = region && region[2] > 0 && region[3] > 0 ? region : ([0, 0, width, height] as const);
      const ocrText = locator.ocrBlocks.map((item) => item.text).join(" ").trim();
      if (ocrText.length > 0) {
        return parseEvidenceLocator({ kind: "image", region: box, ocrText });
      }
      return parseEvidenceLocator({ kind: "image", region: box });
    }
    default: {
      const unreachable: never = locator;
      return unreachable;
    }
  }
}
