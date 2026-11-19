export interface IgnorePattern {
  readonly negation: boolean;
  readonly directoryOnly: boolean;
  readonly regex: RegExp;
}

function escapeLiteral(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globBodyToRegExp(body: string): string {
  let source = "";
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "*") {
      if (body[index + 1] === "*") {
        if (body[index + 2] === "/") {
          source += "(?:.*/)?";
          index += 2;
          continue;
        }
        source += ".*";
        index += 1;
        continue;
      }
      source += "[^/]*";
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    if (character === "[") {
      const end = body.indexOf("]", index + 1);
      if (end > index + 1) {
        source += `[${body.slice(index + 1, end)}]`;
        index = end;
        continue;
      }
    }
    source += escapeLiteral(character ?? "");
  }
  return source;
}

export function parseIgnoreText(text: string): IgnorePattern[] {
  const patterns: IgnorePattern[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("\\#")) continue;
    let working = line;
    let negation = false;
    if (working.startsWith("!")) {
      negation = true;
      working = working.slice(1);
    }
    let directoryOnly = false;
    if (working.endsWith("/")) {
      directoryOnly = true;
      working = working.slice(0, -1);
    }
    if (!working) continue;
    const anchored = working.startsWith("/") || working.slice(1).includes("/");
    if (working.startsWith("/")) working = working.slice(1);
    const body = globBodyToRegExp(working);
    const wrapped = anchored ? `^${body}(?:/.*)?$` : `(?:^|/)${body}(?:/.*)?$`;
    patterns.push({
      negation,
      directoryOnly,
      regex: new RegExp(wrapped),
    });
  }
  return patterns;
}

export class IgnoreRules {
  private readonly patterns: readonly IgnorePattern[];

  constructor(text: string) {
    this.patterns = parseIgnoreText(text);
  }

  ignores(relativePath: string, isDirectory: boolean): boolean {
    const value = relativePath
      .replaceAll("\\", "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+$/, "");
    if (!value || value === ".") return false;
    let ignored = false;
    for (const pattern of this.patterns) {
      if (!pattern.regex.test(value)) continue;
      const nested = value.includes("/");
      if (pattern.directoryOnly && !isDirectory && !nested) continue;
      ignored = !pattern.negation;
    }
    return ignored;
  }
}

export function normalizeIgnoreLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) return trimmed;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function unifiedDiff(before: string, after: string, fileName = ".gitignore"): string {
  if (before.replaceAll("\r\n", "\n") === after.replaceAll("\r\n", "\n")) return "";
  const left = before.replaceAll("\r\n", "\n").replace(/\n$/, "").split("\n");
  const right = after.replaceAll("\r\n", "\n").replace(/\n$/, "").split("\n");
  if (before.trim() === "" && after.trim() === "") return "";
  const leftLines = before.trim() === "" ? [] : left;
  const rightLines = after.trim() === "" ? [] : right;
  let start = 0;
  while (
    start < leftLines.length &&
    start < rightLines.length &&
    leftLines[start] === rightLines[start]
  ) {
    start += 1;
  }
  let leftEnd = leftLines.length;
  let rightEnd = rightLines.length;
  while (
    leftEnd > start &&
    rightEnd > start &&
    leftLines[leftEnd - 1] === rightLines[rightEnd - 1]
  ) {
    leftEnd -= 1;
    rightEnd -= 1;
  }
  const oldCount = leftEnd - start;
  const newCount = rightEnd - start;
  const oldStart = oldCount === 0 ? start : start + 1;
  const newStart = newCount === 0 ? start : start + 1;
  const lines = [
    `--- a/${fileName}`,
    `+++ b/${fileName}`,
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
  ];
  for (let index = start; index < leftEnd; index += 1) {
    lines.push(`-${leftLines[index] ?? ""}`);
  }
  for (let index = start; index < rightEnd; index += 1) {
    lines.push(`+${rightLines[index] ?? ""}`);
  }
  return `${lines.join("\n")}\n`;
}
