import path from "node:path";

import { Phase0Error } from "./errors.js";

export function normalizeRel(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function assertRepoRelative(rel: string): string {
  const normalized = normalizeRel(rel);
  if (normalized === "" || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new Phase0Error("unsafe_path", `Refusing absolute path ${rel}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === "")) {
    throw new Phase0Error("unsafe_path", `Refusing path ${rel}`);
  }
  return normalized;
}

export function pathMatchesScope(file: string, scope: string): boolean {
  const target = foldPath(normalizeRel(file));
  const pattern = foldPath(normalizeRel(scope));
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3).replace(/\/$/, "");
    return target === prefix || target.startsWith(`${prefix}/`);
  }
  if (pattern.endsWith("/")) {
    const prefix = pattern.slice(0, -1);
    return target === prefix || target.startsWith(`${prefix}/`);
  }
  return target === pattern;
}

export function fileInScopes(file: string, scopes: readonly string[]): boolean {
  return scopes.some((scope) => pathMatchesScope(file, scope));
}

export function assertInsideRoot(root: string, rel: string): string {
  const safe = assertRepoRelative(rel);
  const rootResolved = path.resolve(root);
  const abs = path.resolve(rootResolved, safe);
  const relative = path.relative(rootResolved, abs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Phase0Error("unsafe_path", `Path escapes the worktree: ${rel}`);
  }
  return abs;
}

function foldPath(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function asScope(scope: string): { readonly kind: "file" | "dir"; readonly path: string } {
  const normalized = foldPath(normalizeRel(scope));
  if (normalized.endsWith("/**")) {
    return { kind: "dir", path: normalized.slice(0, -3).replace(/\/$/, "") };
  }
  if (normalized.endsWith("/")) {
    return { kind: "dir", path: normalized.slice(0, -1) };
  }
  return { kind: "file", path: normalized };
}

/** Case-sensitive disjointness. Phase 0 paths are authored with forward slashes. */
export function scopesOverlap(left: string, right: string): boolean {
  const a = asScope(left);
  const b = asScope(right);
  if (a.kind === "file" && b.kind === "file") return a.path === b.path;
  if (a.kind === "dir" && b.kind === "dir") {
    return a.path === b.path || a.path.startsWith(`${b.path}/`) || b.path.startsWith(`${a.path}/`);
  }
  const file = a.kind === "file" ? a : b;
  const dir = a.kind === "dir" ? a : b;
  return file.path === dir.path || file.path.startsWith(`${dir.path}/`);
}
