const KEYWORDS = new Set([
  "const",
  "let",
  "function",
  "return",
  "import",
  "export",
  "if",
  "else",
  "class",
  "type",
  "interface",
  "true",
  "false",
  "null",
]);

export interface HighlightToken {
  readonly text: string;
  readonly kind: string;
}

export function highlightLine(line: string): readonly HighlightToken[] {
  const tokens: HighlightToken[] = [];
  let index = 0;
  while (index < line.length) {
    const ch = line[index];
    if (ch === undefined) break;
    if (ch === '"' || ch === "'") {
      let end = index + 1;
      while (end < line.length && line[end] !== ch) end += 1;
      if (end < line.length) end += 1;
      tokens.push({ text: line.slice(index, end), kind: "string" });
      index = end;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      let end = index + 1;
      while (end < line.length) {
        const digit = line[end];
        if (digit === undefined || digit < "0" || digit > "9") break;
        end += 1;
      }
      tokens.push({ text: line.slice(index, end), kind: "number" });
      index = end;
      continue;
    }
    if (isIdentStart(ch)) {
      let end = index + 1;
      while (end < line.length && isIdentPart(line[end] ?? "")) end += 1;
      const word = line.slice(index, end);
      tokens.push({ text: word, kind: KEYWORDS.has(word) ? "keyword" : "ident" });
      index = end;
      continue;
    }
    tokens.push({ text: ch, kind: "plain" });
    index += 1;
  }
  return tokens;
}

function isIdentStart(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_";
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

export function lineClass(line: string): "add" | "del" | "context" {
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}
