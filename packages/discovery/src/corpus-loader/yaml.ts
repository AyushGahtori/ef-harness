import { YamlParseError } from "./errors.js";

export const STRICT_YAML_PARSE_OPTIONS = { uniqueKeys: true } as const;

interface YamlLine {
  readonly number: number;
  readonly indent: number;
  readonly text: string;
}

interface ParsedBlock {
  readonly value: unknown;
  readonly next: number;
}

export function parseStrictYaml(
  source: string,
  filePath: string,
  options?: { readonly uniqueKeys?: boolean },
): unknown {
  const uniqueKeys = options?.uniqueKeys ?? STRICT_YAML_PARSE_OPTIONS.uniqueKeys;
  const lines = lexYaml(source, filePath);
  if (lines.length === 0) {
    throw new YamlParseError(`Empty YAML document in ${filePath}`, {
      filePath,
      line: 1,
    });
  }
  const parsed = parseBlock(lines, 0, 0, filePath, uniqueKeys);
  if (parsed.next < lines.length) {
    const leftover = lines[parsed.next];
    throw new YamlParseError(
      `Malformed YAML indentation at line ${leftover?.number ?? 1} in ${filePath}`,
      { filePath, line: leftover?.number },
    );
  }
  return parsed.value;
}

function lexYaml(source: string, filePath: string): YamlLine[] {
  const normalized = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const rawLines = normalized.split(/\r?\n/);
  const lines: YamlLine[] = [];
  let seenContent = false;
  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index] ?? "";
    const number = index + 1;
    if (raw.includes("\t")) {
      throw new YamlParseError(`Malformed YAML indentation at line ${number} in ${filePath}`, {
        filePath,
        line: number,
      });
    }
    const stripped = stripComment(raw).trimEnd();
    if (stripped.trim() === "") continue;
    const indent = countIndent(stripped);
    const text = stripped.slice(indent).trim();
    if (text === "---") {
      if (seenContent) {
        throw new YamlParseError(
          `Multiple YAML documents are not supported at line ${number} in ${filePath}`,
          { filePath, line: number },
        );
      }
      continue;
    }
    if (text === "...") {
      throw new YamlParseError(`Unexpected YAML end marker at line ${number} in ${filePath}`, {
        filePath,
        line: number,
      });
    }
    if (text.startsWith("&") || text.startsWith("*") || text.startsWith("!")) {
      throw new YamlParseError(
        `YAML anchors, aliases, and tags are not supported at line ${number} in ${filePath}`,
        { filePath, line: number },
      );
    }
    seenContent = true;
    lines.push({ number, indent, text });
  }
  return lines;
}

function parseBlock(
  lines: readonly YamlLine[],
  start: number,
  minIndent: number,
  filePath: string,
  uniqueKeys: boolean,
): ParsedBlock {
  const line = lines[start];
  if (!line || line.indent < minIndent) return { value: null, next: start };
  if (line.text.startsWith("- ")) return parseSequence(lines, start, minIndent, filePath, uniqueKeys);
  return parseMapping(lines, start, minIndent, filePath, uniqueKeys);
}

function parseMapping(
  lines: readonly YamlLine[],
  start: number,
  minIndent: number,
  filePath: string,
  uniqueKeys: boolean,
): ParsedBlock {
  const first = lines[start];
  if (!first || first.indent < minIndent) return { value: null, next: start };
  const keyIndent = first.indent;
  const record: Record<string, unknown> = {};
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (!line || line.indent < keyIndent) break;
    if (line.indent > keyIndent) {
      throw new YamlParseError(
        `Malformed YAML indentation at line ${line.number} in ${filePath}`,
        { filePath, line: line.number },
      );
    }
    if (line.text.startsWith("- ")) {
      throw new YamlParseError(
        `Malformed YAML indentation at line ${line.number} in ${filePath}`,
        { filePath, line: line.number },
      );
    }
    const pair = splitPair(line.text, line.number, filePath);
    if (Object.hasOwn(record, pair.key)) {
      if (uniqueKeys) {
        throw new YamlParseError(
          `Duplicate YAML key "${pair.key}" at line ${line.number} in ${filePath}`,
          { filePath, line: line.number },
        );
      }
    }
    const taken = takeValue(lines, index, keyIndent, pair, filePath, uniqueKeys);
    record[pair.key] = taken.value;
    index = taken.next;
  }
  return { value: record, next: index };
}

