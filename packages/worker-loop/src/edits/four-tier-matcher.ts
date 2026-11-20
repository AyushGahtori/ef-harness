import {
  AmbiguousEditMatchError,
  EmptySearchTextError,
  SearchTextNotFoundError,
} from "./errors.js";
import {
  convertEndOfLine,
  dominantEndOfLine,
  lineNumberAt,
  lineSpans,
  logicalLines,
  minIndent,
  reindentReplacement,
  stripTrailingHorizontal,
  type EndOfLine,
} from "./text.js";

export type MatchTier = 1 | 2 | 3 | 4;

export interface UniqueMatch {
  readonly tier: MatchTier;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly fileBaseIndent: string;
  readonly matchedText: string;
}

interface MatchHit {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly fileBaseIndent: string;
}

interface NormalizedText {
  readonly text: string;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

function normalizeWithMap(content: string): NormalizedText {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (code === 13 && content.charCodeAt(index + 1) === 10) {
      text += "\n";
      starts.push(index);
      ends.push(index + 2);
      index += 1;
      continue;
    }
    text += content[index] ?? "";
    starts.push(index);
    ends.push(index + 1);
  }
  return { text, starts, ends };
}

function mapNormalizedRange(
  normalized: NormalizedText,
  start: number,
  end: number,
  originalLength: number,
): { readonly start: number; readonly end: number } {
  if (start === end) {
    const at = start >= normalized.starts.length ? originalLength : normalized.starts[start] ?? originalLength;
    return { start: at, end: at };
  }
  const originalStart = normalized.starts[start];
  const originalEnd = normalized.ends[end - 1];
  if (originalStart === undefined || originalEnd === undefined) {
    return { start: originalLength, end: originalLength };
  }
  return { start: originalStart, end: originalEnd };
}

function findSubstringHits(haystack: string, needle: string): number[] {
  const starts: number[] = [];
  if (needle.length === 0) return starts;
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    starts.push(at);
    from = at + 1;
  }
  return starts;
}

function lineWindowHits(
  content: string,
  searchLines: readonly string[],
  equalsWindow: (fileLines: readonly string[]) => boolean,
): MatchHit[] {
  if (searchLines.length === 0) return [];
  const spans = lineSpans(content);
  if (spans.length < searchLines.length) return [];
  const hits: MatchHit[] = [];
  for (let index = 0; index <= spans.length - searchLines.length; index += 1) {
    const window = spans.slice(index, index + searchLines.length);
    const fileTexts = window.map((span) => span.text);
    if (!equalsWindow(fileTexts)) continue;
    const first = window[0];
    const last = window[window.length - 1];
    if (!first || !last) continue;
    hits.push({
      startOffset: first.start,
      endOffset: last.end,
      startLine: first.lineNumber,
      endLine: last.lineNumber,
      fileBaseIndent: minIndent(fileTexts),
    });
  }
  return hits;
}

function filterAnchors(hits: readonly MatchHit[], anchors: readonly number[] | null): MatchHit[] {
  if (anchors === null) return [...hits];
  return hits.filter((hit) => anchors.some((anchor) => hit.startOffset >= anchor));
}

function toUnique(content: string, tier: MatchTier, hit: MatchHit): UniqueMatch {
  return {
    tier,
    startOffset: hit.startOffset,
    endOffset: hit.endOffset,
    startLine: hit.startLine,
    endLine: hit.endLine,
    fileBaseIndent: hit.fileBaseIndent,
    matchedText: content.slice(hit.startOffset, hit.endOffset),
  };
}

/**
 * Tolerant search that stops at the first tier with one match and rejects
 * every tier that has more than one match.
 */
export class FourTierMatcher {
  match(fileText: string, search: string): UniqueMatch {
    return this.matchAnchored(fileText, search, null);
  }

  /**
   * `anchors === null` searches the whole file.
   * An empty anchor list means a required header was not found.
   */
  matchAnchored(fileText: string, search: string, anchors: readonly number[] | null): UniqueMatch {
    if (search.length === 0) throw new EmptySearchTextError();
    if (anchors !== null && anchors.length === 0) throw new SearchTextNotFoundError();
    const tiers: readonly MatchTier[] = [1, 2, 3, 4];
    for (const tier of tiers) {
      const hits = filterAnchors(this.hitsAtTier(fileText, search, tier), anchors);
      if (hits.length === 1) {
        const only = hits[0];
        if (!only) throw new SearchTextNotFoundError();
        return toUnique(fileText, tier, only);
      }
      if (hits.length > 1) {
        throw new AmbiguousEditMatchError(hits.map((hit) => hit.startLine));
      }
    }
    throw new SearchTextNotFoundError();
  }

