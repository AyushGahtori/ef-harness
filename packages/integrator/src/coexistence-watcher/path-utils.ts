import path from "node:path";
import { IGNORED_WATCH_GLOBS, IGNORED_WATCH_SEGMENTS, VIEWS_EXPORT_ROOT } from "./constants.js";

export interface PathNormalizeOptions {
  readonly platform?: NodeJS.Platform;
}

export function normalizeRepoRelative(
  repoRoot: string,
  absoluteOrRelative: string,
  options: PathNormalizeOptions = {},
): string | null {
  const platform = options.platform ?? process.platform;
  const absolute = path.isAbsolute(absoluteOrRelative)
    ? absoluteOrRelative
    : path.join(repoRoot, absoluteOrRelative);
  const relative = path.relative(repoRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const posix = relative.split(path.sep).join("/");
  return platform === "win32" ? posix.toLowerCase() : posix;
}

export function shouldIgnoreWatchPath(repoRelative: string): boolean {
  const segments = repoRelative.split("/");
  for (const segment of segments) {
    if ((IGNORED_WATCH_SEGMENTS as readonly string[]).includes(segment)) return true;
    if (segment === ".git" && segments.length > 1 && segments[0] !== ".git") return true;
  }
  if (repoRelative === VIEWS_EXPORT_ROOT || repoRelative.startsWith(`${VIEWS_EXPORT_ROOT}/`)) {
    return true;
  }
  const base = segments[segments.length - 1] ?? repoRelative;
  for (const pattern of IGNORED_WATCH_GLOBS) {
    if (matchSimpleGlob(base, pattern)) return true;
  }
  return false;
}

function matchSimpleGlob(name: string, pattern: string): boolean {
  if (pattern === name) return true;
  if (pattern.startsWith("*") && pattern.endsWith("*") && pattern.length > 2) {
    return name.includes(pattern.slice(1, -1));
  }
  if (pattern.startsWith("*.")) {
    return name.endsWith(pattern.slice(1));
  }
  if (pattern.startsWith(".#")) {
    return name.startsWith(".#");
  }
  if (pattern.endsWith("*") && !pattern.includes("*", 0)) {
    return name.startsWith(pattern.slice(0, -1));
  }
  return false;
}

export function isGitMetaPath(repoRelative: string): boolean {
  return (
    repoRelative === ".git/head" ||
    repoRelative.startsWith(".git/refs/heads/") ||
    repoRelative.startsWith(".git/refs/remotes/")
  );
}

export function lockfileBasename(repoRelative: string): string | null {
  const base = repoRelative.split("/").pop() ?? "";
  if (base === "package.json" || base === "pnpm-lock.yaml" || base === "package-lock.json" || base === "yarn.lock") {
    return base;
  }
  return null;
}