function parseSequence(
  lines: readonly YamlLine[],
  start: number,
  minIndent: number,
  filePath: string,
  uniqueKeys: boolean,
): ParsedBlock {
  const first = lines[start];
  if (!first || first.indent < minIndent) return { value: null, next: start };
  const dashIndent = first.indent;
  const items: unknown[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (!line || line.indent !== dashIndent || !line.text.startsWith("- ")) break;
    if (!line.text.startsWith("- ") || line.text.startsWith("-  ")) {
      throw new YamlParseError(
        `Malformed YAML indentation at line ${line.number} in ${filePath}`,
        { filePath, line: line.number },
      );
    }
    const body = line.text.slice(2).trim();
    if (body === "") {
      const nested = parseBlock(lines, index + 1, dashIndent + 1, filePath, uniqueKeys);
      if (nested.next === index + 1) {
        throw new YamlParseError(
          `Malformed YAML indentation at line ${line.number} in ${filePath}`,
          { filePath, line: line.number },
        );
      }
      items.push(nested.value);
      index = nested.next;
      continue;
    }
    if (body.startsWith("{") || body.startsWith("[")) {
      items.push(parseFlow(body, line.number, filePath, uniqueKeys));
      index += 1;
      continue;
    }
    if (isPair(body)) {
      const mapped = parseDashMapping(lines, index, dashIndent, filePath, uniqueKeys);
      items.push(mapped.value);
      index = mapped.next;
      continue;
    }
    items.push(coerceScalar(body, line.number, filePath));
    index += 1;
  }
  return { value: items, next: index };
}

function parseDashMapping(
  lines: readonly YamlLine[],
  start: number,
  dashIndent: number,
  filePath: string,
  uniqueKeys: boolean,
): ParsedBlock {
  const keyIndent = dashIndent + 2;
  const record: Record<string, unknown> = {};
  let index = start;
  let first = true;
  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;
    if (first) {
      first = false;
      const body = line.text.slice(2).trim();
      const pair = splitPair(body, line.number, filePath);
      const taken = takeValue(lines, index, keyIndent, pair, filePath, uniqueKeys);
      record[pair.key] = taken.value;
      index = taken.next;
      continue;
    }
    if (line.indent < keyIndent) break;
    if (line.indent > keyIndent) {
      throw new YamlParseError(
        `Malformed YAML indentation at line ${line.number} in ${filePath}`,
        { filePath, line: line.number },
      );
    }
    if (line.text.startsWith("- ")) break;
    const pair = splitPair(line.text, line.number, filePath);
    if (Object.hasOwn(record, pair.key)) {
      if (uniqueKeys) {
        throw new YamlParseError(
          `Duplicate YAML key "${pair.key}" at line ${line.number} in ${filePath}`,
          { filePath, line: line.number },
        );
      }
    }
    const taken = takeValue(lines, index, keyIndent, pair, filePath, uniqueKeys);
    record[pair.key] = taken.value;
    index = taken.next;
  }
  return { value: record, next: index };
}

function takeValue(
  lines: readonly YamlLine[],
  index: number,
  keyIndent: number,
  pair: { readonly key: string; readonly valueText: string },
  filePath: string,
  uniqueKeys: boolean,
): ParsedBlock {
  const line = lines[index];
  const lineNumber = line?.number ?? 1;
  if (pair.valueText === ">" || pair.valueText === "|" || pair.valueText === ">-" || pair.valueText === "|-") {
    return readBlockScalar(lines, index, keyIndent, pair.valueText, filePath);
  }
  if (pair.valueText === "") {
    const next = lines[index + 1];
    if (next && next.indent > keyIndent) {
      return parseBlock(lines, index + 1, keyIndent + 1, filePath, uniqueKeys);
    }
    return { value: null, next: index + 1 };
  }
  if (pair.valueText.startsWith("{") || pair.valueText.startsWith("[")) {
    return {
      value: parseFlow(pair.valueText, lineNumber, filePath, uniqueKeys),
      next: index + 1,
    };
  }
  return {
    value: coerceScalar(pair.valueText, lineNumber, filePath),
    next: index + 1,
  };
}

