import type { ParsedEfSource } from "./types.js";

const FORBIDDEN_PREFIXES = ["../../", "..\\", "/windows/", "c:/windows/", "\\\\"] as const;

export function parseEfSourceAttribute(value: string | null | undefined): ParsedEfSource | null {
  if (!value) return null;
  const match = /^(.+?):(\d+):(\d+)$/.exec(value.trim());
  if (!match) return null;
  const file = match[1];
  const lineText = match[2];
  const columnText = match[3];
  if (!file || !lineText || !columnText) return null;
  return {
    file,
    line: Number.parseInt(lineText, 10),
    column: Number.parseInt(columnText, 10),
  };
}

export interface SourcePathValidation {
  readonly ok: boolean;
  readonly normalized?: string;
  readonly reason?: string;
}

export function validateEfSourceInWorkspace(sourceFile: string, workspaceRoot: string): SourcePathValidation {
  const lower = sourceFile.replaceAll("\\", "/").toLowerCase();
  for (const bad of FORBIDDEN_PREFIXES) {
    if (lower.includes(bad.toLowerCase())) {
      return { ok: false, reason: "path traversal or external path rejected" };
    }
  }
  const normalized = sourceFile.replaceAll("\\", "/").replace(/^\.\//, "");
  if (isAbsolutePosix(normalized)) {
    const relative = relativePosix(workspaceRoot, normalized);
    if (relative.startsWith("..") || isAbsolutePosix(relative)) {
      return { ok: false, reason: "absolute path outside workspace" };
    }
    return { ok: true, normalized: relative };
  }
  if (normalized.split("/").includes("..")) {
    return { ok: false, reason: "relative path escapes workspace" };
  }
  return { ok: true, normalized };
}

function isAbsolutePosix(value: string): boolean {
  const norm = value.replaceAll("\\", "/");
  return norm.startsWith("/") || /^[A-Za-z]:\//.test(norm);
}

function relativePosix(root: string, target: string): string {
  const rootParts = trimSlash(root.replaceAll("\\", "/")).split("/");
  const targetParts = trimSlash(target.replaceAll("\\", "/")).split("/");
  let index = 0;
  while (
    index < rootParts.length &&
    index < targetParts.length &&
    rootParts[index]?.toLowerCase() === targetParts[index]?.toLowerCase()
  ) {
    index += 1;
  }
  const up = Array.from({ length: rootParts.length - index }, () => "..");
  return [...up, ...targetParts.slice(index)].join("/");
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
