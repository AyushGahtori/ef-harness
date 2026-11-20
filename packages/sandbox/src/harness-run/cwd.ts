import fs from "node:fs";
import path from "node:path";
import { CwdEscapeDeniedError } from "./errors.js";

export function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function isGitInternal(root: string, target: string): boolean {
  const relative = path.relative(root, target).replaceAll("\\", "/");
  return relative === ".git" || relative.startsWith(".git/");
}

export function resolveContainedCwd(worktreePath: string, cwd: string | undefined): string {
  const root = path.resolve(worktreePath);
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(root);
  } catch {
    throw new CwdEscapeDeniedError("worktree_missing", `worktree does not exist: ${root}`);
  }
  const requested = cwd === undefined || cwd === "" ? "." : cwd;
  const lexical = path.resolve(root, requested);
  if (!isPathInside(root, lexical)) {
    throw new CwdEscapeDeniedError(
      "path_escape",
      `cwd escapes the attempt worktree: ${requested}`,
    );
  }
  if (isGitInternal(root, lexical)) {
    throw new CwdEscapeDeniedError("git_internal", `cwd is inside .git: ${requested}`);
  }
  let real: string;
  try {
    real = fs.realpathSync(lexical);
  } catch {
    throw new CwdEscapeDeniedError("cwd_missing", `cwd does not exist: ${requested}`);
  }
  if (!isPathInside(rootReal, real)) {
    throw new CwdEscapeDeniedError(
      "symlink_escape",
      `cwd resolves outside the attempt worktree: ${requested}`,
    );
  }
  if (isGitInternal(rootReal, real)) {
    throw new CwdEscapeDeniedError("git_internal", `cwd resolves inside .git: ${requested}`);
  }
  return real;
}

export function resolveInsideWorktree(
  worktreePath: string,
  cwd: string,
  target: string,
): string | null {
  if (target === "&1") return target;
  const root = path.resolve(worktreePath);
  const lexical = path.resolve(cwd, target);
  if (!isPathInside(root, lexical) || isGitInternal(root, lexical)) return null;
  try {
    const real = fs.realpathSync(lexical);
    const rootReal = fs.realpathSync(root);
    if (!isPathInside(rootReal, real) || isGitInternal(rootReal, real)) return null;
    return real;
  } catch {
    const parent = path.dirname(lexical);
    try {
      const parentReal = fs.realpathSync(parent);
      const rootReal = fs.realpathSync(root);
      if (!isPathInside(rootReal, parentReal) || isGitInternal(rootReal, parentReal)) return null;
      const resolved = path.join(parentReal, path.basename(lexical));
      if (!isPathInside(rootReal, resolved) || isGitInternal(rootReal, resolved)) return null;
      return resolved;
    } catch {
      return null;
    }
  }
}
