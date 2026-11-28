import { EF_SOURCE_ATTR, type SourceTagInjection, type TransformJsxSourceTagsOptions } from "./types.js";

const OPENING_TAG =
  /<(?![\/!?])([A-Za-z][\w.-]*)\b((?:[^>"']|"[^"]*"|'[^']*'|`[^`]*`)*)(\/?)>/g;

export function normalizeSourceFilePath(filePath: string, rootDir?: string): string {
  let rel = filePath.replaceAll("\\", "/");
  if (rootDir) {
    const root = rootDir.replaceAll("\\", "/").replace(/\/$/, "");
    if (rel.startsWith(root + "/")) {
      rel = rel.slice(root.length + 1);
    } else if (rel.startsWith(root)) {
      rel = rel.slice(root.length).replace(/^\//, "");
    }
  }
  return rel.replace(/^\//, "");
}

export function lineColumnAtIndex(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

export function formatSourceTagValue(relPath: string, line: number, column: number): string {
  return `${relPath}:${line}:${column}`;
}

export function countEfSourceOccurrences(bundle: string): number {
  const matches = bundle.match(/data-ef-source/g);
  return matches?.length ?? 0;
}

export function listInjectedSourceTags(source: string, relPath: string): SourceTagInjection[] {
  const tags: SourceTagInjection[] = [];
  const injected =
    /<\s*([A-Za-z][\w.-]*)\b[^>]*\sdata-ef-source="([^"]+)"/g;
  for (const match of source.matchAll(injected)) {
    const tag = match[1] ?? "";
    const value = match[2] ?? "";
    const parts = value.match(/^(.*):(\d+):(\d+)$/);
    tags.push({
      line: parts ? Number(parts[2]) : 0,
      column: parts ? Number(parts[3]) : 0,
      tag,
      value: parts ? value : formatSourceTagValue(relPath, 0, 0),
    });
  }
  return tags;
}

export function transformJsxWithSourceTags(
  source: string,
  filePath: string,
  options: TransformJsxSourceTagsOptions,
): string {
  if (options.production) {
    return source.replace(new RegExp(`\\s${EF_SOURCE_ATTR}="[^"]*"`, "g"), "");
  }
  if (!/\.(?:tsx|jsx)$/i.test(filePath)) {
    return source;
  }

  const relPath = normalizeSourceFilePath(filePath, options.rootDir);

  return source.replace(OPENING_TAG, (full, tag: string, attrs: string, selfClose: string, offset: number) => {
    if (attrs.includes(EF_SOURCE_ATTR)) {
      return full;
    }
    const { line, column } = lineColumnAtIndex(source, offset);
    const value = formatSourceTagValue(relPath, line, column);
    const injected = ` ${EF_SOURCE_ATTR}="${value}"`;
    if (selfClose) {
      return `<${tag}${attrs}${injected}${selfClose}>`;
    }
    return `<${tag}${attrs}${injected}>`;
  });
}