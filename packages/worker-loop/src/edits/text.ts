import { ReplaceLinesBoundsError } from "./errors.js";
import { hashFileContent } from "./hash.js";

export type EndOfLine = "\n" | "\r\n";

export interface LineSpan {
  readonly lineNumber: number;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export function dominantEndOfLine(content: string): EndOfLine {
  let crlf = 0;
  let lf = 0;
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (code === 13 && content.charCodeAt(index + 1) === 10) {
      crlf += 1;
      index += 1;
    } else if (code === 10) {
      lf += 1;
    }
  }
  return crlf > lf ? "\r\n" : "\n";
}

export function convertEndOfLine(text: string, eol: EndOfLine): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return eol === "\n" ? normalized : normalized.replace(/\n/g, "\r\n");
}

/** Line spans keep the original linebreak inside `end` so splices can preserve it. */
export function lineSpans(content: string): readonly LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  let lineNumber = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) !== 10) continue;
    let textEnd = index;
    if (textEnd > start && content.charCodeAt(textEnd - 1) === 13) textEnd -= 1;
    spans.push({
      lineNumber,
      text: content.slice(start, textEnd),
      start,
      end: index + 1,
    });
    start = index + 1;
    lineNumber += 1;
  }
  if (start < content.length || spans.length === 0) {
    spans.push({
      lineNumber,
      text: content.slice(start),
      start,
      end: content.length,
    });
  }
  return spans;
}

export function logicalLines(content: string): readonly string[] {
  return lineSpans(content).map((span) => span.text);
}

export function lineNumberAt(content: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, content.length);
  for (let index = 0; index < end; index += 1) {
    if (content.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

export function numberedView(content: string, startLine: number, endLine: number): string {
  const spans = lineSpans(content);
  const start = Math.max(1, startLine);
  const end = Math.min(spans.length, Math.max(start, endLine));
  const width = Math.max(4, String(spans.length).length);
  const rows: string[] = [];
  for (let line = start; line <= end; line += 1) {
    const body = spans[line - 1]?.text ?? "";
    rows.push(`L${String(line).padStart(width, "0")}: ${body}`);
  }
  return rows.join("\n");
}

export function lineRangeBounds(
  content: string,
  startLine: number,
  endLine: number,
  path = "",
): { readonly start: number; readonly end: number; readonly lineCount: number } {
  const spans = lineSpans(content);
  if (startLine < 1 || endLine < startLine || endLine > spans.length) {
    throw new ReplaceLinesBoundsError(path, startLine, endLine, spans.length);
  }
  const first = spans[startLine - 1];
  const last = spans[endLine - 1];
  if (!first || !last) {
    throw new ReplaceLinesBoundsError(path, startLine, endLine, spans.length);
  }
  return { start: first.start, end: last.end, lineCount: spans.length };
}

export function hashLineRange(content: string, startLine: number, endLine: number, path = ""): string {
  const spans = lineSpans(content);
  if (startLine < 1 || endLine < startLine || endLine > spans.length) {
    throw new ReplaceLinesBoundsError(path, startLine, endLine, spans.length);
  }
  const selected = spans.slice(startLine - 1, endLine).map((span) => span.text);
  return hashFileContent(selected.join("\n"));
}

export function stripTrailingHorizontal(line: string): string {
  return line.replace(/[ \t]+$/u, "");
}

export function leadingWhitespace(line: string): string {
  return /^[ \t]*/u.exec(line)?.[0] ?? "";
}

export function minIndent(lines: readonly string[]): string {
  let best: string | undefined;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const whitespace = leadingWhitespace(line);
    if (best === undefined || whitespace.length < best.length) best = whitespace;
  }
  return best ?? "";
}

/**
 * Shift replacement lines so their base indent matches the matched block.
 * Relative nesting inside the replacement is preserved.
 */
export function reindentReplacement(replacement: string, fileBaseIndent: string): string {
  const normalized = replacement.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const endsWithNewline = normalized.endsWith("\n");
  const lines = endsWithNewline ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  if (normalized.length === 0) return "";
  const replacementBase = minIndent(lines);
  const delta = fileBaseIndent.length - replacementBase.length;
  const padChar = fileBaseIndent.includes("\t") && !fileBaseIndent.includes(" ") ? "\t" : " ";
  const shifted = lines.map((line) => {
    if (line.trim() === "") return "";
    const current = leadingWhitespace(line);
    const nextLength = Math.max(0, current.length + delta);
    return padChar.repeat(nextLength) + line.slice(current.length);
  });
  const joined = shifted.join("\n");
  return endsWithNewline ? `${joined}\n` : joined;
}

const ELISION_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: "// ... existing code ...", pattern: /\/\/\s*\.\.\.\s*existing code\s*\.\.\./i },
  { label: "/* ... rest of file unchanged ... */", pattern: /\/\*\s*\.\.\.\s*rest of file unchanged\s*\.\.\.\s*\*\//i },
  { label: "# ... existing code ...", pattern: /#\s*\.\.\.\s*existing code\s*\.\.\./i },
  { label: "// ... rest of file ...", pattern: /\/\/\s*\.\.\.\s*rest of file\b/i },
  { label: "/* unchanged */", pattern: /\/\*\s*unchanged\s*\*\//i },
  { label: "rest of file unchanged", pattern: /rest of file unchanged/i },
];

export function detectElision(text: string): string | undefined {
  for (const entry of ELISION_PATTERNS) {
    if (entry.pattern.test(text)) return entry.label;
  }
  return undefined;
}

export function changedLineRegion(
  previous: string | undefined,
  current: string,
): { readonly start: number; readonly end: number } {
  const nextLines = logicalLines(current);
  const last = Math.max(1, nextLines.length);
  if (previous === undefined) {
    return { start: 1, end: Math.min(last, 400) };
  }
  const previousLines = logicalLines(previous);
  let start = -1;
  let end = -1;
  const max = Math.max(previousLines.length, nextLines.length);
  for (let index = 0; index < max; index += 1) {
    if ((previousLines[index] ?? "") !== (nextLines[index] ?? "")) {
      if (start < 0) start = index;
      end = index;
    }
  }
  if (start < 0) return { start: 1, end: Math.min(last, 400) };
  return {
    start: Math.max(1, start + 1 - 2),
    end: Math.min(last, end + 1 + 2),
  };
}
