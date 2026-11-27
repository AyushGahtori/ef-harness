export class YamlSyntaxError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(`YAML line ${line}: ${message}`);
    this.name = "YamlSyntaxError";
    this.line = line;
  }
}

interface YamlLine {
  readonly number: number;
  readonly indent: number;
  readonly content: string;
}

function stripComment(input: string): string {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index] ?? "";
    if (quote === '"') {
      if (ch === "\\") {
        index += 1;
        continue;
      }
      if (ch === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#") return input.slice(0, index);
  }
  return input;
}

function tokenize(source: string): YamlLine[] {
  const raw = source.split(/\r?\n/);
  const lines: YamlLine[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const original = raw[index] ?? "";
    if (/^\s*$/.test(original) || /^\s*#/.test(original)) continue;
    if (/^\t/.test(original) || /^\s*\t/.test(original)) {
      throw new YamlSyntaxError(index + 1, "tabs are not allowed in indentation");
    }
    const indent = /^ */.exec(original)?.[0].length ?? 0;
    const content = stripComment(original.slice(indent)).trim();
    if (!content) continue;
    lines.push({ number: index + 1, indent, content });
  }
  return lines;
}

function unquote(value: string, line: number): string {
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote) {
    throw new YamlSyntaxError(line, "unterminated string");
  }
  const body = value.slice(1, -1);
  if (quote === "'") return body.replaceAll("''", "'");
  return body
    .replaceAll("\\n", "\n")
    .replaceAll("\\t", "\t")
    .replaceAll('\\"', '"')
    .replaceAll("\\\\", "\\");
}

function parseFlowArray(value: string, line: number): unknown[] {
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  return splitFlow(inner).map((part) => parseScalar(part.trim(), line));
}

function splitFlow(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index] ?? "";
    if (quote) {
      current += ch;
      if (ch === "\\" && quote === '"') {
        current += input[index + 1] ?? "";
        index += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseScalar(raw: string, line: number): unknown {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~" || value === "Null" || value === "NULL") return null;
  if (value === "{}") return {};
  if (value === "[]") return [];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return unquote(value, line);
  }
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) return parseFlowArray(value, line);
  return value;
}

function splitKey(content: string, line: number): { key: string; rest: string | null } {
  let index = 0;
  let key = "";
  if (content.startsWith('"') || content.startsWith("'")) {
    const quote = content[0] === "'" ? "'" : '"';
    index = 1;
    while (index < content.length) {
      const ch = content[index] ?? "";
      if (quote === '"' && ch === "\\") {
        key += content[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (ch === quote) break;
      key += ch;
      index += 1;
    }
    if ((content[index] ?? "") !== quote) throw new YamlSyntaxError(line, "unterminated quoted key");
    index += 1;
    if ((content[index] ?? "") !== ":") throw new YamlSyntaxError(line, "expected ':' after key");
    index += 1;
  } else {
    const colon = content.indexOf(":");
    if (colon < 0) throw new YamlSyntaxError(line, `expected ':' in "${content}"`);
    key = content.slice(0, colon).trim();
    if (!key) throw new YamlSyntaxError(line, "missing key");
    index = colon + 1;
  }
  const rest = content.slice(index).trim();
  return { key, rest: rest.length === 0 ? null : rest };
}

function readLiteral(
  lines: readonly YamlLine[],
  index: number,
  parentIndent: number,
  folded: boolean,
): { value: string; index: number } {
  const collected: string[] = [];
  let contentIndent: number | null = null;
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (!line || line.indent <= parentIndent) break;
    if (contentIndent === null) contentIndent = line.indent;
    if (line.indent < contentIndent) break;
    collected.push(`${" ".repeat(line.indent - contentIndent)}${line.content}`);
    cursor += 1;
  }
  const value = folded ? collected.join(" ").replace(/\s+/g, " ").trim() : collected.join("\n");
  return { value, index: cursor };
}

function parseBlock(lines: readonly YamlLine[], index: number, parentIndent: number): { value: unknown; index: number } {
  const line = lines[index];
  if (!line || line.indent <= parentIndent) return { value: null, index };
  if (line.content.startsWith("- ")) return parseSequence(lines, index, line.indent);
  return parseMapping(lines, index, line.indent);
}

function parseMapping(
  lines: readonly YamlLine[],
  index: number,
  indent: number,
): { value: Record<string, unknown>; index: number } {
  const obj: Record<string, unknown> = {};
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (!line || line.indent < indent) break;
    if (line.indent > indent) throw new YamlSyntaxError(line.number, "unexpected indentation");
    if (line.content.startsWith("- ")) break;
    const { key, rest } = splitKey(line.content, line.number);
    cursor += 1;
    if (rest === null) {
      const next = lines[cursor];
      if (next && next.indent > indent) {
        const nested = parseBlock(lines, cursor, indent);
        obj[key] = nested.value;
        cursor = nested.index;
      } else {
        obj[key] = null;
      }
    } else if (rest === "|" || rest === "|-" || rest === ">" || rest === ">-") {
      const block = readLiteral(lines, cursor, indent, rest.startsWith(">"));
      obj[key] = block.value;
      cursor = block.index;
    } else {
      obj[key] = parseScalar(rest, line.number);
    }
  }
  return { value: obj, index: cursor };
}

function parseSequence(lines: readonly YamlLine[], index: number, indent: number): { value: unknown[]; index: number } {
  const items: unknown[] = [];
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (!line || line.indent < indent) break;
    if (line.indent > indent) throw new YamlSyntaxError(line.number, "unexpected indentation");
    if (!line.content.startsWith("- ")) break;
    const rest = line.content.slice(2).trim();
    cursor += 1;
    if (rest === "") {
      const nested = parseBlock(lines, cursor, indent);
      items.push(nested.value);
      cursor = nested.index;
      continue;
    }
    if (rest.startsWith("- ")) {
      throw new YamlSyntaxError(line.number, "nested sequence item must be on the following line");
    }
    if (rest.includes(":") && !rest.startsWith('"') && !rest.startsWith("'") && !/^https?:/.test(rest)) {
      const { key, rest: value } = splitKey(rest, line.number);
      const obj: Record<string, unknown> = {};
      if (value === null) {
        const nested = parseBlock(lines, cursor, indent);
        obj[key] = nested.value;
        cursor = nested.index;
      } else if (value === "|" || value === "|-" || value === ">" || value === ">-") {
        const block = readLiteral(lines, cursor, indent, value.startsWith(">"));
        obj[key] = block.value;
        cursor = block.index;
      } else {
        obj[key] = parseScalar(value, line.number);
      }
      const more = lines[cursor];
      if (more && more.indent > indent && !more.content.startsWith("- ")) {
        const nested = parseMapping(lines, cursor, more.indent);
        Object.assign(obj, nested.value);
        cursor = nested.index;
      }
      items.push(obj);
      continue;
    }
    items.push(parseScalar(rest, line.number));
  }
  return { value: items, index: cursor };
}

/** Indentation YAML subset sufficient for OpenAPI fixtures. No network and no extra package. */
export function parseYaml(source: string): unknown {
  const lines = tokenize(source);
  if (lines.length === 0) return null;
  const parsed = parseBlock(lines, 0, -1);
  if (parsed.index < lines.length) {
    const line = lines[parsed.index];
    throw new YamlSyntaxError(line?.number ?? 1, "unexpected content");
  }
  return parsed.value;
}

export function lineOfIndex(text: string, index: number): number {
  let line = 1;
  const end = Math.min(index, text.length);
  for (let cursor = 0; cursor < end; cursor += 1) {
    if (text[cursor] === "\n") line += 1;
  }
  return line;
}
