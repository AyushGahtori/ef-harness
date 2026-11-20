/** Quote-aware tokenizer and structured-literal counter for Check 6. */

export interface TextHit {
  readonly line: number;
  readonly column: number;
  readonly value: string;
}

export interface LiteralHit {
  readonly line: number;
  readonly column: number;
  readonly kind: "record-array" | "record-object" | "large-constant";
  readonly count: number;
}

interface Token {
  readonly kind: "ident" | "string" | "number" | "punct";
  readonly value: string;
  readonly line: number;
  readonly column: number;
}

interface ValueNode {
  readonly type: "primitive" | "object" | "array" | "other";
  readonly line: number;
  readonly column: number;
  readonly elements?: readonly ValueNode[];
  readonly entries?: readonly { key: string; value: ValueNode }[];
}

const RECORD_LIMIT = 5;
const CONSTANT_LIMIT = 20;

export function findFakeStrings(source: string): TextHit[] {
  return lex(source).strings.filter((item) => isFakeData(item.value));
}

export function findLiteralHits(source: string): LiteralHit[] {
  const tokens = lex(source).tokens;
  const hits: LiteralHit[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) break;
    const opener = token.kind === "punct" && (token.value === "{" || token.value === "[");
    if (opener && isValuePosition(tokens[index - 1], token.value)) {
      const parser = new Parser(tokens, index);
      const value = token.value === "{" ? parser.parseObject() : parser.parseArray();
      collectHits(value, hits);
      index = Math.max(parser.index, index + 1);
      continue;
    }
    index += 1;
  }
  return hits;
}

export function isFakeData(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (
    text === "john doe" ||
    text === "jane doe" ||
    text.includes("john doe") ||
    text.includes("jane doe") ||
    text.includes("foo@example.com") ||
    text.includes("test@test.com")
  ) {
    return true;
  }
  return /^[a-z0-9._%+-]+@example\.com$/.test(text);
}

function isValuePosition(previous: Token | undefined, opener: string): boolean {
  if (!previous) return opener === "[";
  if (previous.kind === "punct" && previous.value === "=>") return opener === "[";
  if (
    previous.kind === "punct" &&
    (previous.value === "=" ||
      previous.value === "(" ||
      previous.value === "[" ||
      previous.value === "," ||
      previous.value === ":" ||
      previous.value === "?" ||
      previous.value === "&&" ||
      previous.value === "||")
  ) {
    return true;
  }
  return previous.kind === "ident" && (previous.value === "return" || previous.value === "yield");
}

function collectHits(value: ValueNode, hits: LiteralHit[]): void {
  if (value.type === "array") {
    const elements = value.elements ?? [];
    const records = elements.filter(isRecord);
    const primitives = elements.filter((item) => item.type === "primitive");
    if (records.length > RECORD_LIMIT) {
      hits.push({
        line: value.line,
        column: value.column,
        kind: "record-array",
        count: records.length,
      });
    } else if (
      records.length === 0 &&
      primitives.length >= CONSTANT_LIMIT &&
      primitives.length === elements.length
    ) {
      hits.push({
        line: value.line,
        column: value.column,
        kind: "large-constant",
        count: primitives.length,
      });
    }
    for (const element of elements) {
      if (element.type === "array" || (element.type === "object" && !isRecord(element))) {
        collectHits(element, hits);
      }
    }
    return;
  }
  if (value.type === "object") {
    const entries = value.entries ?? [];
    const allPrimitive = entries.length > 0 && entries.every((entry) => entry.value.type === "primitive");
    if (allPrimitive && entries.length >= CONSTANT_LIMIT) {
      hits.push({
        line: value.line,
        column: value.column,
        kind: "large-constant",
        count: entries.length,
      });
    }
    const nestedRecords = entries.filter((entry) => isRecord(entry.value));
    if (nestedRecords.length > RECORD_LIMIT) {
      hits.push({
        line: value.line,
        column: value.column,
        kind: "record-object",
        count: nestedRecords.length,
      });
    }
    for (const entry of entries) {
      if (entry.value.type === "array" || entry.value.type === "object") {
        collectHits(entry.value, hits);
      }
    }
  }
}

