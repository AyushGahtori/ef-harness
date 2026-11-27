import { isRecord, type BlockedExit, type IntakeExtractorV1, type IntakeLocator, type IntakeStatement, type StatementKind } from "./types.js";

const STATEMENT_KINDS = new Set<StatementKind>(["decision", "requirement", "entity", "rule", "question"]);

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function integerAtLeast(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}

function parseLocator(value: unknown): IntakeLocator | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "pdf") {
    if (!onlyKeys(value, ["kind", "page", "char_start", "char_end", "paragraph", "section"])) return null;
    if (!integerAtLeast(value.page, 1) || !integerAtLeast(value.char_start, 0) || !integerAtLeast(value.char_end, 1)) {
      return null;
    }
    if (value.char_end <= value.char_start) return null;
    const locator: {
      kind: "pdf";
      page: number;
      char_start: number;
      char_end: number;
      paragraph?: number;
      section?: string;
    } = {
      kind: "pdf",
      page: value.page,
      char_start: value.char_start,
      char_end: value.char_end,
    };
    if (value.paragraph !== undefined) {
      if (!integerAtLeast(value.paragraph, 1)) return null;
      locator.paragraph = value.paragraph;
    }
    if (value.section !== undefined) {
      if (!nonBlank(value.section)) return null;
      locator.section = value.section;
    }
    return locator;
  }
  if (value.kind === "docx") {
    if (!onlyKeys(value, ["kind", "paragraph", "char_start", "char_end"])) return null;
    if (!integerAtLeast(value.paragraph, 1) || !integerAtLeast(value.char_start, 0) || !integerAtLeast(value.char_end, 1)) {
      return null;
    }
    if (value.char_end <= value.char_start) return null;
    return {
      kind: "docx",
      paragraph: value.paragraph,
      char_start: value.char_start,
      char_end: value.char_end,
    };
  }
  if (value.kind === "text") {
    if (!onlyKeys(value, ["kind", "line_start", "line_end", "char_start", "char_end"])) return null;
    if (
      !integerAtLeast(value.line_start, 1) ||
      !integerAtLeast(value.line_end, 1) ||
      !integerAtLeast(value.char_start, 0) ||
      !integerAtLeast(value.char_end, 1)
    ) {
      return null;
    }
    if (value.line_end < value.line_start || value.char_end <= value.char_start) return null;
    return {
      kind: "text",
      line_start: value.line_start,
      line_end: value.line_end,
      char_start: value.char_start,
      char_end: value.char_end,
    };
  }
  if (value.kind === "image") {
    if (!onlyKeys(value, ["kind", "x", "y", "w", "h", "ocr_text"])) return null;
    if (typeof value.x !== "number" || typeof value.y !== "number" || typeof value.w !== "number" || typeof value.h !== "number") {
      return null;
    }
    if (value.x < 0 || value.y < 0 || value.w <= 0 || value.h <= 0) return null;
    if (value.ocr_text !== null && typeof value.ocr_text !== "string") return null;
    return { kind: "image", x: value.x, y: value.y, w: value.w, h: value.h, ocr_text: value.ocr_text };
  }
  if (value.kind === "spec") {
    if (!onlyKeys(value, ["kind", "pointer"]) || !nonBlank(value.pointer)) return null;
    return { kind: "spec", pointer: value.pointer };
  }
  return null;
}

function parseStatement(value: unknown): IntakeStatement | null {
  if (!isRecord(value) || !onlyKeys(value, ["text", "locator", "kind", "criterion_id", "value"])) return null;
  if (!nonBlank(value.text)) return null;
  if (typeof value.kind !== "string" || !STATEMENT_KINDS.has(value.kind as StatementKind)) return null;
  if (value.criterion_id !== null && (typeof value.criterion_id !== "string" || /\s/.test(value.criterion_id) || !value.criterion_id)) {
    return null;
  }
  if (value.value !== null && !nonBlank(value.value)) return null;
  const locator = parseLocator(value.locator);
  if (!locator) return null;
  return {
    text: value.text,
    locator,
    kind: value.kind as StatementKind,
    criterion_id: value.criterion_id,
    value: value.value,
  };
}

/**
 * Closed parser for `intake-extractor@1`, standing in for Task 009
 * `IntakeExtractorV1Schema` until that export is on the package barrel.
 */
export function parseIntakeExtractorV1(input: unknown): { ok: true; value: IntakeExtractorV1 } | { ok: false; message: string } {
  if (!isRecord(input)) return fail("intake-extractor@1 output must be an object");
  if (input.blocked === true) {
    if (!onlyKeys(input, ["blocked", "reason", "missing_ids"]) || !nonBlank(input.reason)) {
      return fail("blocked exit needs a reason and no other keys");
    }
    const exit: BlockedExit = { blocked: true, reason: input.reason };
    if (input.missing_ids !== undefined) {
      if (!Array.isArray(input.missing_ids) || input.missing_ids.some((item) => typeof item !== "string" || /\s/.test(item) || !item)) {
        return fail("missing_ids must be identifiers");
      }
      return { ok: true, value: { ...exit, missing_ids: input.missing_ids } };
    }
    return { ok: true, value: exit };
  }
  if (!onlyKeys(input, ["statements", "suspicious_instructions"])) {
    return fail("intake-extractor@1 output has unknown keys");
  }
  if (!Array.isArray(input.statements) || !Array.isArray(input.suspicious_instructions)) {
    return fail("statements and suspicious_instructions must be arrays");
  }
  const statements: IntakeStatement[] = [];
  for (const item of input.statements) {
    const statement = parseStatement(item);
    if (!statement) return fail("a statement is outside the closed intake-extractor@1 shape");
    statements.push(statement);
  }
  const suspicious: { text: string; locator: IntakeLocator; reason: string }[] = [];
  for (const item of input.suspicious_instructions) {
    if (!isRecord(item) || !onlyKeys(item, ["text", "locator", "reason"])) {
      return fail("a suspicious instruction is outside the closed shape");
    }
    if (!nonBlank(item.text) || !nonBlank(item.reason)) return fail("suspicious instruction text and reason are required");
    const locator = parseLocator(item.locator);
    if (!locator) return fail("suspicious instruction locator is invalid");
    suspicious.push({ text: item.text, locator, reason: item.reason });
  }
  return { ok: true, value: { statements, suspicious_instructions: suspicious } };
}

export function parseIntakeExtractorJson(text: string): { ok: true; value: IntakeExtractorV1 } | { ok: false; message: string } {
  try {
    return parseIntakeExtractorV1(JSON.parse(text) as unknown);
  } catch {
    return fail("intake-extractor@1 output is not JSON");
  }
}

export function isBlockedExit(value: IntakeExtractorV1): value is BlockedExit {
  return "blocked" in value && value.blocked === true;
}
