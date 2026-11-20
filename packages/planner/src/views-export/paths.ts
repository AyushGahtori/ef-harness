import path from "node:path";

export const VIEWS_DIR = ".harness/views";

export function viewsRoot(projectRoot: string): string {
  return path.join(projectRoot, ".harness", "views");
}

export function manifestPath(projectRoot: string): string {
  return path.join(viewsRoot(projectRoot), ".manifest.json");
}

/** View-relative posix path. Absolute paths under `.harness/views/` are stripped to that root. */
export function normalizeViewPath(filePath: string): string {
  const slash = filePath.replaceAll("\\", "/");
  const marker = "/.harness/views/";
  const index = slash.toLowerCase().lastIndexOf(marker);
  if (index >= 0) return slash.slice(index + marker.length);
  return slash.replace(/^\.\//, "");
}

export function viewRelativeFrom(viewsDirectory: string, eventPath: string): string | null {
  const root = viewsDirectory.replaceAll("\\", "/").replace(/\/$/, "");
  const slash = eventPath.replaceAll("\\", "/");
  const rootLower = root.toLowerCase();
  const slashLower = slash.toLowerCase();
  if (slashLower === rootLower) return null;
  if (slashLower.startsWith(`${rootLower}/`)) return slash.slice(root.length + 1);
  if (!path.isAbsolute(eventPath)) return normalizeViewPath(eventPath);
  return null;
}
