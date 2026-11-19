import path from "node:path";
import { InvalidProjectIdError, InvalidProjectPathError } from "./errors.js";

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertProjectId(projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw new InvalidProjectIdError(projectId);
  return projectId;
}

/**
 * Canonical project path for registry identity.
 * On Windows, `C:\Foo` and `c:\foo\` are the same project: drive letter uppercased,
 * trailing slash removed, and the remainder case-folded.
 */
export function normalizeProjectPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new InvalidProjectPathError("project path is empty");
  if (process.platform === "win32") return normalizeWindowsPath(trimmed);
  return normalizePosixPath(trimmed);
}

function normalizeWindowsPath(input: string): string {
  let normalized = path.win32.normalize(input);
  const unc = normalized.startsWith("\\\\");
  const driveRoot = /^[A-Za-z]:\\$/.test(normalized);
  if (!driveRoot) normalized = normalized.replace(/\\+$/u, "");
  if (/^[A-Za-z]:/u.test(normalized)) {
    const drive = normalized.charAt(0).toUpperCase();
    const rest = normalized.slice(2).toLowerCase();
    normalized = `${drive}:${rest}`;
    if (!/^[A-Za-z]:\\/u.test(normalized)) {
      throw new InvalidProjectPathError("project path must be absolute");
    }
    return normalized;
  }
  if (unc) {
    return `\\\\${normalized.slice(2).toLowerCase()}`;
  }
  throw new InvalidProjectPathError("project path must be absolute");
}

function normalizePosixPath(input: string): string {
  let normalized = path.posix.normalize(input.replaceAll("\\", "/"));
  if (!normalized.startsWith("/")) {
    throw new InvalidProjectPathError("project path must be absolute");
  }
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/u, "");
  return normalized;
}
