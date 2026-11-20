import { isFieldValue } from "./hash.js";
import type { FieldMap, FieldValue } from "./types.js";

export class YamlSyntaxError extends Error {
  readonly line: number;
  readonly code: "syntax" | "unsafe" | "limit";

  constructor(message: string, line: number, code: "syntax" | "unsafe" | "limit" = "syntax") {
    super(message);
    this.name = "YamlSyntaxError";
    this.line = line;
    this.code = code;
  }
}

interface SourceLine {
  readonly no: number;
  readonly indent: number;
  readonly text: string;
}

const MAX_DEPTH = 8;
const MAX_NODES = 500;

/**
 * Safe ef-fields subset. Anchors, aliases, and merge keys are rejected.
 * Line numbers are absolute file lines when `startLine` is the first interior line.
 */
export function parseEfFields(source: string, startLine: number): { fields: FieldMap; keyLines: Map<string, number> } {
  const physical = source.split("\n");
  const lines: Array<SourceLine | null> = physical.map((raw, index) => analyzeLine(raw, startLine + index));
  const counter = { nodes: 0 };
  const parsed = parseMap(lines, 0, 0, counter);
  if (parsed.index < lines.length) {
    const leftover = nextContent(lines, parsed.index);
    if (leftover) {
      throw new YamlSyntaxError("unexpected content after ef-fields map", leftover.line.no);
    }
  }
  return { fields: parsed.map, keyLines: parsed.keyLines };
}

export function syntaxBanner(line: number): string {
  return `Fix YAML syntax on line ${String(line)} to import`;
}

function analyzeLine(raw: string, no: number): SourceLine | null {
  if (raw.includes("\t")) throw new YamlSyntaxError("tabs are not allowed in ef-fields", no);
  assertSafe(raw, no);
  if (raw.trim() === "" || raw.trimStart().startsWith("#")) return null;
  const indent = raw.length - raw.trimStart().length;
  if (indent % 2 !== 0) throw new YamlSyntaxError("indent must be a multiple of 2 spaces", no);
  return { no, indent, text: raw.trimStart() };
}

function assertSafe(raw: string, no: number): void {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote === "'") {
      if (char === "'" && raw[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === '"') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "&" || char === "*" || char === "!" || char === "`") {
      throw new YamlSyntaxError("anchors, aliases, and custom tags are not allowed", no, "unsafe");
    }
    if (char === "<" && raw[index + 1] === "<") {
      throw new YamlSyntaxError("merge keys are not allowed", no, "unsafe");
    }
  }
  if (quote) throw new YamlSyntaxError("unterminated string", no);
}

function bump(counter: { nodes: number }, line: number): void {
  counter.nodes += 1;
  if (counter.nodes > MAX_NODES) {
    throw new YamlSyntaxError("ef-fields exceeds the safe node limit", line, "limit");
  }
}

function parseMap(
  lines: ReadonlyArray<SourceLine | null>,
  start: number,
  indent: number,
  counter: { nodes: number },
): { map: FieldMap; index: number; keyLines: Map<string, number> } {
  const map: FieldMap = {};
  const keyLines = new Map<string, number>();
  const seen = new Set<string>();
  let index = start;
  while (index < lines.length) {
    const current = lines[index];
    if (!current) {
      index += 1;
      continue;
    }
    if (current.indent < indent) break;
    if (current.indent > indent) {
      throw new YamlSyntaxError("unexpected indent", current.no);
    }
    if (current.text.startsWith("- ")) {
      throw new YamlSyntaxError("unexpected list item in a map", current.no);
    }
    const split = splitKey(current.text, current.no);
    if (seen.has(split.key)) throw new YamlSyntaxError(`duplicate key ${split.key}`, current.no);
    seen.add(split.key);
    keyLines.set(split.key, current.no);
    bump(counter, current.no);
    if (split.value !== "") {
      map[split.key] = parseFlowComplete(split.value, current.no, counter);
      index += 1;
      continue;
    }
    const nested = nextContent(lines, index + 1);
    if (!nested || nested.line.indent <= indent) {
      map[split.key] = null;
      index += 1;
      continue;
    }
    if (nested.line.text.startsWith("- ")) {
      const sequence = parseSeq(lines, nested.index, nested.line.indent, counter);
      map[split.key] = sequence.value;
      index = sequence.index;
    } else {
      const child = parseMap(lines, nested.index, nested.line.indent, counter);
      map[split.key] = child.map;
      index = child.index;
    }
  }
  return { map, index, keyLines };
}

