import { BUILD_ERROR_CAP } from "./model-profile.js";
import { oneLineSummary } from "./one-line-summary.js";
import { wrapData } from "./provenance.js";
import type { SecretRedactorPort } from "./secret-redactor.js";
import { createDefaultRedactor } from "./secret-redactor.js";
import { splitLines, stripAnsi } from "./text-util.js";

export interface BuildErrorItem {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly code: string;
  readonly message: string;
  readonly rawCount: number;
}

export interface BuildFileGroup {
  readonly file: string;
  readonly errors: readonly BuildErrorItem[];
}

export interface ShrunkBuildOutput {
  readonly rawCount: number;
  readonly dedupedCount: number;
  readonly shownCount: number;
  readonly byFile: readonly BuildFileGroup[];
  readonly artifactId: string;
  readonly oneLine: string;
  readonly text: string;
}

interface ParsedBuildError {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly code: string;
  readonly message: string;
}

export function shrinkBuildOutput(
  rawInput: string,
  options: { readonly artifactId: string; readonly redactor?: SecretRedactorPort },
): ShrunkBuildOutput {
  const redactor = options.redactor ?? createDefaultRedactor();
  const raw = stripAnsi(rawInput);
  const parsed = chooseParser(raw);
  const deduped = dedupe(parsed);
  const shown = deduped.slice(0, BUILD_ERROR_CAP);
  const byFile = groupByFile(shown);
  const omitted = deduped.length - shown.length;
  const lines: string[] = [
    `build: showing ${shown.length} of ${deduped.length} deduplicated errors (${parsed.length} raw) [${options.artifactId}]`,
  ];
  if (parsed.length === 0) {
    lines.push(...fallbackLines(raw, options.artifactId));
  } else {
    for (const group of byFile) {
      lines.push(group.file);
      for (const error of group.errors) {
        const times = error.rawCount > 1 ? ` (×${error.rawCount})` : "";
        lines.push(`  L${error.line}:${error.column} ${error.code} ${error.message}${times}`);
      }
    }
    if (omitted > 0) {
      lines.push(
        `${omitted} deduplicated errors omitted; use harness.read_log('${options.artifactId}')`,
      );
    }
  }
  const text = wrapData({
    source: `build:${options.artifactId}`,
    trust: "untrusted",
    body: lines.join("\n"),
    redactor,
  });
  return {
    rawCount: parsed.length,
    dedupedCount: deduped.length,
    shownCount: shown.length,
    byFile,
    artifactId: options.artifactId,
    oneLine: oneLineSummary({
      kind: "build",
      shown: shown.length,
      total: deduped.length,
      artifactId: options.artifactId,
    }),
    text,
  };
}

function fallbackLines(raw: string, artifactId: string): string[] {
  const sourceLines = splitLines(raw);
  if (sourceLines.length === 0) return ["(empty build output)"];
  const head = sourceLines.slice(0, 40);
  const omitted = Math.max(0, sourceLines.length - head.length);
  const lines = ["unrecognized build output", ...head];
  if (omitted > 0) lines.push(`${omitted} lines omitted; use harness.read_log('${artifactId}')`);
  return lines;
}

function chooseParser(raw: string): readonly ParsedBuildError[] {
  const candidates = [parseTsc(raw), parseEslint(raw), parseVite(raw), parseNext(raw), parseRust(raw), parseGo(raw)];
  let best: readonly ParsedBuildError[] = [];
  for (const candidate of candidates) {
    if (candidate.length > best.length) best = candidate;
  }
  return best;
}

function parseTsc(raw: string): ParsedBuildError[] {
  const errors: ParsedBuildError[] = [];
  for (const line of splitLines(raw)) {
    const paren = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/.exec(line.trim());
    const colon = /^(.+?):(\d+):(\d+)\s+-\s+error\s+(TS\d+):\s+(.+)$/.exec(line.trim());
    const match = paren ?? colon;
    if (!match) continue;
    errors.push(toError(match[1], match[2], match[3], match[4], match[5]));
  }
  return errors;
}

function parseEslint(raw: string): ParsedBuildError[] {
  const errors: ParsedBuildError[] = [];
  let currentFile: string | null = null;
  for (const line of splitLines(raw)) {
    const unix = /^(.+?\.(?:ts|tsx|js|jsx|mjs|cjs)):(\d+):(\d+):\s+(.+?)\s{2,}([@A-Za-z0-9/_-]+)\s*$/.exec(
      line.trim(),
    );
    if (unix) {
      errors.push(toError(unix[1], unix[2], unix[3], unix[5], unix[4]));
      continue;
    }
    const stylish = /^\s*(\d+):(\d+)\s+(?:error|warning)\s+(.+?)\s{2,}([@A-Za-z0-9/_-]+)\s*$/.exec(line);
    if (stylish && currentFile) {
      errors.push(toError(currentFile, stylish[1], stylish[2], stylish[4], stylish[3]));
      continue;
    }
    const trimmed = line.trim();
    if (
      trimmed.length > 0 &&
      !trimmed.startsWith(" ") &&
      !/^\d+:\d+/.test(trimmed) &&
      (trimmed.includes("/") || trimmed.includes("\\") || /\.[a-z]+$/i.test(trimmed))
    ) {
      currentFile = normalizeFile(trimmed);
    }
  }
  return errors;
}

