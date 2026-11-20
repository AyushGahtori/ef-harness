export function normalizeRepoPath(input: string): string {
  const slash = input.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts: string[] = [];
  for (const part of slash.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

export function pathKey(input: string): string {
  return normalizeRepoPath(input).toLowerCase();
}

/** `src/lib/formatters.ts` + `menu` becomes `src/lib/menu/formatters.ts`. */
export function splitModulePath(writePath: string, slug: string): string {
  const norm = normalizeRepoPath(writePath);
  const slash = norm.lastIndexOf("/");
  const dir = slash >= 0 ? norm.slice(0, slash) : "";
  const base = slash >= 0 ? norm.slice(slash + 1) : norm;
  return dir ? `${dir}/${slug}/${base}` : `${slug}/${base}`;
}