  private hitsAtTier(fileText: string, search: string, tier: MatchTier): MatchHit[] {
    if (tier === 1) return this.exactHits(fileText, search);
    if (tier === 2) return this.normalizedEolHits(fileText, search);
    const searchLines = logicalLines(search);
    if (tier === 3) {
      return lineWindowHits(fileText, searchLines, (fileLines) =>
        fileLines.every((line, index) => {
          return stripTrailingHorizontal(line) === stripTrailingHorizontal(searchLines[index] ?? "");
        }),
      );
    }
    return lineWindowHits(fileText, searchLines, (fileLines) => tier4LineEqual(fileLines, searchLines));
  }

  private exactHits(fileText: string, search: string): MatchHit[] {
    return findSubstringHits(fileText, search).map((start) => ({
      startOffset: start,
      endOffset: start + search.length,
      startLine: lineNumberAt(fileText, start),
      endLine: lineNumberAt(fileText, start + search.length),
      fileBaseIndent: "",
    }));
  }

  private normalizedEolHits(fileText: string, search: string): MatchHit[] {
    const fileNorm = normalizeWithMap(fileText);
    const searchNorm = normalizeWithMap(search).text;
    return findSubstringHits(fileNorm.text, searchNorm).map((start) => {
      const range = mapNormalizedRange(fileNorm, start, start + searchNorm.length, fileText.length);
      return {
        startOffset: range.start,
        endOffset: range.end,
        startLine: lineNumberAt(fileText, range.start),
        endLine: lineNumberAt(fileText, range.end),
        fileBaseIndent: "",
      };
    });
  }
}

function tier4LineEqual(fileLines: readonly string[], searchLines: readonly string[]): boolean {
  if (fileLines.length !== searchLines.length) return false;
  const fileBase = minIndent(fileLines);
  const searchBase = minIndent(searchLines);
  for (let index = 0; index < fileLines.length; index += 1) {
    const fileLine = stripTrailingHorizontal(dedent(fileLines[index] ?? "", fileBase));
    const searchLine = stripTrailingHorizontal(dedent(searchLines[index] ?? "", searchBase));
    if (fileLine !== searchLine) return false;
  }
  return true;
}

function dedent(line: string, base: string): string {
  if (line.trim() === "") return "";
  if (base.length > 0 && line.startsWith(base)) return line.slice(base.length);
  const whitespace = /^[ \t]*/u.exec(line)?.[0] ?? "";
  return line.slice(whitespace.length);
}

export function applyMatchedReplacement(content: string, match: UniqueMatch, replacement: string): string {
  let next = replacement;
  if (match.tier === 4) next = reindentReplacement(next, match.fileBaseIndent);
  const eol: EndOfLine = dominantEndOfLine(content);
  next = convertEndOfLine(next, eol);
  if (match.startOffset === match.endOffset) {
    if (next.length > 0 && !next.endsWith("\n")) next += eol;
    return content.slice(0, match.startOffset) + next + content.slice(match.endOffset);
  }
  if (next.length === 0) {
    return content.slice(0, match.startOffset) + content.slice(match.endOffset);
  }
  const span = content.slice(match.startOffset, match.endOffset);
  const spanEndsWithNewline = span.endsWith("\n");
  const nextEndsWithNewline = next.endsWith("\n");
  if (spanEndsWithNewline && !nextEndsWithNewline) next += eol;
  else if (!spanEndsWithNewline && nextEndsWithNewline) next = next.replace(/\r?\n$/u, "");
  return content.slice(0, match.startOffset) + next + content.slice(match.endOffset);
}

/** Expand a full-line match so a deleted line takes its linebreak with it. */
export function snapMatchToWholeLines(content: string, match: UniqueMatch): UniqueMatch {
  if (match.startOffset === match.endOffset) return match;
  const spans = lineSpans(content);
  const startSpan = spans.find((span) => span.start === match.startOffset);
  if (!startSpan) return match;
  const endSpan =
    spans.find((span) => match.endOffset > span.start && match.endOffset <= span.end) ??
    spans.find((span) => span.start === match.endOffset);
  if (!endSpan) return match;
  const textEnd = endSpan.start + endSpan.text.length;
  const boundary = match.endOffset === endSpan.end || match.endOffset === textEnd || match.endOffset === endSpan.start;
  if (!boundary) return match;
  return {
    ...match,
    endOffset: endSpan.end,
    endLine: endSpan.lineNumber,
    matchedText: content.slice(match.startOffset, endSpan.end),
  };
}

export function findHeaderAnchorEnds(content: string, headers: readonly string[]): number[] {
  const meaningful = headers.map((header) => header.trim()).filter((header) => header.length > 0);
  if (meaningful.length === 0) return [];
  const spans = lineSpans(content);
  const ends: number[] = [];
  for (let index = 0; index <= spans.length - meaningful.length; index += 1) {
    let matched = true;
    for (let headerIndex = 0; headerIndex < meaningful.length; headerIndex += 1) {
      const fileLine = spans[index + headerIndex]?.text.trim() ?? "";
      const header = meaningful[headerIndex] ?? "";
      if (fileLine !== header && !fileLine.startsWith(header)) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    const last = spans[index + meaningful.length - 1];
    if (last) ends.push(last.end);
  }
  return ends;
}
