import path from "node:path";
import type { ArtifactKind } from "./types.js";

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".vue"]);

const IMPORT_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const ROUTE_DEF = /(?:<Route[^>]*\spath|path|\broute)\s*(?:=|:|\()\s*['"](\/[^'"]*)['"]/g;
const ROUTE_LINK = /(?:\bto|\bhref|\bnavigate)\s*(?:=|\()\s*['"](\/[^'"]*)['"]/g;
const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi;
const ADD_COLUMN = /add\s+column\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi;
const REFERENCES = /references\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi;
const DEFINE_PERMISSION = /definePermission\(\s*['"]([^'"]+)['"]\s*\)/g;
const USE_PERMISSION = /\bcan\(\s*['"]([^'"]+)['"]\s*\)/g;

export function isSourceFile(filePath: string): boolean {
  return SOURCE_EXT.has(path.posix.extname(filePath).toLowerCase());
}

export function isMigrationPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  return normalized.endsWith(".sql") || normalized.includes("/migrations/") || normalized.startsWith("migrations/");
}

export function kindForPath(filePath: string): ArtifactKind {
  const normalized = filePath.replaceAll("\\", "/");
  if (isMigrationPath(normalized)) return "migration";
  if (/\.test\./.test(normalized) || normalized.includes("/tests/") || normalized.includes("/__tests__/")) return "test";
  if (normalized.includes("/routes/") || normalized.includes("/screens/")) return "route";
  if (normalized.includes("/components/")) return "component";
  if (normalized.includes("/handlers/")) return "handler";
  if (normalized.startsWith("src/lib/") || normalized.includes("/lib/")) return "helper";
  if (normalized.endsWith("package.json")) return "package";
  return "file";
}

export function featureIdFromPath(filePath: string): string {
  const match = /^features\/([^/]+)\//.exec(filePath.replaceAll("\\", "/"));
  return match?.[1] ?? "";
}

export function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const spec = match[1];
      if (spec) specs.push(spec);
    }
  }
  return specs;
}

export function resolveImport(fromFile: string, spec: string, files: ReadonlySet<string>): string | null {
  if (!spec.startsWith(".")) return null;
  const dir = path.posix.dirname(fromFile);
  const raw = path.posix.normalize(path.posix.join(dir, spec)).replace(/^\.\//, "");
  const candidates = [
    raw,
    `${raw}.ts`,
    `${raw}.tsx`,
    `${raw}.js`,
    `${raw}.jsx`,
    `${raw}.mjs`,
    `${raw}.cjs`,
    `${raw}.sql`,
    `${raw}/index.ts`,
    `${raw}/index.tsx`,
    `${raw}/index.js`,
  ];
  for (const candidate of candidates) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

export function routeDefinitions(source: string): string[] {
  return uniqueMatches(source, ROUTE_DEF);
}

export function routeLinks(source: string): string[] {
  return uniqueMatches(source, ROUTE_LINK);
}

export function createdTables(source: string): string[] {
  return uniqueMatches(source, CREATE_TABLE);
}

export function createdColumns(source: string): string[] {
  return uniqueMatches(source, ADD_COLUMN);
}

export function referencedTables(source: string): string[] {
  return uniqueMatches(source, REFERENCES);
}

export function definedPermissions(source: string): string[] {
  return uniqueMatches(source, DEFINE_PERMISSION);
}

export function usedPermissions(source: string): string[] {
  return uniqueMatches(source, USE_PERMISSION);
}

export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const parts = text.split("\n");
  if (text.endsWith("\n")) parts.pop();
  return parts;
}

export function joinLines(lines: readonly string[], trailingNewline: boolean): string {
  const body = lines.join("\n");
  if (!trailingNewline) return body;
  return body.length === 0 ? "\n" : `${body}\n`;
}

export function removeAddedLines(head: string, added: readonly string[]): string {
  const pending = [...added];
  const kept: string[] = [];
  for (const line of splitLines(head)) {
    if (pending.length > 0 && pending[0] === line) {
      pending.shift();
      continue;
    }
    kept.push(line);
  }
  return joinLines(kept, head.endsWith("\n") || head.length === 0);
}

function uniqueMatches(source: string, pattern: RegExp): string[] {
  const found = new Set<string>();
  pattern.lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    const value = match[1];
    if (value) found.add(value);
  }
  return [...found];
}