function readBlockScalar(
  lines: readonly YamlLine[],
  index: number,
  keyIndent: number,
  style: string,
  filePath: string,
): ParsedBlock {
  const content: string[] = [];
  let next = index + 1;
  let blockIndent: number | null = null;
  while (next < lines.length) {
    const line = lines[next];
    if (!line || line.indent <= keyIndent) break;
    if (blockIndent === null) blockIndent = line.indent;
    if (line.indent < blockIndent) {
      throw new YamlParseError(
        `Malformed YAML indentation at line ${line.number} in ${filePath}`,
        { filePath, line: line.number },
      );
    }
    content.push(line.text);
    next += 1;
  }
  const folded = style.startsWith(">");
  const value = folded ? content.join(" ") : content.join("\n");
  return { value: style.endsWith("-") ? value.trimEnd() : value, next };
}

function parseFlow(text: string, line: number, filePath: string, uniqueKeys: boolean): unknown {
  const parser = new FlowParser(text, line, filePath, uniqueKeys);
  const value = parser.parseValue();
  parser.skip();
  if (!parser.atEnd()) {
    throw new YamlParseError(`Malformed YAML flow collection at line ${line} in ${filePath}`, {
      filePath,
      line,
    });
  }
  return value;
}

class FlowParser {
  private index = 0;

  constructor(
    private readonly text: string,
    private readonly line: number,
    private readonly filePath: string,
    private readonly uniqueKeys: boolean,
  ) {}

  atEnd(): boolean {
    return this.index >= this.text.length;
  }

  parseValue(): unknown {
    this.skip();
    const ch = this.peek();
    if (ch === "[") return this.parseSequence();
    if (ch === "{") return this.parseMapping();
    if (ch === '"' || ch === "'") return this.parseQuoted(ch);
    return this.parsePlain();
  }

  private parseSequence(): unknown[] {
    this.expect("[");
    const items: unknown[] = [];
    this.skip();
    if (this.peek() === "]") {
      this.expect("]");
      return items;
    }
    for (;;) {
      items.push(this.parseValue());
      this.skip();
      if (this.peek() === ",") {
        this.expect(",");
        continue;
      }
      if (this.peek() === "]") {
        this.expect("]");
        return items;
      }
      this.fail("Malformed YAML flow sequence");
    }
  }

  private parseMapping(): Record<string, unknown> {
    this.expect("{");
    const record: Record<string, unknown> = {};
    this.skip();
    if (this.peek() === "}") {
      this.expect("}");
      return record;
    }
    for (;;) {
      this.skip();
      const key = this.parseFlowKey();
      if (Object.hasOwn(record, key)) {
        if (this.uniqueKeys) {
          throw new YamlParseError(
            `Duplicate YAML key "${key}" at line ${this.line} in ${this.filePath}`,
            { filePath: this.filePath, line: this.line },
          );
        }
      }
      this.skip();
      this.expect(":");
      record[key] = this.parseValue();
      this.skip();
      if (this.peek() === ",") {
        this.expect(",");
        continue;
      }
      if (this.peek() === "}") {
        this.expect("}");
        return record;
      }
      this.fail("Malformed YAML flow mapping");
    }
  }

  private parseFlowKey(): string {
    this.skip();
    const ch = this.peek();
    if (ch === '"' || ch === "'") {
      const key = this.parseQuoted(ch);
      if (typeof key !== "string" || key === "") this.fail("Malformed YAML flow key");
      return key;
    }
    const start = this.index;
    while (!this.atEnd()) {
      const current = this.peek();
      if (current === ":" || current === "," || current === "}" || current === "]") break;
      this.index += 1;
    }
    const key = this.text.slice(start, this.index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) this.fail("Malformed YAML flow key");
    return key;
  }

  private parseQuoted(quote: string): string {
    this.expect(quote);
    let out = "";
    while (!this.atEnd()) {
      const ch = this.next();
      if (ch === quote) {
        if (quote === "'" && this.peek() === "'") {
          this.next();
          out += "'";
          continue;
        }
        return out;
      }
      if (quote === '"' && ch === "\\") {
        const esc = this.next();
        if (esc === "n") out += "\n";
        else if (esc === "t") out += "\t";
        else if (esc === '"' || esc === "\\") out += esc;
        else this.fail("Malformed YAML string escape");
        continue;
      }
      out += ch;
    }
    this.fail("Unterminated YAML string");
  }

  private parsePlain(): unknown {
    const start = this.index;
    while (!this.atEnd()) {
      const ch = this.peek();
      if (ch === "," || ch === "]" || ch === "}") break;
      if (ch === "[" || ch === "{") this.fail("Malformed YAML flow scalar");
      this.index += 1;
    }
    const raw = this.text.slice(start, this.index).trim();
    if (raw === "") this.fail("Empty YAML flow scalar");
    return coerceScalar(raw, this.line, this.filePath);
  }

