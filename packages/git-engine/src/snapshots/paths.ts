import path from "node:path";
import { SnapshotRefRejectedError } from "./errors.js";

export function isInsideDir(child: string, parent: string): boolean {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  if (process.platform === "win32") {
    const left = resolvedChild.toLowerCase();
    const right = resolvedParent.toLowerCase();
    return left === right || left.startsWith(right.endsWith("\\") ? right : `${right}\\`);
  }
  const relative = path.relative(resolvedParent, resolvedChild);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function normalizeRelPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function resolveInsideRepo(repoPath: string, relativePath: string): string | null {
  const normalized = normalizeRelPath(relativePath);
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return null;
  const absolute = path.resolve(repoPath, normalized);
  const relative = path.relative(repoPath, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return absolute;
}

export function assertSafeRefComponent(value: string, label: string): string {
  if (!value || value === "." || value === ".." || value === "@") {
    throw new SnapshotRefRejectedError(`${label} is empty or reserved.`);
  }
  if (value.endsWith(".lock") || value.includes("..") || value.includes("@{") || value.includes("//")) {
    throw new SnapshotRefRejectedError(`${label} is not a safe Git ref component.`);
  }
  if (/[\u0000-\u0020\u007f~^:?*[\\]/.test(value)) {
    throw new SnapshotRefRejectedError(`${label} contains characters that cannot appear in a Git ref.`);
  }
  return value;
}
