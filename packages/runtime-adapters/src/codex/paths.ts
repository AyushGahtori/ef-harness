import { realpathSync } from "node:fs";
import path from "node:path";

const CREDENTIAL_SEGMENTS = new Set([".ssh", ".aws", ".gnupg", ".claude", ".codex", ".gemini"]);

export function personalCodexDir(userHome: string): string {
  return path.resolve(userHome, ".codex");
}

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.normalize(root), path.normalize(target));
  if (relative === "") return true;
  if (relative.startsWith("..")) return false;
  if (path.isAbsolute(relative)) return false;
  return true;
}

export function isPersonalCodexPath(candidate: string, userHome: string): boolean {
  return isInside(personalCodexDir(userHome), path.resolve(candidate));
}

export function hasCredentialSegment(value: string): boolean {
  return value
    .split(/[\\/]+/)
    .some((segment) => CREDENTIAL_SEGMENTS.has(segment.toLowerCase()));
}

export function isSealedRelative(relativePosix: string): boolean {
  const posix = relativePosix.replaceAll("\\", "/").toLowerCase();
  if (posix === ".git" || posix.startsWith(".git/")) return true;
  if (posix === ".harness" || posix.startsWith(".harness/")) return true;
  const base = posix.split("/").pop() ?? posix;
  return base === "package-lock.json" || base === "pnpm-lock.yaml";
}

export function canonicalize(target: string, realpath: (value: string) => string): string {
  const normalized = path.normalize(target);
  const suffix: string[] = [];
  let current = normalized;
  for (;;) {
    try {
      const real = stripExtended(realpath(current));
      return suffix.length === 0 ? path.normalize(real) : path.normalize(path.join(real, ...suffix));
    } catch (error) {
      if (!isMissingPath(error) || suffix.length > 32) return path.normalize(normalized);
      const parent = path.dirname(current);
      if (parent === current) return path.normalize(normalized);
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

export function defaultRealpath(target: string): string {
  return realpathSync(target);
}

export function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

function stripExtended(value: string): string {
  return value.startsWith("\\\\?\\") ? value.slice(4) : value;
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
