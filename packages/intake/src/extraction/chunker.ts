import { assignStructure } from "./outline.js";
import { CHUNK_OVERLAP_TOKENS, CHUNK_TOKEN_MAX, CHUNK_TOKEN_MIN, estimateTokens, HIGH_PAGE_COUNT } from "./tokens.js";
import type {
  ChunkOptions,
  ChunkPlan,
  ChunkResult,
  NormalizedDocument,
  SentenceSpan,
  StructuralChunk,
  TocSection,
} from "./types.js";
import { EM_DASH } from "./types.js";

export class UnknownSectionError extends Error {
  constructor(readonly sectionId: string) {
    super(`Unknown section ${sectionId}.`);
    this.name = "UnknownSectionError";
  }
}

interface Unit {
  readonly sentence: SentenceSpan;
  readonly tokens: number;
  readonly boundaryBefore: boolean;
}

function splitSentences(text: string): { text: string; start: number }[] {
  const results: { text: string; start: number }[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index] ?? "";
    const next = text[index + 1];
    const boundary = ch === "\n" || ((ch === "." || ch === "!" || ch === "?") && (next === undefined || /\s/.test(next)));
    if (!boundary) continue;
    const end = ch === "\n" ? index : index + 1;
    const raw = text.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed) results.push({ text: trimmed, start: start + leading });
    let nextStart = end;
    while (nextStart < text.length && /\s/.test(text[nextStart] ?? "")) nextStart += 1;
    start = nextStart;
    index = nextStart - 1;
  }
  if (start < text.length) {
    const raw = text.slice(start);
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed) results.push({ text: trimmed, start: start + leading });
  }
  return results;
}

function unitsOf(document: NormalizedDocument): Unit[] {
  const structured = assignStructure(document.blocks);
  const units: Unit[] = [];
  let pendingBoundary = false;
  let lastPage: number | null = null;
  for (const item of structured) {
    if (item.block.kind === "page_break") {
      pendingBoundary = true;
      continue;
    }
    if (!item.block.text.trim()) continue;
    const pieces =
      item.block.kind === "heading" || item.block.kind === "table"
        ? [{ text: item.block.text, start: 0 }]
        : splitSentences(item.block.text);
    pieces.forEach((piece, index) => {
      const pageChanged = lastPage !== null && item.block.page !== lastPage;
      const structural = item.block.kind === "heading" || item.block.kind === "table" || pageChanged || pendingBoundary;
      const sentence: SentenceSpan = {
        text: piece.text,
        charStart: item.block.charStart + piece.start,
        charEnd: item.block.charStart + piece.start + piece.text.length,
        page: item.block.page,
        paragraph: item.block.paragraph,
        line: item.block.line,
        section: item.block.section,
        headingPath: item.headingPath,
        blockId: item.block.id,
        blockKind: item.block.kind,
        sectionId: item.sectionId,
        sectionKey: item.sectionKey,
        overlap: false,
      };
      units.push({
        sentence,
        tokens: estimateTokens(piece.text),
        boundaryBefore: index === 0 && structural,
      });
      pendingBoundary = false;
      lastPage = item.block.page;
    });
  }
  return units;
}

function buildToc(document: NormalizedDocument, units: readonly Unit[]): TocSection[] {
  const groups = new Map<string, Unit[]>();
  const order: string[] = [];
  for (const unit of units) {
    const id = unit.sentence.sectionId;
    if (id === "0") continue;
    const existing = groups.get(id);
    if (!existing) {
      groups.set(id, [unit]);
      order.push(id);
    } else {
      existing.push(unit);
    }
  }
  return order.map((id) => {
    const group = groups.get(id) ?? [];
    const headingUnit = group.find((unit) => unit.sentence.blockKind === "heading") ?? group[0];
    const pages = group.map((unit) => unit.sentence.page);
    const pageStart = pages.length > 0 ? Math.min(...pages) : 1;
    const pageEnd = pages.length > 0 ? Math.max(...pages) : pageStart;
    return {
      id,
      heading: headingUnit?.sentence.text ?? document.sourceName,
      headingPath: headingUnit?.sentence.headingPath ?? [],
      pageStart,
      pageEnd,
      pageCount: pageEnd - pageStart + 1,
      tokenCount: group.reduce((sum, unit) => sum + unit.tokens, 0),
    };
  });
}

