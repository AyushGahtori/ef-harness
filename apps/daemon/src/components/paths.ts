import path from "node:path";
import { UnsafeArchivePathError, UnsafeComponentIdError } from "./errors.js";

const COMPONENT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function assertSafeComponentId(componentId: string): void {
  if (!COMPONENT_ID.test(componentId) || componentId.includes("..")) {
    throw new UnsafeComponentIdError(componentId);
  }
}

export function assertSafeRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new UnsafeArchivePathError(relativePath);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new UnsafeArchivePathError(relativePath);
  }
  return parts.join("/");
}

export function safeChildPath(root: string, relativePath: string): string {
  const safe = assertSafeRelativePath(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...safe.split("/"));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new UnsafeArchivePathError(relativePath);
  }
  return resolved;
}
