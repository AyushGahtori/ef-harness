import fs from "node:fs";
import path from "node:path";

interface GitignoreRule {
  readonly negation: boolean;
  readonly directoryOnly: boolean;
  readonly regex: RegExp;
}

export function loadGitignore(root: string): readonly GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  collect(root, root, rules);
  return rules;
}

export function isGitignored(rules: readonly GitignoreRule[], relativePath: string, isDirectory: boolean): boolean {
  const posix = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) {
      if (!matchesParentDirectory(rule, posix)) continue;
      ignored = !rule.negation;
      continue;
    }
    if (!rule.regex.test(posix)) continue;
    ignored = !rule.negation;
  }
  return ignored;
}

function collect(root: string, directory: string, rules: GitignoreRule[]): void {
  const file = path.join(directory, ".gitignore");
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const prefix = path.relative(root, directory).replaceAll("\\", "/");
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const compiled = compileRule(line, prefix);
      if (compiled) rules.push(compiled);
    }
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error) return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    collect(root, path.join(directory, entry.name), rules);
  }
}

function compileRule(rawLine: string, directoryPrefix: string): GitignoreRule | null {
  let line = rawLine.trim();
  if (line.length === 0 || line.startsWith("#")) return null;
  let negation = false;
  if (line.startsWith("!")) {
    negation = true;
    line = line.slice(1);
  }
  let directoryOnly = false;
  if (line.endsWith("/")) {
    directoryOnly = true;
    line = line.slice(0, -1);
  }
  const anchored = line.startsWith("/");
  if (anchored) line = line.slice(1);
  const containsSlash = line.includes("/");
  const body = globToRegExpBody(line);
  const prefix = directoryPrefix.length > 0 ? `${escapeRegex(directoryPrefix)}/` : "";
  let source: string;
  if (anchored || containsSlash) {
    source = `^${prefix}${body}$`;
  } else {
    source = `^${prefix}(?:.+\/)?${body}$`;
  }
  return { negation, directoryOnly, regex: new RegExp(source) };
}

function matchesParentDirectory(rule: GitignoreRule, posixPath: string): boolean {
  const parts = posixPath.split("/");
  let accumulated = "";
  for (let index = 0; index < parts.length - 1; index += 1) {
    accumulated = accumulated.length === 0 ? (parts[index] ?? "") : `${accumulated}/${parts[index] ?? ""}`;
    if (rule.regex.test(accumulated)) return true;
  }
  return false;
}

export function matchGlob(glob: string, relativePath: string): boolean {
  const normalizedGlob = glob.replaceAll("\\", "/").replace(/^\.\//, "");
  const normalizedPath = relativePath.replaceAll("\\", "/");
  if (normalizedGlob.length === 0 || normalizedGlob === "**" || normalizedGlob === "**/*") return true;
  const source = `^${globToRegExpBody(normalizedGlob)}$`;
  return new RegExp(source).test(normalizedPath);
}

function globToRegExpBody(pattern: string): string {
  let body = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const current = pattern[index] ?? "";
    if (current === "*") {
      if (pattern[index + 1] === "*") {
        if (pattern[index + 2] === "/") {
          body += "(?:.*/)?";
          index += 2;
          continue;
        }
        body += ".*";
        index += 1;
        continue;
      }
      body += "[^/]*";
      continue;
    }
    if (current === "?") {
      body += "[^/]";
      continue;
    }
    body += escapeRegex(current);
  }
  return body;
}

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}
