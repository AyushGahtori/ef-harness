import type { DocumentLocator, OcrBlock } from "./types.js";

export class DocumentLocatorParseError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join("; "));
    this.name = "DocumentLocatorParseError";
    this.issues = issues;
  }
}

type ParseResult =
  | { readonly success: true; readonly data: DocumentLocator }
  | { readonly success: false; readonly error: DocumentLocatorParseError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInt(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInt(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function bbox(value: unknown, issues: string[], label: string): readonly [number, number, number, number] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 4 || !value.every(isFiniteNumber)) {
    issues.push(`${label} must be [x, y, w, h]`);
    return undefined;
  }
  const [x, y, w, h] = value;
  if (x === undefined || y === undefined || w === undefined || h === undefined) {
    issues.push(`${label} must be [x, y, w, h]`);
    return undefined;
  }
  return [x, y, w, h];
}

function parseOcrBlocks(value: unknown, issues: string[]): OcrBlock[] {
  if (!Array.isArray(value)) {
    issues.push("ocrBlocks must be an array");
    return [];
  }
  const blocks: OcrBlock[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.text !== "string" || !isFiniteNumber(entry.confidence)) {
      issues.push("ocrBlocks entries must include text and confidence");
      continue;
    }
    const box = bbox(entry.bbox, issues, "ocrBlocks.bbox");
    if (!box) {
      issues.push("ocrBlocks.bbox is required");
      continue;
    }
    blocks.push({ text: entry.text, confidence: entry.confidence, bbox: box });
  }
  return blocks;
}

