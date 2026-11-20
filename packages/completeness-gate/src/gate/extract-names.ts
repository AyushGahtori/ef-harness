import type { ExtractedCodeName } from "./ports.js";
import { normalizePath } from "./path-match.js";

const ASSET_EXT = /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|avif|woff2?|ttf|otf|eot)(?:\?[^'")\s]*)?$/i;

export function extractCodeNames(file: string, source: string): ExtractedCodeName[] {
  const path = normalizePath(file);
  const names: ExtractedCodeName[] = [];
  const push = (kind: ExtractedCodeName["kind"], value: string, index: number) => {
    const trimmed = value.trim();
    if (!trimmed || ASSET_EXT.test(trimmed)) return;
    names.push({ kind, value: trimmed, file: path, line: lineOf(source, index) });
  };

  const httpMethod =
    /(?:app|router|route)\.(?:get|post|put|patch|delete|options|head|all)\(\s*['"`]([^'"`]+)['"`]/g;
  for (const match of source.matchAll(httpMethod)) {
    const value = match[1] ?? "";
    push(value.startsWith("/api") ? "http_route" : "http_route", value, match.index ?? 0);
  }

  const pagePath = /(?:\bpath|\broute)\s*[:=]\s*['"`](\/[^'"`]+)['"`]/g;
  for (const match of source.matchAll(pagePath)) {
    const value = match[1] ?? "";
    if (ASSET_EXT.test(value)) continue;
    push(value.startsWith("/api") ? "http_route" : "page_route", value, match.index ?? 0);
  }

  const envDot = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const match of source.matchAll(envDot)) {
    push("env_var", match[1] ?? "", match.index ?? 0);
  }
  const envIndex = /process\.env\[\s*['"`]([^'"`]+)['"`]\s*\]/g;
  for (const match of source.matchAll(envIndex)) {
    push("env_var", match[1] ?? "", match.index ?? 0);
  }

  const storage =
    /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*['"`]([^'"`]+)['"`]/g;
  for (const match of source.matchAll(storage)) {
    push("storage_key", match[1] ?? "", match.index ?? 0);
  }
  const cookieSet = /cookies\(\)\.(?:get|set)\(\s*['"`]([^'"`]+)['"`]/g;
  for (const match of source.matchAll(cookieSet)) {
    push("storage_key", match[1] ?? "", match.index ?? 0);
  }
  const documentCookie = /document\.cookie\s*=\s*['"`]([^=\s;'"`]+)\s*=/g;
  for (const match of source.matchAll(documentCookie)) {
    push("cookie", match[1] ?? "", match.index ?? 0);
  }

  const table = /create\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/gi;
  for (const match of source.matchAll(table)) {
    push("db_table", match[1] ?? "", match.index ?? 0);
  }
  const index = /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/gi;
  for (const match of source.matchAll(index)) {
    push("db_index", match[1] ?? "", match.index ?? 0);
  }
  return dedupe(names);
}

export interface AssetReference {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly reference: string;
}

export function extractAssetReferences(file: string, source: string): AssetReference[] {
  const path = normalizePath(file);
  const hits: AssetReference[] = [];
  const literal = /(['"`])([^'"`]+\.(?:png|jpe?g|gif|webp|svg|ico|bmp|avif|woff2?|ttf|otf|eot)(?:\?[^'"`]*)?)\1/gi;
  for (const match of source.matchAll(literal)) {
    const reference = match[2] ?? "";
    if (/^https?:\/\//i.test(reference)) continue;
    const index = match.index ?? 0;
    hits.push({
      file: path,
      line: lineOf(source, index),
      column: 1,
      reference: resolveReference(path, reference),
    });
  }
  return hits;
}

export function resolveReference(fromFile: string, reference: string): string {
  const clean = reference.split("?")[0] ?? reference;
  if (clean.startsWith("/") || clean.startsWith("public/") || /^[A-Za-z]:/.test(clean)) {
    return clean.replaceAll("\\", "/");
  }
  if (clean.startsWith(".")) {
    const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
    const parts = `${dir}/${clean}`.split("/");
    const stack: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") {
        stack.pop();
        continue;
      }
      stack.push(part);
    }
    return stack.join("/");
  }
  return clean.replaceAll("\\", "/");
}

export function assetKeys(reference: string): string[] {
  const norm = reference.replaceAll("\\", "/");
  const keys = new Set<string>([norm]);
  if (norm.startsWith("/")) keys.add(norm.slice(1));
  if (norm.startsWith("public/")) keys.add(`/${norm.slice("public/".length)}`);
  else keys.add(`public/${norm.replace(/^\//, "")}`);
  return [...keys];
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/).length;
}

function dedupe(names: readonly ExtractedCodeName[]): ExtractedCodeName[] {
  const seen = new Set<string>();
  const unique: ExtractedCodeName[] = [];
  for (const name of names) {
    const key = `${name.kind}|${name.value}|${name.file}|${name.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique;
}
