import path from "node:path";
import { MxcPolicyPathError } from "./errors.js";

const DOT_DOT = "..";

export function containsDotDotSegment(input: string): boolean {
  return input.split(/[\\/]/).some((segment) => segment === DOT_DOT);
}

function isDriveOrUnc(input: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(input) || input.startsWith("\\\\");
}

export function platformPath(input: string): path.PlatformPath {
  if (process.platform === "win32" || isDriveOrUnc(input)) return path.win32;
  return path;
}

export function comparablePath(input: string): string {
  const api = platformPath(input);
  const normalized = api.normalize(api.resolve(input));
  return api === path.win32 ? normalized.toLowerCase() : normalized;
}

export function isSameOrInside(child: string, parent: string): boolean {
  const api = platformPath(child);
  const left = comparablePath(child);
  const right = comparablePath(parent);
  const separator = api.sep;
  return left === right || left.startsWith(right.endsWith(separator) ? right : `${right}${separator}`);
}

export function canonicalizeAbsolute(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new MxcPolicyPathError("path_empty", String(input));
  }
  if (containsDotDotSegment(input)) {
    throw new MxcPolicyPathError("path_traversal", input);
  }
  const api = platformPath(input);
  if (!api.isAbsolute(input)) {
    throw new MxcPolicyPathError("path_not_absolute", input);
  }
  const resolved = api.resolve(input);
  if (containsDotDotSegment(resolved)) {
    throw new MxcPolicyPathError("path_traversal", input);
  }
  return resolved;
}

export function assertSafeTempDir(
  tempDir: string,
  bounds: { readonly worktree: string; readonly developerCheckout: string },
): string {
  const temp = canonicalizeAbsolute(tempDir);
  const root = path.parse(temp).root;
  if (comparablePath(temp) === comparablePath(root)) {
    throw new MxcPolicyPathError("temp_is_drive_root", temp);
  }
  if (comparablePath(temp) === comparablePath(bounds.worktree)) {
    throw new MxcPolicyPathError("temp_is_worktree", temp);
  }
  if (isSameOrInside(bounds.worktree, temp)) {
    throw new MxcPolicyPathError("temp_contains_worktree", temp);
  }
  if (isSameOrInside(temp, bounds.developerCheckout)) {
    throw new MxcPolicyPathError("temp_inside_checkout", temp);
  }
  return temp;
}