function parseSeq(
  lines: ReadonlyArray<SourceLine | null>,
  start: number,
  indent: number,
  counter: { nodes: number },
): { value: FieldValue[]; index: number } {
  const value: FieldValue[] = [];
  let index = start;
  while (index < lines.length) {
    const current = lines[index];
    if (!current) {
      index += 1;
      continue;
    }
    if (current.indent < indent) break;
    if (current.indent !== indent || !current.text.startsWith("- ")) break;
    const rest = current.text.slice(2).trim();
    bump(counter, current.no);
    if (rest === "") {
      const nested = nextContent(lines, index + 1);
      if (!nested || nested.line.indent <= indent) {
        value.push(null);
        index += 1;
        continue;
      }
      if (nested.line.text.startsWith("- ")) {
        const child = parseSeq(lines, nested.index, nested.line.indent, counter);
        value.push(child.value);
        index = child.index;
      } else {
        const child = parseMap(lines, nested.index, nested.line.indent, counter);
        value.push(child.map);
        index = child.index;
      }
      continue;
    }
    value.push(parseFlowComplete(rest, current.no, counter));
    index += 1;
  }
  return { value, index };
}

function nextContent(
  lines: ReadonlyArray<SourceLine | null>,
  start: number,
): { readonly line: SourceLine; readonly index: number } | null {
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (line) return { line, index };
  }
  return null;
}

function splitKey(text: string, line: number): { key: string; value: string } {
  if (text.startsWith('"') || text.startsWith("'")) {
    const quoted = parseQuoted(text, 0, line);
    if (text[quoted.next] !== ":") throw new YamlSyntaxError("expected ':' after key", line);
    return { key: validateKey(quoted.value, line), value: text.slice(quoted.next + 1).trim() };
  }
  const colon = text.indexOf(":");
  if (colon <= 0) throw new YamlSyntaxError("expected key: value", line);
  return { key: validateKey(text.slice(0, colon).trim(), line), value: text.slice(colon + 1).trim() };
}

function validateKey(key: string, line: number): string {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
    throw new YamlSyntaxError(`invalid field key ${key}`, line);
  }
  return key;
}

function parseFlowComplete(text: string, line: number, counter: { nodes: number }): FieldValue {
  const parsed = parseFlowAt(text, 0, line, 1, counter);
  if (text.slice(parsed.next).trim() !== "") {
    throw new YamlSyntaxError("unexpected trailing YAML", line);
  }
  return parsed.value;
}

function parseFlowAt(
  text: string,
  index: number,
  line: number,
  depth: number,
  counter: { nodes: number },
): { value: FieldValue; next: number } {
  if (depth > MAX_DEPTH) throw new YamlSyntaxError("ef-fields nesting is too deep", line, "limit");
  const cursor = skipSpaces(text, index);
  const char = text[cursor];
  if (char === undefined) throw new YamlSyntaxError("missing YAML value", line);
  if (char === '"' || char === "'") return parseQuoted(text, cursor, line);
  if (char === "[") return parseFlowSeq(text, cursor, line, depth, counter);
  if (char === "{") return parseFlowMap(text, cursor, line, depth, counter);
  const end = scanPlain(text, cursor);
  return { value: coercePlain(text.slice(cursor, end).trim(), line), next: end };
}