function parseLocator(value: unknown): DocumentLocator {
  const issues: string[] = [];
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new DocumentLocatorParseError(["locator.type is required"]);
  }
  switch (value.type) {
    case "pdf": {
      if (!isPositiveInt(value.page)) issues.push("pdf.page must be a positive integer");
      if (!isPositiveInt(value.lineStart)) issues.push("pdf.lineStart must be a positive integer");
      if (!isPositiveInt(value.lineEnd)) issues.push("pdf.lineEnd must be a positive integer");
      const box = bbox(value.bbox, issues, "pdf.bbox");
      if (issues.length > 0) throw new DocumentLocatorParseError(issues);
      const locator: DocumentLocator = {
        type: "pdf",
        page: value.page as number,
        lineStart: value.lineStart as number,
        lineEnd: value.lineEnd as number,
        ...(box ? { bbox: box } : {}),
      };
      return locator;
    }
    case "pdf_ocr": {
      if (!isPositiveInt(value.page)) issues.push("pdf_ocr.page must be a positive integer");
      const box = bbox(value.bbox, issues, "pdf_ocr.bbox");
      if (value.confidence !== undefined && !isFiniteNumber(value.confidence)) {
        issues.push("pdf_ocr.confidence must be a finite number");
      }
      if (issues.length > 0) throw new DocumentLocatorParseError(issues);
      const locator: DocumentLocator = {
        type: "pdf_ocr",
        page: value.page as number,
        ...(isFiniteNumber(value.confidence) ? { confidence: value.confidence } : {}),
        ...(box ? { bbox: box } : {}),
      };
      return locator;
    }
    case "docx": {
      if (typeof value.sectionHeading !== "string") issues.push("docx.sectionHeading must be a string");
      if (!isPositiveInt(value.paragraphIndex)) issues.push("docx.paragraphIndex must be a positive integer");
      let tableCell: readonly [number, number] | undefined;
      if (value.tableCell !== undefined) {
        if (
          !Array.isArray(value.tableCell) ||
          value.tableCell.length !== 2 ||
          !isNonNegativeInt(value.tableCell[0]) ||
          !isNonNegativeInt(value.tableCell[1])
        ) {
          issues.push("docx.tableCell must be [row, col]");
        } else {
          const row = value.tableCell[0];
          const col = value.tableCell[1];
          if (row === undefined || col === undefined) {
            issues.push("docx.tableCell must be [row, col]");
          } else {
            tableCell = [row, col];
          }
        }
      }
      if (issues.length > 0 || typeof value.sectionHeading !== "string" || !isPositiveInt(value.paragraphIndex)) {
        throw new DocumentLocatorParseError(issues);
      }
      const locator: DocumentLocator = {
        type: "docx",
        sectionHeading: value.sectionHeading,
        paragraphIndex: value.paragraphIndex,
        ...(tableCell ? { tableCell } : {}),
      };
      return locator;
    }
    case "markdown":
    case "html": {
      if (typeof value.filePath !== "string" || value.filePath.length === 0) {
        issues.push(`${value.type}.filePath must be a non-empty string`);
      }
      if (!Array.isArray(value.headingPath) || !value.headingPath.every((item) => typeof item === "string")) {
        issues.push(`${value.type}.headingPath must be a string array`);
      }
      if (!isPositiveInt(value.lineStart)) issues.push(`${value.type}.lineStart must be a positive integer`);
      if (!isPositiveInt(value.lineEnd)) issues.push(`${value.type}.lineEnd must be a positive integer`);
      if (
        issues.length > 0 ||
        typeof value.filePath !== "string" ||
        !Array.isArray(value.headingPath) ||
        !isPositiveInt(value.lineStart) ||
        !isPositiveInt(value.lineEnd)
      ) {
        throw new DocumentLocatorParseError(issues);
      }
      const headingPath = value.headingPath.filter((item): item is string => typeof item === "string");
      const locator: DocumentLocator = {
        type: value.type,
        filePath: value.filePath,
        headingPath,
        lineStart: value.lineStart,
        lineEnd: value.lineEnd,
      };
      return locator;
    }
    case "csv": {
      if (!Array.isArray(value.headerColumns) || !value.headerColumns.every((item) => typeof item === "string")) {
        issues.push("csv.headerColumns must be a string array");
      }
      if (!isPositiveInt(value.rowStart)) issues.push("csv.rowStart must be a positive integer");
      if (!isPositiveInt(value.rowEnd)) issues.push("csv.rowEnd must be a positive integer");
      if (value.sheet !== undefined && typeof value.sheet !== "string") issues.push("csv.sheet must be a string");
      if (
        issues.length > 0 ||
        !Array.isArray(value.headerColumns) ||
        !isPositiveInt(value.rowStart) ||
        !isPositiveInt(value.rowEnd)
      ) {
        throw new DocumentLocatorParseError(issues);
      }
      const headerColumns = value.headerColumns.filter((item): item is string => typeof item === "string");
      const locator: DocumentLocator = {
        type: "csv",
        headerColumns,
        rowStart: value.rowStart,
        rowEnd: value.rowEnd,
        ...(typeof value.sheet === "string" ? { sheet: value.sheet } : {}),
      };
      return locator;
    }
    case "image": {
      if (!isPositiveInt(value.width) && !(isFiniteNumber(value.width) && value.width > 0)) {
        issues.push("image.width must be a positive number");
      }
      if (!isFiniteNumber(value.height) || value.height <= 0) issues.push("image.height must be a positive number");
      const ocrBlocks = parseOcrBlocks(value.ocrBlocks, issues);
      if (value.visionSummaryRef !== undefined && typeof value.visionSummaryRef !== "string") {
        issues.push("image.visionSummaryRef must be a string");
      }
      if (issues.length > 0 || !isFiniteNumber(value.width) || !isFiniteNumber(value.height)) {
        throw new DocumentLocatorParseError(issues);
      }
      const locator: DocumentLocator = {
        type: "image",
        width: value.width,
        height: value.height,
        ocrBlocks,
        ...(typeof value.visionSummaryRef === "string" ? { visionSummaryRef: value.visionSummaryRef } : {}),
      };
      return locator;
    }
    default:
      throw new DocumentLocatorParseError([`unsupported locator type ${value.type}`]);
  }
}

export const DocumentLocatorSchema = {
  parse(value: unknown): DocumentLocator {
    return parseLocator(value);
  },
  safeParse(value: unknown): ParseResult {
    try {
      return { success: true, data: parseLocator(value) };
    } catch (error) {
      if (error instanceof DocumentLocatorParseError) {
        return { success: false, error };
      }
      throw error;
    }
  },
};
