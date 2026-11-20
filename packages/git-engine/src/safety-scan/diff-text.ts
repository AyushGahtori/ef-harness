export interface DiffAddedLine {
  readonly line: number;
  readonly text: string;
}

export interface DiffFile {
  readonly path: string;
  readonly added: readonly DiffAddedLine[];
  readonly binary: boolean;
}

interface MutableDiffFile {
  path: string;
  added: DiffAddedLine[];
  binary: boolean;
}

function unquoteGit(token: string): string {
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
    return token
      .slice(1, -1)
      .replaceAll('\\"', '"')
      .replaceAll("\\\\", "\\");
  }
  return token;
}

function splitGitTokens(body: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }
    if (character === " " && !quoted) {
      if (current.length > 0) tokens.push(current);
      current = "";
      continue;
    }
    current += character ?? "";
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function diffPath(header: string): string {
  const body = header.slice("diff --git ".length).trim();
  const parts = splitGitTokens(body);
  const right = parts[1] ?? parts[0] ?? "unknown";
  return unquoteGit(right).replace(/^(?:a|b)\//, "");
}

export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: MutableDiffFile[] = [];
  let current: MutableDiffFile | undefined;
  let nextLine = 1;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      if (current) files.push(current);
      current = { path: diffPath(line), added: [], binary: false };
      nextLine = 1;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("Binary files ")) {
      current.binary = true;
      continue;
    }
    if (line.startsWith("@@")) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      const start = hunk?.[1];
      nextLine = start ? Number(start) : 1;
      continue;
    }
    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("index ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("similarity ") ||
      line.startsWith("rename ") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode")
    ) {
      continue;
    }
    if (line.startsWith("+")) {
      current.added.push({ line: nextLine, text: line.slice(1) });
      nextLine += 1;
      continue;
    }
    if (line.startsWith("-") || line.startsWith("\\")) continue;
    if (line.startsWith(" ")) nextLine += 1;
  }
  if (current) files.push(current);
  return files;
}

export function splitNulPaths(stdout: string): string[] {
  return stdout.split("\0").filter((item) => item.length > 0);
}
