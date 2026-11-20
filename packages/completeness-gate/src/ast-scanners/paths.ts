import type { AstGrepLanguage, StaticAuditConventions, StaticAuditLanguage } from "./types.js";

export function normalizePath(file: string): string {
  return file.replaceAll("\\", "/").replace(/^\.\//, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesPathPattern(file: string, pattern: string): boolean {
  const value = normalizePath(file);
  const raw = normalizePath(pattern);
  if (raw.endsWith("/**")) {
    const prefix = raw.slice(0, -3).replace(/\/$/, "");
    return value === prefix || value.startsWith(`${prefix}/`);
  }
  if (raw.includes("*")) {
    const expression = `^${raw.split("*").map(escapeRegex).join("[^/]*")}$`;
    return new RegExp(expression).test(value);
  }
  return value === raw || value.startsWith(`${raw}/`);
}

export function isPlanExcluded(file: string, conventions: StaticAuditConventions): boolean {
  const patterns = [...conventions.excludedGeneratedPaths, ...conventions.seedFixturePaths];
  return patterns.some((pattern) => matchesPathPattern(file, pattern));
}

export function isTestPath(file: string): boolean {
  const value = normalizePath(file);
  if (/(^|\/)__(?:tests|mocks)__(\/|$)/.test(value)) return true;
  if (/(^|\/)tests(\/|$)/.test(value)) return true;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(value)) return true;
  if (/(^|\/)test_.+\.py$/.test(value)) return true;
  if (/(^|\/).+_test\.go$/.test(value)) return true;
  if (/(^|\/).+_test\.rs$/.test(value)) return true;
  return false;
}

export function languageOf(file: string): StaticAuditLanguage {
  const value = normalizePath(file).toLowerCase();
  if (value.endsWith(".tsx")) return "tsx";
  if (value.endsWith(".jsx")) return "jsx";
  if (value.endsWith(".ts") || value.endsWith(".mts") || value.endsWith(".cts")) return "typescript";
  if (value.endsWith(".js") || value.endsWith(".mjs") || value.endsWith(".cjs")) return "javascript";
  if (value.endsWith(".py")) return "python";
  if (value.endsWith(".go")) return "go";
  if (value.endsWith(".rs")) return "rust";
  if (value.endsWith(".html") || value.endsWith(".htm")) return "html";
  return "unsupported";
}

export function isTypeScriptFamily(language: StaticAuditLanguage): boolean {
  return (
    language === "typescript" ||
    language === "javascript" ||
    language === "tsx" ||
    language === "jsx"
  );
}

export function astGrepLanguageOf(language: StaticAuditLanguage): AstGrepLanguage | null {
  if (language === "python" || language === "go" || language === "rust") return language;
  return null;
}

export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const parts = text.split(/\r?\n/);
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

export function lineCount(text: string): number {
  return splitLines(text).length;
}