function parseFlowSeq(
  text: string,
  index: number,
  line: number,
  depth: number,
  counter: { nodes: number },
): { value: FieldValue[]; next: number } {
  const items: FieldValue[] = [];
  let cursor = index + 1;
  while (true) {
    cursor = skipSpaces(text, cursor);
    if (cursor >= text.length) throw new YamlSyntaxError("unclosed [", line);
    if (text[cursor] === "]") return { value: items, next: cursor + 1 };
    const item = parseFlowAt(text, cursor, line, depth + 1, counter);
    bump(counter, line);
    items.push(item.value);
    cursor = skipSpaces(text, item.next);
    if (text[cursor] === ",") {
      cursor += 1;
      continue;
    }
    if (text[cursor] === "]") return { value: items, next: cursor + 1 };
    throw new YamlSyntaxError("unclosed [", line);
  }
}

function parseFlowMap(
  text: string,
  index: number,
  line: number,
  depth: number,
  counter: { nodes: number },
): { value: FieldMap; next: number } {
  const map: FieldMap = {};
  let cursor = index + 1;
  while (true) {
    cursor = skipSpaces(text, cursor);
    if (cursor >= text.length) throw new YamlSyntaxError("unclosed {", line);
    if (text[cursor] === "}") return { value: map, next: cursor + 1 };
    const keyToken = parseFlowAt(text, cursor, line, depth + 1, counter);
    if (typeof keyToken.value !== "string") throw new YamlSyntaxError("map key must be a string", line);
    const key = validateKey(keyToken.value, line);
    cursor = skipSpaces(text, keyToken.next);
    if (text[cursor] !== ":") throw new YamlSyntaxError("expected ':' in flow map", line);
    const item = parseFlowAt(text, cursor + 1, line, depth + 1, counter);
    bump(counter, line);
    map[key] = item.value;
    cursor = skipSpaces(text, item.next);
    if (text[cursor] === ",") {
      cursor += 1;
      continue;
    }
    if (text[cursor] === "}") return { value: map, next: cursor + 1 };
    throw new YamlSyntaxError("unclosed {", line);
  }
}

function parseQuoted(text: string, index: number, line: number): { value: string; next: number } {
  const quote = text[index];
  if (quote !== '"' && quote !== "'") throw new YamlSyntaxError("expected string", line);
  let cursor = index + 1;
  let value = "";
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === undefined) break;
    if (quote === "'") {
      if (char === "'" && text[cursor + 1] === "'") {
        value += "'";
        cursor += 2;
        continue;
      }
      if (char === "'") return { value, next: cursor + 1 };
      value += char;
      cursor += 1;
      continue;
    }
    if (char === "\\") {
      const escaped = text[cursor + 1];
      if (escaped === "n") value += "\n";
      else if (escaped === "t") value += "\t";
      else if (escaped === '"' || escaped === "\\" || escaped === "/") value += escaped;
      else throw new YamlSyntaxError("unsupported string escape", line);
      cursor += 2;
      continue;
    }
    if (char === '"') return { value, next: cursor + 1 };
    value += char;
    cursor += 1;
  }
  throw new YamlSyntaxError("unterminated string", line);
}

function scanPlain(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "," || char === "]" || char === "}" || char === ":") break;
    cursor += 1;
  }
  return cursor;
}

function coercePlain(text: string, line: number): FieldValue {
  if (text === "") throw new YamlSyntaxError("missing YAML value", line);
  if (text === "null" || text === "~") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) {
    const value = Number(text);
    if (!Number.isFinite(value)) throw new YamlSyntaxError("invalid number", line);
    return value;
  }
  if (!isFieldValue(text)) throw new YamlSyntaxError("invalid scalar", line);
  return text;
}

function skipSpaces(text: string, index: number): number {
  let cursor = index;
  while (text[cursor] === " ") cursor += 1;
  return cursor;
}