function parseVite(raw: string): ParsedBuildError[] {
  const errors: ParsedBuildError[] = [];
  const lines = splitLines(raw);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const esbuild = /^(.+?\.(?:ts|tsx|js|jsx)):(\d+):(\d+):\s+ERROR:\s+(.+)$/.exec(line.trim());
    if (esbuild) {
      errors.push(toError(esbuild[1], esbuild[2], esbuild[3], "VITE", esbuild[4]));
      continue;
    }
    const banner = /^✘ \[ERROR\]\s+(.+)$/.exec(line.trim());
    if (!banner) continue;
    const location = followingLocation(lines, index + 1);
    if (!location) continue;
    errors.push(toError(location.file, location.line, location.column, "VITE", banner[1]));
  }
  return errors;
}

function parseNext(raw: string): ParsedBuildError[] {
  const errors: ParsedBuildError[] = [];
  const lines = splitLines(raw);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\.\/(.+?):(\d+):(\d+)\s*$/.exec((lines[index] ?? "").trim());
    if (!match) continue;
    const message = (lines[index + 1] ?? "").trim() || "Next.js build error";
    errors.push(toError(match[1], match[2], match[3], "NEXT", message));
  }
  return errors;
}

function parseRust(raw: string): ParsedBuildError[] {
  const errors: ParsedBuildError[] = [];
  const lines = splitLines(raw);
  let pending: { code: string; message: string } | null = null;
  for (const line of lines) {
    const header = /^error\[([A-Z]\d+)\]:\s+(.+)$/.exec(line.trim());
    if (header?.[1] && header[2]) {
      pending = { code: header[1], message: header[2] };
      continue;
    }
    const location = /^\s*-->\s+(.+?):(\d+):(\d+)\s*$/.exec(line);
    if (!location || !pending) continue;
    errors.push(toError(location[1], location[2], location[3], pending.code, pending.message));
    pending = null;
  }
  return errors;
}

function parseGo(raw: string): ParsedBuildError[] {
  const errors: ParsedBuildError[] = [];
  for (const line of splitLines(raw)) {
    const match = /^(.+\.go):(\d+):(\d+):\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    errors.push(toError(match[1], match[2], match[3], "GO", match[4]));
  }
  return errors;
}

function followingLocation(
  lines: readonly string[],
  start: number,
): { file: string; line: string; column: string } | null {
  for (let index = start; index < Math.min(lines.length, start + 6); index += 1) {
    const match = /^\s*(.+?):(\d+):(\d+):?\s*$/.exec(lines[index] ?? "");
    if (!match?.[1] || !match[2] || !match[3]) continue;
    return { file: match[1], line: match[2], column: match[3] };
  }
  return null;
}

function toError(
  file: string | undefined,
  line: string | undefined,
  column: string | undefined,
  code: string | undefined,
  message: string | undefined,
): ParsedBuildError {
  return {
    file: normalizeFile(file ?? "unknown"),
    line: Number(line ?? "0"),
    column: Number(column ?? "0"),
    code: (code ?? "ERROR").trim(),
    message: (message ?? "").trim(),
  };
}

function normalizeFile(file: string): string {
  return file.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

function dedupe(errors: readonly ParsedBuildError[]): BuildErrorItem[] {
  const map = new Map<string, BuildErrorItem>();
  const order: string[] = [];
  for (const error of errors) {
    const key = `${error.file}\0${error.code}\0${error.message}`;
    const existing = map.get(key);
    if (existing) {
      map.set(key, { ...existing, rawCount: existing.rawCount + 1 });
      continue;
    }
    map.set(key, { ...error, rawCount: 1 });
    order.push(key);
  }
  return order.map((key) => map.get(key)).filter((item): item is BuildErrorItem => item !== undefined);
}

function groupByFile(errors: readonly BuildErrorItem[]): BuildFileGroup[] {
  const groups = new Map<string, BuildErrorItem[]>();
  for (const error of errors) {
    const existing = groups.get(error.file);
    if (existing) existing.push(error);
    else groups.set(error.file, [error]);
  }
  return [...groups.entries()].map(([file, items]) => ({ file, errors: items }));
}
