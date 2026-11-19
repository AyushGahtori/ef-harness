const GLOB_META = /[*?[]/;

/**
 * Convert a write-scope glob into the literal POSIX prefix stored in
 * `task_scopes` and `path_lease_prefixes`. Directory scopes keep a trailing
 * slash so `src/app/` does not prefix-match `src/app-extra/`.
 */
export function globToPathPrefix(glob: string): string {
  const normalized = normalizeGlob(glob);
  if (
    normalized === "" ||
    normalized === "*" ||
    normalized === "**" ||
    normalized === "/**"
  ) {
    return "";
  }
  const meta = GLOB_META.exec(normalized);
  if (!meta) {
    return directoryBoundary(normalized);
  }
  const prefix = normalized.slice(0, meta.index);
  if (prefix === "" || prefix === "/") return "";
  if (prefix.includes("\\")) {
    throw new Error("path prefix normalization produced a backslash");
  }
  return prefix;
}

function directoryBoundary(literal: string): string {
  if (literal.endsWith("/")) return literal;
  const segment = literal.slice(literal.lastIndexOf("/") + 1);
  if (segment.includes(".")) return literal;
  return `${literal}/`;
}

function normalizeGlob(glob: string): string {
  let text = glob.trim().replace(/\\/g, "/");
  text = text.replace(/\/\.\//g, "/");
  text = text.replace(/\/+/g, "/");
  while (text.startsWith("./")) text = text.slice(2);
  if (text.endsWith("/.")) text = text.slice(0, -2);
  return text;
}
