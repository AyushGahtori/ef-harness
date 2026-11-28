import path from "node:path";

/**
 * Case-insensitive glob match for `write_scope[]` entries (`**` and `*` only).
 */
export function pathMatchesWriteScope(filePath: string, writeScope: readonly string[]): boolean {
  const normalized = filePath.split(path.sep).join("/");
  const normalizedLower = process.platform === "win32" ? normalized.toLowerCase() : normalized;
  for (const pattern of writeScope) {
    const pat = process.platform === "win32" ? pattern.toLowerCase() : pattern;
    if (globMatch(normalizedLower, pat.split("/").join("/"))) return true;
  }
  return false;
}

function globMatch(text: string, pattern: string): boolean {
  if (pattern === text) return true;
  const regex = globToRegExp(pattern);
  return regex.test(text);
}

function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern.charAt(i);
    if (ch === "*") {
      const next = pattern[i + 1];
      if (next === "*") {
        out += ".*";
        i += 1;
        if (pattern[i + 1] === "/") {
          out += "(?:.+/)?";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if ("\\+?^${}()|[]".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  out += "$";
  return new RegExp(out);
}