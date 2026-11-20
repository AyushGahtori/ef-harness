/** POSIX path normalization and write-scope / exemption globs. */

export function normalizePath(file: string): string {
  return file.replaceAll("\\", "/").replace(/^\.\//, "");
}

function escapeChar(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

export function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  let regex = "^";
  let index = 0;
  while (index < normalized.length) {
    const char = normalized[index] ?? "";
    const next = normalized[index + 1] ?? "";
    if (char === "*" && next === "*") {
      const after = normalized[index + 2] ?? "";
      if (after === "/") {
        regex += "(?:.*/)?";
        index += 3;
        continue;
      }
      regex += ".*";
      index += 2;
      continue;
    }
    if (char === "*") {
      regex += "[^/]*";
      index += 1;
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      index += 1;
      continue;
    }
    regex += escapeChar(char);
    index += 1;
  }
  regex += "$";
  return new RegExp(regex);
}

export function matchGlob(file: string, pattern: string): boolean {
  return globToRegExp(pattern).test(normalizePath(file));
}

export function matchAny(file: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchGlob(file, pattern));
}

export function isTestPath(file: string): boolean {
  const path = normalizePath(file);
  return (
    path.startsWith("tests/") ||
    path.includes("/tests/") ||
    path.includes("/__tests__/") ||
    path.startsWith("__tests__/") ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
  );
}

export function isGeneratedOrSeed(
  file: string,
  generated: readonly string[],
  seeds: readonly string[],
): boolean {
  return matchAny(file, generated) || matchAny(file, seeds);
}

export function isFixturePath(file: string, seeds: readonly string[]): boolean {
  return isTestPath(file) || matchAny(file, seeds);
}

const TEST_CONFIG_BASENAMES = new Set([
  "vitest.config.ts",
  "vitest.config.js",
  "vitest.config.mts",
  "vitest.config.mjs",
  "vitest.config.cts",
  "vitest.config.cjs",
  "jest.config.ts",
  "jest.config.js",
  "jest.config.mjs",
  "jest.config.cjs",
  "playwright.config.ts",
  "playwright.config.js",
  "cypress.config.ts",
  "cypress.config.js",
  "karma.conf.js",
]);

export function baseName(file: string): string {
  const path = normalizePath(file);
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

export function isBuiltinTestConfig(file: string): boolean {
  return TEST_CONFIG_BASENAMES.has(baseName(file));
}

export function isSnapshotPath(file: string): boolean {
  const path = normalizePath(file);
  return path.endsWith(".snap") || path.includes("/__snapshots__/");
}

export function lineSnippet(source: string, line: number): string {
  const rows = source.split(/\r?\n/);
  return (rows[line - 1] ?? "").trim().slice(0, 180);
}

export function extensionOf(file: string): string {
  const name = baseName(file);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

const FULL_AST_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);

export function hasFullAstSupport(file: string): boolean {
  return FULL_AST_EXTENSIONS.has(extensionOf(file));
}
