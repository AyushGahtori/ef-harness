import path from "node:path";
import { TierBError } from "./errors.js";

const DOT_DOT = "..";

export function containsDotDotSegment(input: string): boolean {
  return input.split(/[\\/]/).some((segment) => segment === DOT_DOT);
}

export function isUncPath(input: string): boolean {
  return input.startsWith("\\\\") || input.startsWith("//");
}

export function comparablePath(input: string): string {
  const normalized = path.normalize(path.resolve(input));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isSameOrInside(child: string, parent: string): boolean {
  const left = comparablePath(child);
  const right = comparablePath(parent);
  return left === right || left.startsWith(right.endsWith(path.sep) ? right : `${right}${path.sep}`);
}

export function canonicalizeAbsolute(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new TierBError("path_empty", "Path is empty");
  }
  if (containsDotDotSegment(input)) {
    throw new TierBError("path_traversal", `Path contains a parent segment: ${input}`);
  }
  if (isUncPath(input)) {
    throw new TierBError("unc_path", `UNC paths cannot take Tier B ACLs: ${input}`);
  }
  if (!path.isAbsolute(input)) {
    throw new TierBError("path_not_absolute", `Path is not absolute: ${input}`);
  }
  const resolved = path.resolve(input);
  if (containsDotDotSegment(resolved) || isUncPath(resolved)) {
    throw new TierBError("path_traversal", `Path resolved outside its root: ${input}`);
  }
  return resolved;
}
