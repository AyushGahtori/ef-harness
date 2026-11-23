import path from "node:path";

import type { ParsedEfSource } from "./types.js";

const FORBIDDEN_PREFIXES = [
  "../../",
  "..\\",
  "/windows/",
  "c:/windows/",
  "\\\\",
] as const;

export function parseEfSourceAttribute(value: string | null | undefined): ParsedEfSource | null {
  if (!value) return null;
  const match = /^(.+?):(\d+):(\d+)$/.exec(value.trim());
  if (!match) return null;
  return {
    file: match[1]!,
    line: Number.parseInt(match[2]!, 10),
    column: Number.parseInt(match[3]!, 10),
  };
}

export interface SourcePathValidation {
  readonly ok: boolean;
  readonly normalized?: string;
  readonly reason?: string;
}

export function validateEfSourceInWorkspace(
  sourceFile: string,
  workspaceRoot: string,
): SourcePathValidation {
  const lower = sourceFile.replaceAll("\\", "/").toLowerCase();
  for (const bad of FORBIDDEN_PREFIXES) {
    if (lower.includes(bad.toLowerCase())) {
      return { ok: false, reason: "path traversal or external path rejected" };
    }
  }
  if (path.isAbsolute(sourceFile)) {
    const resolved = path.resolve(sourceFile);
    const root = path.resolve(workspaceRoot);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return { ok: false, reason: "absolute path outside workspace" };
    }
    return { ok: true, normalized: relative.replaceAll("\\", "/") };
  }
  const normalized = sourceFile.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.split("/").includes("..")) {
    return { ok: false, reason: "relative path escapes workspace" };
  }
  const resolved = path.resolve(workspaceRoot, normalized);
  const root = path.resolve(workspaceRoot);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, reason: "resolved path outside workspace" };
  }
  return { ok: true, normalized: relative.replaceAll("\\", "/") };
}