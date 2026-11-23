const EXT_TO_LANGUAGE: Readonly<Record<string, string>> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".sql": "SQL",
  ".css": "CSS",
  ".scss": "CSS",
  ".md": "Markdown",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".html": "HTML",
  ".vue": "Vue",
  ".svelte": "Svelte",
};

export function languageForPath(relPath: string): string {
  const dot = relPath.lastIndexOf(".");
  if (dot < 0) return "Other";
  const ext = relPath.slice(dot).toLowerCase();
  return EXT_TO_LANGUAGE[ext] ?? "Other";
}

export function shouldSkipPath(relPath: string): boolean {
  const parts = relPath.replaceAll("\\", "/").split("/");
  return parts.some((segment) => ALWAYS_SKIP.has(segment));
}

const ALWAYS_SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "vendor",
  "__pycache__",
  "target",
]);