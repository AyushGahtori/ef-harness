import { assembleDocument } from "./assemble.js";
import { hiddenTextWarning, stripStealthUnicode } from "./unicode-sanitizer.js";
import type { BlockKind, ConverterWarning, NormalizedDocument, RawBlock } from "./types.js";

export class MarkdownHtmlConverter {
  convert(bytes: Uint8Array, fileName: string, sourceHash: string, kind: "markdown" | "html"): NormalizedDocument {
    const original = Buffer.from(bytes).toString("utf8");
    const stealth = stripStealthUnicode(original);
    const stripped = stripDangerousHtml(stealth.text);
    const warnings: ConverterWarning[] = [];
    if (stealth.stripped) {
      warnings.push({
        name: "StealthUnicodeStrippedWarning",
        code: "stealth_unicode_stripped",
        message: "Stealth Unicode was stripped before text left the converter.",
      });
    }
    if (stripped.hidden) warnings.push(hiddenTextWarning());
    const blocks =
      kind === "html"
        ? htmlBlocks(stripped.text, fileName)
        : markdownBlocks(stripped.text, fileName);
    return assembleDocument({
      sourceHash,
      fileName,
      mediaType: kind,
      blocks,
      warnings,
      ocrDerived: false,
      stats: {},
    });
  }
}

function stripDangerousHtml(text: string): { readonly text: string; readonly hidden: boolean } {
  let hidden = false;
  const next = text
    .replace(/<!--[\s\S]*?-->/g, () => {
      hidden = true;
      return "";
    })
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, () => {
      hidden = true;
      return "";
    })
    .replace(
      /<([a-zA-Z0-9]+)\b[^>]*\b(?:hidden\b|style\s*=\s*["'][^"']*(?:display\s*:\s*none|font-size\s*:\s*0(?:px)?|visibility\s*:\s*hidden|opacity\s*:\s*0)[^"']*["'])[^>]*>[\s\S]*?<\/\1>/gi,
      () => {
        hidden = true;
        return "";
      },
    );
  return { text: next, hidden };
}

function markdownBlocks(text: string, fileName: string): RawBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: RawBlock[] = [];
  const headingPath: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    const heading = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (heading?.[1] && heading[2]) {
      const level = heading[1].length;
      headingPath.splice(level - 1);
      headingPath.push(heading[2]);
      pushBlock(blocks, "heading", heading[2], fileName, "markdown", [...headingPath], lineNumber, lineNumber);
      index += 1;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const start = lineNumber;
      const tableLines: string[] = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index] ?? "")) {
        tableLines.push(lines[index] ?? "");
        index += 1;
      }
      tableLines.forEach((tableLine, tableIndex) => {
        if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(tableLine)) return;
        const cells = splitTableRow(tableLine);
        cells.forEach((cell) => {
          if (!cell) return;
          pushBlock(
            blocks,
            "table_cell",
            cell,
            fileName,
            "markdown",
            [...headingPath],
            start + tableIndex,
            start + tableIndex,
          );
        });
      });
      continue;
    }
    const list = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (list?.[1]) {
      pushBlock(blocks, "list_item", list[1], fileName, "markdown", [...headingPath], lineNumber, lineNumber);
      index += 1;
      continue;
    }
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const start = lineNumber;
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      const end = index + 1;
      if (index < lines.length) index += 1;
      pushBlock(blocks, "paragraph", body.join("\n"), fileName, "markdown", [...headingPath], start, end);
      continue;
    }
    const start = lineNumber;
    const paragraph = [line];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim().length > 0 && !/^(#{1,6})\s+/.test(lines[index] ?? "")) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    pushBlock(
      blocks,
      "paragraph",
      paragraph.join(" ").trim(),
      fileName,
      "markdown",
      [...headingPath],
      start,
      start + paragraph.length - 1,
    );
  }
  return blocks;
}

function htmlBlocks(text: string, fileName: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  const headingPath: string[] = [];
  const pattern = /<!--[\s\S]*?-->|<\/([^>\s]+)\s*>|<([^!\s>/]+)([^>]*)>|([^<]+)/g;
  let line = 1;
  let buffer = "";
  let bufferLine = 1;
  const flush = (kind: BlockKind): void => {
    const value = buffer.replace(/\s+/g, " ").trim();
    buffer = "";
    if (!value) return;
    pushBlock(blocks, kind, value, fileName, "html", [...headingPath], bufferLine, line);
  };
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const newlines = token.match(/\n/g)?.length ?? 0;
    if (match[1]) {
      const name = match[1].toLowerCase();
      if (/^h[1-6]$/.test(name)) flush("heading");
      else if (name === "li") flush("list_item");
      else if (name === "td" || name === "th") flush("table_cell");
      else if (name === "p" || name === "div") flush("paragraph");
      if (/^h[1-6]$/.test(name)) {
        const level = Number(name.slice(1));
        const last = blocks[blocks.length - 1];
        headingPath.splice(Math.max(0, level - 1));
        if (last?.kind === "heading" && last.locator.type === "html") {
          headingPath.push(last.text);
          blocks[blocks.length - 1] = {
            ...last,
            locator: { ...last.locator, headingPath: [...headingPath] },
          };
        }
      }
    } else if (match[2]) {
      const name = match[2].toLowerCase();
      if (/^h[1-6]$/.test(name) || name === "p" || name === "li" || name === "td" || name === "th" || name === "div") {
        flush("paragraph");
        bufferLine = line;
      }
      if (name === "br") buffer += " ";
    } else if (match[4]) {
      if (!buffer) bufferLine = line;
      buffer += match[4];
    }
    line += newlines;
  }
  flush("paragraph");
  return blocks.map((block) => {
    if (block.kind !== "heading") return block;
    return block;
  });
}

function pushBlock(
  blocks: RawBlock[],
  kind: BlockKind,
  text: string,
  fileName: string,
  type: "markdown" | "html",
  headingPath: readonly string[],
  lineStart: number,
  lineEnd: number,
): void {
  const value = text.trim();
  if (!value) return;
  blocks.push({
    kind,
    text: value,
    locator: {
      type,
      filePath: fileName,
      headingPath,
      lineStart,
      lineEnd: Math.max(lineStart, lineEnd),
    },
  });
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0 && !/^:?-{3,}:?$/.test(cell));
}
