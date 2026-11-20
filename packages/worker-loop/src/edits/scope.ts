function escapeRegex(char: string): string {
  return /[|\\{}()[\]^$+*?.]/.test(char) ? `\\${char}` : char;
}

export function normalizePosix(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

/** Gitignore-style `*`, `?`, and `**` against a relative posix path. */
export function globToRegExp(pattern: string): RegExp {
  const source: string[] = ["^"];
  const glob = normalizePosix(pattern).replace(/^\/+/, "");
  let index = 0;
  while (index < glob.length) {
    const char = glob[index] ?? "";
    const next = glob[index + 1];
    if (char === "*" && next === "*") {
      if (glob[index + 2] === "/") {
        source.push("(?:.*/)?");
        index += 3;
        continue;
      }
      source.push(".*");
      index += 2;
      continue;
    }
    if (char === "*") {
      source.push("[^/]*");
      index += 1;
      continue;
    }
    if (char === "?") {
      source.push("[^/]");
      index += 1;
      continue;
    }
    source.push(escapeRegex(char));
    index += 1;
  }
  source.push("$");
  return new RegExp(source.join(""));
}

export function pathMatchesWriteScope(relativePath: string, writeScope: readonly string[]): boolean {
  const path = normalizePosix(relativePath).replace(/^\/+/, "");
  return writeScope.some((pattern) => globToRegExp(pattern).test(path));
}
