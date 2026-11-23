import path from "node:path";

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const SECRET_SEGMENTS = new Set([
  ".ssh",
  ".aws",
  ".azure",
  ".gnupg",
  ".claude",
  ".codex",
  ".gemini",
]);

export function isDeniedRead(worktree: string, target: string): boolean {
  const resolved = path.resolve(target);
  if (!isInside(worktree, resolved)) return true;
  return resolved.split(path.sep).some((part) => SECRET_SEGMENTS.has(part));
}

export function isZipNameSafe(name: string): boolean {
  const normalized = name.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return false;
  return !normalized.split("/").some((part) => part === "..");
}