  skip(): void {
    while (this.peek() === " ") this.index += 1;
  }

  private expect(ch: string): void {
    if (this.peek() !== ch) this.fail(`Expected '${ch}'`);
    this.index += 1;
  }

  private peek(): string | undefined {
    return this.text[this.index];
  }

  private next(): string {
    const ch = this.text[this.index];
    if (ch === undefined) this.fail("Unexpected end of YAML flow");
    this.index += 1;
    return ch;
  }

  private fail(message: string): never {
    throw new YamlParseError(`${message} at line ${this.line} in ${this.filePath}`, {
      filePath: this.filePath,
      line: this.line,
    });
  }
}

function isPair(text: string): boolean {
  return /:(?: |$)/.test(text);
}

function splitPair(
  text: string,
  line: number,
  filePath: string,
): { readonly key: string; readonly valueText: string } {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ":" && (index + 1 === text.length || text[index + 1] === " ")) {
      const rawKey = text.slice(0, index).trim();
      const valueText = text.slice(index + 1).trim();
      if (rawKey === "") {
        throw new YamlParseError(`Missing YAML key at line ${line} in ${filePath}`, {
          filePath,
          line,
        });
      }
      const key = unquotePlain(rawKey, line, filePath);
      if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) {
        throw new YamlParseError(`Malformed YAML key "${key}" at line ${line} in ${filePath}`, {
          filePath,
          line,
        });
      }
      return { key, valueText };
    }
  }
  throw new YamlParseError(`Expected a YAML key at line ${line} in ${filePath}`, {
    filePath,
    line,
  });
}

function unquotePlain(raw: string, line: number, filePath: string): string {
  if (raw.startsWith('"') || raw.startsWith("'")) {
    const parsed = coerceScalar(raw, line, filePath);
    if (typeof parsed !== "string") {
      throw new YamlParseError(`Malformed YAML key at line ${line} in ${filePath}`, {
        filePath,
        line,
      });
    }
    return parsed;
  }
  return raw;
}

function coerceScalar(raw: string, line: number, filePath: string): unknown {
  if (raw.startsWith('"')) return decodeDouble(raw, line, filePath);
  if (raw.startsWith("'")) return decodeSingle(raw, line, filePath);
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  if (/^-?(0|[1-9]\d*)$/.test(raw)) return Number(raw);
  if (/^-?(0|[1-9]\d*)\.\d+$/.test(raw)) return Number(raw);
  if (raw.startsWith("{") || raw.startsWith("[") || raw.startsWith("&") || raw.startsWith("*")) {
    throw new YamlParseError(`Malformed YAML scalar at line ${line} in ${filePath}`, {
      filePath,
      line,
    });
  }
  return raw;
}

function decodeDouble(raw: string, line: number, filePath: string): string {
  if (!raw.endsWith('"') || raw.length < 2) {
    throw new YamlParseError(`Unterminated YAML string at line ${line} in ${filePath}`, {
      filePath,
      line,
    });
  }
  let out = "";
  for (let index = 1; index < raw.length - 1; index += 1) {
    const ch = raw[index];
    if (ch === "\\") {
      const esc = raw[index + 1];
      if (esc === "n") out += "\n";
      else if (esc === "t") out += "\t";
      else if (esc === '"' || esc === "\\") out += esc;
      else {
        throw new YamlParseError(`Malformed YAML string escape at line ${line} in ${filePath}`, {
          filePath,
          line,
        });
      }
      index += 1;
      continue;
    }
    out += ch ?? "";
  }
  return out;
}

function decodeSingle(raw: string, line: number, filePath: string): string {
  if (!raw.endsWith("'") || raw.length < 2) {
    throw new YamlParseError(`Unterminated YAML string at line ${line} in ${filePath}`, {
      filePath,
      line,
    });
  }
  return raw.slice(1, -1).replaceAll("''", "'");
}

function stripComment(input: string): string {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index];
    if (quote) {
      if (ch === "\\" && quote === '"') {
        index += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && input[index + 1] === "'") {
          index += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "#" && (index === 0 || input[index - 1] === " ")) return input.slice(0, index);
  }
  return input;
}

function countIndent(input: string): number {
  let indent = 0;
  while (input[indent] === " ") indent += 1;
  return indent;
}