function pack(units: readonly Unit[]): Unit[][] {
  const groups: Unit[][] = [];
  let buffer: Unit[] = [];
  let tokens = 0;
  const flush = (): void => {
    if (buffer.length === 0) return;
    groups.push(buffer);
    buffer = [];
    tokens = 0;
  };
  for (const unit of units) {
    if (tokens > 0 && unit.boundaryBefore && tokens >= CHUNK_TOKEN_MIN) flush();
    if (tokens > 0 && tokens + unit.tokens > CHUNK_TOKEN_MAX) flush();
    buffer.push(unit);
    tokens += unit.tokens;
  }
  flush();
  return groups;
}

function overlapTail(previous: readonly SentenceSpan[]): SentenceSpan[] {
  const chosen: SentenceSpan[] = [];
  let tokens = 0;
  for (let index = previous.length - 1; index >= 0; index -= 1) {
    const sentence = previous[index];
    if (!sentence || sentence.overlap) continue;
    const cost = estimateTokens(sentence.text);
    if (tokens + cost > CHUNK_OVERLAP_TOKENS) break;
    chosen.push({ ...sentence, overlap: true });
    tokens += cost;
  }
  return chosen.reverse();
}

function toChunk(group: readonly Unit[], index: number, overlap: readonly SentenceSpan[]): StructuralChunk {
  const primary = group.map((unit) => unit.sentence);
  const sentences = [...overlap, ...primary];
  const headingPaths = primary.map((sentence) => sentence.headingPath);
  const pages = primary.map((sentence) => sentence.page);
  const sectionIds = [...new Set(primary.map((sentence) => sentence.sectionId))];
  return {
    id: `chunk-${index + 1}`,
    index,
    headingPath: primary[0]?.headingPath ?? [],
    headingPaths,
    tokenCount: primary.reduce((sum, sentence) => sum + estimateTokens(sentence.text), 0),
    overlapTokenCount: overlap.reduce((sum, sentence) => sum + estimateTokens(sentence.text), 0),
    sentences,
    text: sentences.map((sentence) => sentence.text).join("\n"),
    primaryText: primary.map((sentence) => sentence.text).join("\n"),
    pageStart: pages.length > 0 ? Math.min(...pages) : 1,
    pageEnd: pages.length > 0 ? Math.max(...pages) : 1,
    sectionIds,
  };
}

/**
 * Splits a normalized document on headings, page breaks, and tables into
 * 2,000–4,000 token chunks with a 200-token overlap and exact locators.
 */
export class StructuralDocumentChunker {
  plan(document: NormalizedDocument): ChunkPlan {
    const toc = buildToc(document, unitsOf(document));
    const requires = document.pageCount >= HIGH_PAGE_COUNT;
    const message = requires
      ? `${document.sourceName} is ${document.pageCount} pages. Choose sections before extraction.`
      : `${document.sourceName} can be extracted in full.`;
    return { requiresSectionSelection: requires, pageCount: document.pageCount, toc, message };
  }

  formatSelection(document: NormalizedDocument, sectionIds: readonly string[]): string {
    const plan = this.plan(document);
    const chosen = sectionIds.map((id) => {
      const section = plan.toc.find((item) => item.id === id);
      if (!section) throw new UnknownSectionError(id);
      return section;
    });
    const pages = chosen.reduce((sum, section) => sum + section.pageCount, 0);
    return `Sections ${chosen.map((section) => section.id).join(", ")} ${EM_DASH} ~${pages} pages`;
  }

  chunk(document: NormalizedDocument, options: ChunkOptions = {}): ChunkResult {
    const plan = this.plan(document);
    const selectedIds = options.sectionIds;
    const selectedKeys = options.sectionKeys;
    if (plan.requiresSectionSelection && selectedIds === undefined && selectedKeys === undefined) {
      return { status: "needs_selection", plan, chunks: [] };
    }
    if (selectedIds) {
      for (const id of selectedIds) {
        if (!plan.toc.some((section) => section.id === id)) throw new UnknownSectionError(id);
      }
    }
    let units = unitsOf(document);
    if (selectedIds) {
      const allowed = new Set(selectedIds);
      units = units.filter((unit) => allowed.has(unit.sentence.sectionId));
    }
    if (selectedKeys) {
      const allowed = new Set(selectedKeys);
      units = units.filter((unit) => allowed.has(unit.sentence.sectionKey));
    }
    const groups = pack(units);
    const chunks: StructuralChunk[] = [];
    let previousPrimary: SentenceSpan[] = [];
    groups.forEach((group, index) => {
      const overlap = index === 0 ? [] : overlapTail(previousPrimary);
      const chunk = toChunk(group, index, overlap);
      chunks.push(chunk);
      previousPrimary = group.map((unit) => unit.sentence);
    });
    return { status: "ready", plan, chunks };
  }
}
