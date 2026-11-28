import type { SourceLocation } from "./types.js";

export interface AcceptedPath {
  readonly ok: true;
  readonly relativePath: string;
  readonly absolutePath: string;
}

export interface RejectedPath {
  readonly ok: false;
  readonly reason: string;
}

/**
 * Lexical project-relative check for the sandboxed renderer.
 * Workspace realpath containment runs in the daemon.
 */
export function validateProjectSourcePath(sourceFile: string, projectRoot: string): AcceptedPath | RejectedPath {
  if (sourceFile.length === 0 || sourceFile.length > 500 || sourceFile.includes("\0")) {
    return { ok: false, reason: "source path is invalid" };
  }
  let decoded = sourceFile;
  try {
    decoded = decodeURIComponent(sourceFile);
  } catch {
    return { ok: false, reason: "source path is invalid" };
  }
  const unified = decoded.replaceAll("\\", "/");
  if (unified.includes("\0") || unified.includes("://")) {
    return { ok: false, reason: "source path is invalid" };
  }
  if (/^[a-zA-Z]:\//.test(unified) || unified.startsWith("/") || unified.startsWith("//")) {
    return { ok: false, reason: "source path must be relative to the project" };
  }
  const segments = unified.split("/");
  if (segments.some((part) => part === "" || part === "." || part === "..")) {
    return { ok: false, reason: "source path escapes the project" };
  }
  const relativePath = segments.join("/");
  const root = projectRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  return {
    ok: true,
    relativePath,
    absolutePath: `${root}/${relativePath}`,
  };
}

export function parseSourceAttribute(raw: string): { file: string; line: number; column: number } | null {
  const match = /^(.*):(\d+):(\d+)$/.exec(raw.trim());
  if (!match) return null;
  const file = match[1];
  const line = Number(match[2]);
  const column = Number(match[3]);
  if (!file || !Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) {
    return null;
  }
  return { file, line, column };
}

export function acceptSourceAttribute(
  raw: string,
  projectRoot: string,
): { ok: true; location: SourceLocation } | RejectedPath {
  const parsed = parseSourceAttribute(raw);
  const file = parsed?.file ?? raw.trim();
  const checked = validateProjectSourcePath(file, projectRoot);
  if (!checked.ok) return checked;
  if (!parsed) {
    return { ok: false, reason: "data-ef-source must be file:line:column" };
  }
  return {
    ok: true,
    location: {
      file: checked.relativePath,
      line: parsed.line,
      column: parsed.column,
      raw: `${checked.relativePath}:${parsed.line}:${parsed.column}`,
    },
  };
}

export function validateRoute(route: string): boolean {
  if (!route.startsWith("/")) return false;
  if (route.includes("\\") || route.includes("..") || route.includes("://")) return false;
  return true;
}

export function isExactWriteFile(file: string): boolean {
  if (file.includes("*") || file.includes("\\") || file.endsWith("/") || file.includes("..")) {
    return false;
  }
  const base = file.split("/").pop() ?? "";
  return base.includes(".") && !base.startsWith(".");
}

export function fileStem(file: string): string {
  const base = file.split("/").pop() ?? file;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export function baseName(file: string): string {
  return file.split("/").pop() ?? file;
}
