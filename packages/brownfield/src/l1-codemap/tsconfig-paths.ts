import fs from "node:fs";
import path from "node:path";

export interface PathAliasMap {
  readonly baseUrl: string;
  readonly patterns: ReadonlyArray<{ readonly prefix: string; readonly targets: readonly string[] }>;
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ""];

export function loadTsPathAliases(repoRoot: string): PathAliasMap {
  const candidates = ["tsconfig.json", "jsconfig.json"];
  for (const name of candidates) {
    const full = path.join(repoRoot, name);
    if (!fs.existsSync(full)) continue;
    try {
      const json = JSON.parse(fs.readFileSync(full, "utf8")) as {
        compilerOptions?: {
          baseUrl?: string;
          paths?: Record<string, string[]>;
        };
      };
      const baseUrl = path.resolve(repoRoot, json.compilerOptions?.baseUrl ?? ".");
      const patterns: Array<{ prefix: string; targets: readonly string[] }> = [];
      for (const [key, targets] of Object.entries(json.compilerOptions?.paths ?? {})) {
        const wildcard = key.endsWith("/*") ? key.slice(0, -2) : key.endsWith("*") ? key.slice(0, -1) : key;
        patterns.push({ prefix: wildcard, targets });
      }
      return { baseUrl, patterns };
    } catch {
      continue;
    }
  }
  return { baseUrl: repoRoot, patterns: [] };
}

export function resolveImportSpecifier(
  repoRoot: string,
  fromFile: string,
  specifier: string,
  aliases: PathAliasMap,
): string | null {
  const fromDir = path.dirname(path.join(repoRoot, fromFile));
  let candidate: string | null = null;

  if (specifier.startsWith(".")) {
    candidate = path.normalize(path.join(fromDir, specifier));
  } else {
    for (const rule of aliases.patterns) {
      if (specifier === rule.prefix) {
        candidate = path.join(aliases.baseUrl, rule.targets[0] ?? "");
        break;
      }
      const star = `${rule.prefix}/`;
      if (specifier.startsWith(star)) {
        const rest = specifier.slice(star.length);
        const target = (rule.targets[0] ?? "").replace(/\*$/, "");
        candidate = path.join(aliases.baseUrl, target, rest);
        break;
      }
    }
  }

  if (!candidate) return null;
  if (!candidate.startsWith(repoRoot)) {
    candidate = path.resolve(repoRoot, path.relative(repoRoot, candidate));
  }

  for (const ext of SOURCE_EXTENSIONS) {
    const withExt = ext ? `${candidate}${ext}` : candidate;
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
      return path.relative(repoRoot, withExt).replaceAll("\\", "/");
    }
    const index = path.join(candidate, `index${ext}`);
    if (fs.existsSync(index) && fs.statSync(index).isFile()) {
      return path.relative(repoRoot, index).replaceAll("\\", "/");
    }
  }
  return path.relative(repoRoot, candidate).replaceAll("\\", "/");
}

export function collectBarrelReExports(content: string): string[] {
  const names: string[] = [];
  const reExport = /export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = reExport.exec(content))) {
    const clause = match[1];
    if (!clause) continue;
    for (const part of clause.split(",")) {
      const trimmed = part.trim();
      const alias = trimmed.split(/\s+as\s+/)[0]?.trim();
      if (alias) names.push(alias);
    }
  }
  const star = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;
  while ((match = star.exec(content))) {
    if (match[1]) names.push(`*:${match[1]}`);
  }
  return names;
}