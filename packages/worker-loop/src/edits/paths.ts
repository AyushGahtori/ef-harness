import fs from "node:fs";
import path from "node:path";
import { PathEscapeDeniedError, ProtectedPathError } from "./errors.js";
import { normalizePosix } from "./scope.js";

export interface ResolvedEditPath {
  readonly absolutePath: string;
  readonly relativePath: string;
}

function assertInside(rootReal: string, candidate: string, requested: string): string {
  const relative = path.relative(rootReal, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathEscapeDeniedError(requested, "realpath escapes the worktree");
  }
  const posix = normalizePosix(relative);
  const segments = posix.split("/");
  if (
    segments.some((segment) => {
      const lower = segment.toLowerCase();
      return lower === ".git" || lower === ".harness" || lower === "node_modules";
    })
  ) {
    throw new ProtectedPathError(posix);
  }
  return posix;
}

function existingAncestor(target: string): { readonly ancestor: string; readonly missing: readonly string[] } {
  const missing: string[] = [];
  let current = target;
  while (!fs.existsSync(current)) {
    const base = path.basename(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(base);
    current = parent;
  }
  return { ancestor: current, missing };
}

export function resolveEditPath(worktreePath: string, requested: string): ResolvedEditPath {
  if (requested.trim() === "") {
    throw new PathEscapeDeniedError(requested, "empty path");
  }
  if (requested.includes("\0")) {
    throw new PathEscapeDeniedError(requested, "null byte");
  }
  const rootReal = fs.realpathSync(worktreePath);
  const worktreeResolved = path.resolve(worktreePath);
  const absolute = path.resolve(rootReal, requested);
  const lexicalFromReal = path.relative(rootReal, absolute);
  const lexicalFromWorktree = path.relative(worktreeResolved, absolute);
  const escapesReal = lexicalFromReal.startsWith("..") || path.isAbsolute(lexicalFromReal);
  const escapesWorktree = lexicalFromWorktree.startsWith("..") || path.isAbsolute(lexicalFromWorktree);
  if (escapesReal && escapesWorktree) {
    throw new PathEscapeDeniedError(requested, "path escapes the worktree");
  }
  if (fs.existsSync(absolute)) {
    const realFile = fs.realpathSync(absolute);
    const relativePath = assertInside(rootReal, realFile, requested);
    return { absolutePath: realFile, relativePath };
  }
  const { ancestor, missing } = existingAncestor(absolute);
  const realAncestor = fs.realpathSync(ancestor);
  const relativeAncestor = path.relative(rootReal, realAncestor);
  if (relativeAncestor.startsWith("..") || path.isAbsolute(relativeAncestor)) {
    throw new PathEscapeDeniedError(requested, "realpath escapes the worktree");
  }
  const realFile = path.join(realAncestor, ...missing);
  const relativePath = assertInside(rootReal, realFile, requested);
  return { absolutePath: realFile, relativePath };
}