function isRecord(value: ValueNode): boolean {
  if (value.type !== "object") return false;
  const entries = value.entries ?? [];
  if (entries.length === 0) return false;
  const primitives = entries.filter((entry) => entry.value.type === "primitive").length;
  return primitives >= 1 && primitives * 2 >= entries.length;
}

class Parser {
  index: number;

  constructor(
    private readonly tokens: readonly Token[],
    start: number,
  ) {
    this.index = start;
  }

  parseArray(): ValueNode {
    const start = this.bump();
    const elements: ValueNode[] = [];
    while (this.current() && this.current()?.value !== "]") {
      if (this.current()?.value === ",") {
        this.bump();
        continue;
      }
      const before = this.index;
      elements.push(this.parseValue());
      if (this.index === before) this.index += 1;
    }
    if (this.current()?.value === "]") this.bump();
    return {
      type: "array",
      elements,
      line: start?.line ?? 1,
      column: start?.column ?? 1,
    };
  }

  parseObject(): ValueNode {
    const start = this.bump();
    const entries: { key: string; value: ValueNode }[] = [];
    while (this.current() && this.current()?.value !== "}") {
      const token = this.current();
      if (!token) break;
      if (token.value === "," || token.value === ";") {
        this.bump();
        continue;
      }
      if (token.kind === "punct" && token.value === ".") {
        this.index += 3;
        const before = this.index;
        this.parseValue();
        if (this.index === before) this.index += 1;
        continue;
      }
      let key = "unknown";
      if (token.kind === "ident" || token.kind === "string" || token.kind === "number") {
        key = token.value;
        this.bump();
      } else if (token.value === "[") {
        this.skipBalanced("[", "]");
        key = "computed";
      } else {
        this.index += 1;
        continue;
      }
      const next = this.current();
      if (next?.value === "(") {
        this.skipBalanced("(", ")");
        if (this.current()?.value === "{") this.skipBalanced("{", "}");
        entries.push({
          key,
          value: { type: "other", line: token.line, column: token.column },
        });
        continue;
      }
      if (next?.value === ":") {
        this.bump();
        const before = this.index;
        const value = this.parseValue();
        if (this.index === before) this.index += 1;
        entries.push({ key, value });
        continue;
      }
      entries.push({
        key,
        value: { type: "other", line: token.line, column: token.column },
      });
    }
    if (this.current()?.value === "}") this.bump();
    return {
      type: "object",
      entries,
      line: start?.line ?? 1,
      column: start?.column ?? 1,
    };
  }

  private parseValue(): ValueNode {
    const start = this.index;
    const token = this.current();
    if (!token) return { type: "other", line: 1, column: 1 };
    if (token.kind === "punct" && token.value === "[") return this.parseArray();
    if (token.kind === "punct" && token.value === "{") return this.parseObject();
    if (token.kind === "string" || token.kind === "number") {
      this.bump();
      return { type: "primitive", line: token.line, column: token.column };
    }
    if (
      token.kind === "ident" &&
      (token.value === "true" ||
        token.value === "false" ||
        token.value === "null" ||
        token.value === "undefined")
    ) {
      this.bump();
      return { type: "primitive", line: token.line, column: token.column };
    }
    if (token.kind === "punct" && token.value === "-") {
      const number = this.tokens[this.index + 1];
      if (number?.kind === "number") {
        this.index += 2;
        return { type: "primitive", line: token.line, column: token.column };
      }
    }
    this.bump();
    this.skipTrailingCall();
    if (this.index === start) this.index += 1;
    return { type: "other", line: token.line, column: token.column };
  }

  private skipTrailingCall(): void {
    for (;;) {
      const token = this.current();
      if (!token || token.kind !== "punct") break;
      if (token.value === ".") {
        this.bump();
        this.bump();
        continue;
      }
      if (token.value === "(") {
        this.skipBalanced("(", ")");
        continue;
      }
      if (token.value === "[") {
        this.skipBalanced("[", "]");
        continue;
      }
      if (token.value === "=>") {
        this.bump();
        if (this.current()?.value === "{") this.skipBalanced("{", "}");
        else this.parseValue();
        continue;
      }
      break;
    }
  }

  private skipBalanced(open: string, close: string): void {
    const first = this.current();
    if (!first || first.value !== open) return;
    this.bump();
    let depth = 1;
    while (this.current() && depth > 0) {
      const token = this.bump();
      if (!token) break;
      if (token.value === open) depth += 1;
      else if (token.value === close) depth -= 1;
    }
  }

