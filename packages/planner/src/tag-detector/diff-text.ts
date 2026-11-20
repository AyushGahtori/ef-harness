export interface ParsedDiffFile {
  readonly path: string;
  readonly addedLines: readonly string[];
}

export function parseUnifiedDiff(diff: string): ParsedDiffFile[] {
  const files: { path: string; addedLines: string[] }[] = [];
  let current: { path: string; addedLines: string[] } | null = null;
  for (const line of diff.split(/\r?\n/)) {
    const git = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (git) {
      current = { path: (git[2] ?? git[1] ?? "").trim(), addedLines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4).trim();
      const path = raw.startsWith("b/") ? raw.slice(2) : raw;
      if (path !== "/dev/null") current.path = path;
      continue;
    }
    if (
      line.startsWith("--- ") ||
      line.startsWith("@@") ||
      line.startsWith("index ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("rename ") ||
      line.startsWith("similarity ") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode") ||
      line.startsWith("Binary ") ||
      line.startsWith("\\")
    ) {
      continue;
    }
    if (line.startsWith("+")) current.addedLines.push(line.slice(1));
  }
  return files.filter((file) => file.path.length > 0);
}

export function isTestOrFixturePath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  if (/(?:^|\/)(?:tests?|__tests__|fixtures?|__fixtures__|testdata)(?:\/|$)/i.test(normalized)) {
    return true;
  }
  return /\.(?:test|spec|fixture)\.[cm]?[jt]sx?$/i.test(normalized);
}

function extensionOf(filePath: string): string {
  const base = filePath.replaceAll("\\", "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Drop comments. String literals are preserved so imports and URLs stay visible. */
export function stripComments(source: string, filePath: string): string {
  const ext = extensionOf(filePath);
  if (ext === "sql") return stripSqlComments(source);
  if (ext === "py" || ext === "sh" || ext === "yml" || ext === "yaml" || ext === "rb") {
    return stripHashComments(source);
  }
  return stripJsComments(source);
}

export function blankStringLiterals(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i] ?? "";
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      out += quote;
      i += 1;
      while (i < source.length) {
        const ch = source[i] ?? "";
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === quote) {
          out += quote;
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function stripJsComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i] ?? "";
    const next = source[i + 1] ?? "";
    if (c === "/" && next === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < source.length) {
        const ch = source[i] ?? "";
        out += ch;
        i += 1;
        if (ch === "\\") {
          if (i < source.length) {
            out += source[i] ?? "";
            i += 1;
          }
          continue;
        }
        if (ch === quote) break;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function stripSqlComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i] ?? "";
    const next = source[i + 1] ?? "";
    if (c === "-" && next === "-") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }
    if (c === "'") {
      out += c;
      i += 1;
      while (i < source.length) {
        const ch = source[i] ?? "";
        out += ch;
        i += 1;
        if (ch === "'" && source[i] === "'") {
          out += source[i] ?? "";
          i += 1;
          continue;
        }
        if (ch === "'") break;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function stripHashComments(source: string): string {
  return source
    .split(/\r?\n/)
    .map((line) => {
      const hash = line.indexOf("#");
      if (hash < 0) return line;
      return line.slice(0, hash);
    })
    .join("\n");
}
