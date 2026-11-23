import { realpathSync } from "node:fs";
import path from "node:path";

const SECRET_SEGMENTS = new Set([".ssh", ".cursor", ".aws", ".gnupg", ".claude", ".codex", ".gemini"]);
const HOST_DATABASES = new Set(["state.db", "global.db"]);
const LOCKFILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);

export interface ResolvedWorktreePath {
  readonly requested: string;
  readonly absolute: string;
  readonly relative: string | null;
  readonly containment: "inside" | "symlink_escape" | "outside";
  readonly secretHome: boolean;
  readonly hostDatabase: boolean;
  readonly gitMetadata: boolean;
  readonly lockfile: boolean;
}

export function defaultRealpath(target: string): string {
  return realpathSync.native(target);
}

export function resolveWorktreePath(
  requested: string,
  options: {
    readonly worktree: string;
    readonly homeDir: string;
    readonly realpath?: (target: string) => string;
  },
): ResolvedWorktreePath {
  const realpath = options.realpath ?? defaultRealpath;
  const rootLexical = path.resolve(options.worktree);
  const root = canonicalize(rootLexical, realpath);
  const expanded = expandHome(requested, options.homeDir);
  const lexical = path.resolve(rootLexical, expanded);
  const secret = hasSecretSegment(requested) || hasSecretSegment(expanded) || hasSecretSegment(lexical);
  if (secret) {
    return {
      requested,
      absolute: lexical,
      relative: null,
      containment: "outside",
      secretHome: true,
      hostDatabase: isHostDatabase(lexical),
      gitMetadata: false,
      lockfile: isLockfile(lexical),
    };
  }
  const absolute = canonicalize(lexical, realpath);
  const inside = isInside(root, absolute);
  const lexicalInside = isInside(root, lexical) || isInside(rootLexical, lexical);
  const containment = inside ? "inside" : lexicalInside ? "symlink_escape" : "outside";
  const relative = inside ? path.relative(root, absolute).replaceAll("\\", "/") : null;
  return {
    requested,
    absolute,
    relative,
    containment,
    secretHome: hasSecretSegment(absolute),
    hostDatabase: isHostDatabase(absolute) || isHostDatabase(requested),
    gitMetadata: hasSegment(absolute, ".git") || (relative ? hasSegment(relative, ".git") : false),
    lockfile: isLockfile(absolute),
  };
}

export function matchesWriteScope(relativePosix: string, globs: readonly string[]): boolean {
  const folded = relativePosix.replaceAll("\\", "/").toLowerCase();
  return globs.some((glob) => globMatch(glob, folded));
}

export function assertInsideWorktree(target: string, worktree: string): void {
  const root = path.resolve(worktree);
  const resolved = path.resolve(target);
  if (!isInside(root, resolved)) {
    throw new Error(`Path escapes the attempt worktree: ${target}`);
  }
}

export function isInsideCursorHome(target: string, cursorHome: string): boolean {
  return isInside(path.resolve(cursorHome), path.resolve(target));
}

function expandHome(requested: string, homeDir: string): string {
  if (requested === "~") return homeDir;
  if (requested.startsWith("~/") || requested.startsWith("~\\")) {
    return path.join(homeDir, requested.slice(2));
  }
  return requested;
}

function canonicalize(target: string, realpath: (value: string) => string): string {
  const normalized = path.normalize(target);
  const suffix: string[] = [];
  let current = normalized;
  for (;;) {
    try {
      const real = path.normalize(realpath(current));
      return suffix.length === 0 ? real : path.normalize(path.join(real, ...suffix));
    } catch (error) {
      if (!isMissing(error) || suffix.length > 32) return normalized;
      const parent = path.dirname(current);
      if (parent === current) return normalized;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { readonly code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(fold(root), fold(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function fold(value: string): string {
  return value.replaceAll("/", "\\").toLowerCase();
}

function hasSecretSegment(value: string): boolean {
  return value.split(/[\\/]+/).some((segment) => SECRET_SEGMENTS.has(segment.toLowerCase()));
}

function hasSegment(value: string, expected: string): boolean {
  return value.split(/[\\/]+/).some((segment) => segment.toLowerCase() === expected);
}

function isHostDatabase(value: string): boolean {
  return HOST_DATABASES.has(path.basename(value).toLowerCase());
}

function isLockfile(value: string): boolean {
  return LOCKFILES.has(path.basename(value).toLowerCase());
}

function globMatch(pattern: string, value: string): boolean {
  const source = pattern.replaceAll("\\", "/").toLowerCase();
  let expression = "^";
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("**/", index)) {
      expression += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (source.startsWith("**", index)) {
      expression += ".*";
      index += 2;
      continue;
    }
    const char = source[index];
    if (char === "*") {
      expression += "[^/]*";
      index += 1;
      continue;
    }
    if (char && ".+^${}()|[]\\".includes(char)) expression += `\\${char}`;
    else if (char) expression += char;
    index += 1;
  }
  expression += "$";
  return new RegExp(expression).test(value);
}