  private current(): Token | undefined {
    return this.tokens[this.index];
  }

  private bump(): Token | undefined {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }
}

function lex(source: string): { tokens: Token[]; strings: TextHit[] } {
  const tokens: Token[] = [];
  const strings: TextHit[] = [];
  let index = 0;
  let line = 1;
  let column = 1;

  const pushPunct = (value: string, atLine: number, atColumn: number) => {
    tokens.push({ kind: "punct", value, line: atLine, column: atColumn });
  };

  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === "\n") {
      index += 1;
      line += 1;
      column = 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    if (char === " " || char === "\t") {
      index += 1;
      column += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
        column += 1;
      }
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      index += 2;
      column += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") {
          line += 1;
          column = 1;
        } else {
          column += 1;
        }
        index += 1;
      }
      index += 2;
      column += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      const startLine = line;
      const startColumn = column;
      const value = readQuoted(source, index, char);
      strings.push({ value: value.text, line: startLine, column: startColumn });
      tokens.push({
        kind: "string",
        value: value.text,
        line: startLine,
        column: startColumn,
      });
      line = value.line;
      column = value.column;
      index = value.index;
      continue;
    }
    if (char === "`") {
      const startLine = line;
      const startColumn = column;
      const value = readTemplate(source, index);
      if (value.text.trim()) {
        strings.push({ value: value.text, line: startLine, column: startColumn });
      }
      tokens.push({
        kind: "string",
        value: value.text,
        line: startLine,
        column: startColumn,
      });
      line = value.line;
      column = value.column;
      index = value.index;
      continue;
    }
    if (char >= "0" && char <= "9") {
      const startColumn = column;
      let end = index + 1;
      while (end < source.length && /[0-9._]/.test(source[end] ?? "")) end += 1;
      const value = source.slice(index, end);
      tokens.push({ kind: "number", value, line, column: startColumn });
      column += end - index;
      index = end;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const startColumn = column;
      let end = index + 1;
      while (end < source.length && /[A-Za-z0-9_$]/.test(source[end] ?? "")) end += 1;
      const value = source.slice(index, end);
      tokens.push({ kind: "ident", value, line, column: startColumn });
      column += end - index;
      index = end;
      continue;
    }
    const startColumn = column;
    if (char === "=" && source[index + 1] === ">") {
      pushPunct("=>", line, startColumn);
      index += 2;
      column += 2;
      continue;
    }
    if (char === "&" && source[index + 1] === "&") {
      pushPunct("&&", line, startColumn);
      index += 2;
      column += 2;
      continue;
    }
    if (char === "|" && source[index + 1] === "|") {
      pushPunct("||", line, startColumn);
      index += 2;
      column += 2;
      continue;
    }
    pushPunct(char, line, startColumn);
    index += 1;
    column += 1;
  }
  return { tokens, strings };
}

function readQuoted(
  source: string,
  start: number,
  quote: string,
): { text: string; index: number; line: number; column: number } {
  let index = start + 1;
  let line = 1;
  let column = 1;
  const origin = locate(source, start);
  line = origin.line;
  column = origin.column + 1;
  let text = "";
  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === "\\") {
      const escaped = source[index + 1] ?? "";
      text += escaped === "n" ? "\n" : escaped;
      index += 2;
      column += 2;
      continue;
    }
    if (char === quote) {
      index += 1;
      column += 1;
      break;
    }
    if (char === "\n") {
      text += char;
      index += 1;
      line += 1;
      column = 1;
      continue;
    }
    text += char;
    index += 1;
    column += 1;
  }
  return { text, index, line, column };
}

function readTemplate(
  source: string,
  start: number,
): { text: string; index: number; line: number; column: number } {
  let index = start + 1;
  const origin = locate(source, start);
  let line = origin.line;
  let column = origin.column + 1;
  let text = "";
  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === "\\") {
      text += source[index + 1] ?? "";
      index += 2;
      column += 2;
      continue;
    }
    if (char === "`") {
      index += 1;
      column += 1;
      break;
    }
    if (char === "\n") {
      text += char;
      index += 1;
      line += 1;
      column = 1;
      continue;
    }
    text += char;
    index += 1;
    column += 1;
  }
  return { text, index, line, column };
}

function locate(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}
