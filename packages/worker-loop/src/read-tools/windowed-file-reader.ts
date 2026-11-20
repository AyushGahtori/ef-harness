import fs from "node:fs";
import path from "node:path";
import { InvalidLineRangeError } from "./errors.js";
import { FileHashReadCache } from "./file-hash-cache.js";
import { isGitignored, loadGitignore, matchGlob } from "./gitignore.js";
import { FileOutlineExtractor, type SymbolOutlineEntry } from "./outline.js";
import {
  LONG_LINE_CHARS,
  GREP_LINE_CHARS,
  GREP_MATCH_CAP,
  LIST_MATCH_CAP,
  capsForProfile,
  type ReadModelProfile,
} from "./model-profile.js";
import {
  assertWorktreeDirectory,
  isInsideRoot,
  isSecretFile,
  relativePosix,
  resolvePackageFile,
  resolveReadableFile,
} from "./path-guard.js";
import { wrapData } from "./provenance.js";
import { compileSafeRegex } from "./safe-regex.js";
import { createDefaultRedactor, type SecretRedactorPort } from "./secret-redactor.js";
import { formatGroupedNumber, lineLabel, sha256, splitLines } from "./text-util.js";

const NUL_PROBE_BYTES = 4096;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".db": "application/x-sqlite3",
  ".sqlite": "application/x-sqlite3",
  ".sqlite3": "application/x-sqlite3",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".bin": "application/octet-stream",
};

export interface LineRange {
  readonly start: number;
  readonly end: number;
}

export interface NumberedLine {
  readonly lineNumber: number;
  readonly text: string;
  readonly display: string;
  readonly truncated: boolean;
  readonly originalChars: number;
}

export interface FileReadResult {
  readonly relativePath: string;
  readonly binary: boolean;
  readonly bytes: number;
  readonly mimeGuess: string | null;
  readonly totalLines: number;
  readonly fileHash: string;
  readonly rangeHash: string;
  readonly lines: readonly NumberedLine[];
  readonly outline: readonly SymbolOutlineEntry[];
  readonly truncated: boolean;
  readonly omittedLineCount: number;
  readonly instruction: string | null;
  readonly returnedStart: number | null;
  readonly returnedEnd: number | null;
  readonly text: string;
}

export interface GrepMatch {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
}

export interface GrepFilesResult {
  readonly matches: readonly GrepMatch[];
  readonly totalMatches: number;
  readonly fileCount: number;
  readonly truncated: boolean;
  readonly hint: string | null;
  readonly text: string;
}

export interface ListFilesResult {
  readonly files: readonly string[];
  readonly total: number;
  readonly truncated: boolean;
  readonly hint: string | null;
  readonly text: string;
}

export interface SearchOptions {
  readonly includeLocalPackageSource?: boolean;
}

export interface WindowedFileReaderOptions {
  readonly worktreePath: string;
  readonly modelProfile: ReadModelProfile;
  readonly redactor?: SecretRedactorPort;
  readonly localPackageRoots?: readonly string[];
  readonly hashCache?: FileHashReadCache;
  readonly outlineExtractor?: FileOutlineExtractor;
}

/**
 * Read-only `read_file`, `list`, and `grep`.
 * `rangeHash` is the SHA-256 hex of the selected logical lines joined by `\n`
 * (line text only, not the numbered display). `fileHash` is the SHA-256 of the
 * raw file bytes. Long lines are hashed in full and shown to the model as a
 * truncation notice.
 */
export class WindowedFileReader {
  readonly hashCache: FileHashReadCache;
  private readonly worktreeReal: string;
  private readonly redactor: SecretRedactorPort;
  private readonly outlineExtractor: FileOutlineExtractor;
  private readonly localPackageRoots: readonly string[];
  private readonly readLineCap: number;

  constructor(options: WindowedFileReaderOptions) {
    this.worktreeReal = assertWorktreeDirectory(options.worktreePath);
    this.redactor = options.redactor ?? createDefaultRedactor();
    this.outlineExtractor = options.outlineExtractor ?? new FileOutlineExtractor();
    this.hashCache = options.hashCache ?? new FileHashReadCache();
    this.localPackageRoots = options.localPackageRoots ?? [];
    this.readLineCap = capsForProfile(options.modelProfile).readLines;
  }

  readFile(requestedPath: string, range?: LineRange): FileReadResult {
    const resolved = resolveReadableFile({
      worktreeReal: this.worktreeReal,
      requestedPath,
      allowRoots: this.localPackageRoots,
      redactor: this.redactor,
      allowPackageRoots: false,
    });
    return this.readResolved(resolved, range);
  }

  readLocalPackageSource(packageRoot: string, relativePath: string): FileReadResult {
    const resolved = resolvePackageFile({
      packageRoot,
      relativePath,
      allowRoots: this.localPackageRoots,
      redactor: this.redactor,
    });
    return this.readResolved(resolved, undefined);
  }

  listFiles(glob: string, options?: SearchOptions): ListFilesResult {
    const includeLocalPackageSource = options?.includeLocalPackageSource === true;
    const files = this.collectFiles(includeLocalPackageSource).filter((full) =>
      matchGlob(glob, relativePosix(this.worktreeReal, full)),
    );
    const total = files.length;
    const shown = files.slice(0, LIST_MATCH_CAP).map((full) => relativePosix(this.worktreeReal, full));
    const truncated = total > shown.length;
    const hint = truncated ? `Showing first ${LIST_MATCH_CAP} of ${total} files; refine glob` : null;
    const body = [
      `list ${glob}: showing ${shown.length} of ${total}`,
      ...shown,
      ...(hint ? [hint] : []),
    ].join("\n");
    return {
      files: shown,
      total,
      truncated,
      hint,
      text: wrapData({
        source: `list:${glob}`,
        trust: "untrusted",
        body,
        redactor: this.redactor,
      }),
    };
  }

  grepFiles(pattern: string, glob?: string, options?: SearchOptions): GrepFilesResult {
    const expression = compileSafeRegex(pattern);
    const includeLocalPackageSource = options?.includeLocalPackageSource === true;
    const files = this.collectFiles(includeLocalPackageSource).filter((full) =>
      glob === undefined ? true : matchGlob(glob, relativePosix(this.worktreeReal, full)),
    );
    const matches: GrepMatch[] = [];
    const filesWithHits = new Set<string>();
    let totalMatches = 0;
    for (const full of files) {
      const relative = relativePosix(this.worktreeReal, full);
      const buffer = fs.readFileSync(full);
      if (containsNul(buffer)) continue;
      const lines = splitLines(buffer.toString("utf8"));
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const found = expression.execAll(line);
        if (found.length === 0) continue;
        filesWithHits.add(relative);
        for (const hit of found) {
          totalMatches += 1;
          if (matches.length >= GREP_MATCH_CAP) continue;
          const visible = line.trim();
          const clipped = visible.length > GREP_LINE_CHARS ? visible.slice(0, GREP_LINE_CHARS) : visible;
          matches.push({
            file: relative,
            line: index + 1,
            column: hit.index + 1,
            text: this.redactor.redact(clipped),
          });
        }
      }
    }
    const truncated = totalMatches > matches.length;
    const hint = truncated
      ? `Showing first ${GREP_MATCH_CAP} of ${totalMatches} matches; refine pattern or glob`
      : null;
    const bodyLines = [
      `grep "${pattern}": showing ${matches.length} of ${totalMatches}`,
      ...matches.map((match) => `${match.file}:${match.line}:${match.column}: ${match.text}`),
      ...(hint ? [hint] : []),
    ];
    return {
      matches,
      totalMatches,
      fileCount: filesWithHits.size,
      truncated,
      hint,
      text: wrapData({
        source: `grep:${pattern}`,
        trust: "untrusted",
        body: bodyLines.join("\n"),
        redactor: this.redactor,
      }),
    };
  }

  lastObservedFileHash(requestedPath: string): string | null {
    const absolute = path.isAbsolute(requestedPath)
      ? requestedPath
      : path.resolve(this.worktreeReal, requestedPath);
    if (!fs.existsSync(absolute)) return null;
    return this.hashCache.get(fs.realpathSync(absolute));
  }

  private readResolved(
    resolved: { realPath: string; relativePath: string },
    range: LineRange | undefined,
  ): FileReadResult {
    const buffer = fs.readFileSync(resolved.realPath);
    const fileHash = sha256(buffer);
    this.hashCache.remember(resolved.realPath, fileHash);
    if (containsNul(buffer)) return this.binaryResult(resolved.relativePath, buffer, fileHash);
    const source = buffer.toString("utf8");
    const allLines = splitLines(source);
    if (range !== undefined) validateRange(range);
    const window = selectWindow(allLines, range, this.readLineCap);
    const selected = allLines.slice(window.startIndex, window.endIndex);
    const rangeHash = sha256(selected.join("\n"));
    const requestedCount = requestedLineCount(allLines.length, range);
    const outline =
      range === undefined && allLines.length > this.readLineCap
        ? this.outlineExtractor.extract(resolved.relativePath, source)
        : [];
    const numbered = selected.map((line, offset) =>
      renderNumberedLine(line, window.startIndex + offset + 1, allLines.length, this.redactor),
    );
    const omittedLineCount = Math.max(0, requestedCount - numbered.length);
    const instruction =
      window.truncated || (range === undefined && allLines.length > this.readLineCap)
        ? rangeInstruction(allLines.length)
        : null;
    const returnedStart = numbered[0]?.lineNumber ?? null;
    const returnedEnd = numbered[numbered.length - 1]?.lineNumber ?? null;
    const body = renderTextBody({
      fileHash,
      rangeHash,
      outlineText: this.outlineExtractor.format(outline, allLines.length),
      omittedLineCount,
      numbered,
      instruction,
    });
    return {
      relativePath: resolved.relativePath,
      binary: false,
      bytes: buffer.length,
      mimeGuess: null,
      totalLines: allLines.length,
      fileHash,
      rangeHash,
      lines: numbered,
      outline,
      truncated: window.truncated || omittedLineCount > 0,
      omittedLineCount,
      instruction,
      returnedStart,
      returnedEnd,
      text: wrapData({
        source: `file:${resolved.relativePath}`,
        trust: "untrusted",
        body,
        redactor: this.redactor,
      }),
    };
  }

  private binaryResult(relativePath: string, buffer: Buffer, fileHash: string): FileReadResult {
    const extension = path.extname(relativePath).toLowerCase();
    const mimeGuess = MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
    const body = [
      "binary: true",
      `bytes: ${buffer.length}`,
      `mimeGuess: ${mimeGuess}`,
      `fileHash: ${fileHash}`,
      "Binary file omitted from the model context.",
    ].join("\n");
    return {
      relativePath,
      binary: true,
      bytes: buffer.length,
      mimeGuess,
      totalLines: 0,
      fileHash,
      rangeHash: fileHash,
      lines: [],
      outline: [],
      truncated: false,
      omittedLineCount: 0,
      instruction: null,
      returnedStart: null,
      returnedEnd: null,
      text: wrapData({
        source: `file:${relativePath}`,
        trust: "untrusted",
        body,
        redactor: this.redactor,
      }),
    };
  }

  private collectFiles(includeLocalPackageSource: boolean): string[] {
    const rules = loadGitignore(this.worktreeReal);
    const found: string[] = [];
    const visit = (directory: string): void => {
      const entries = fs.readdirSync(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".git") continue;
        if (entry.name === "node_modules" && !includeLocalPackageSource) continue;
        const full = path.join(directory, entry.name);
        const relative = relativePosix(this.worktreeReal, full);
        if (entry.isSymbolicLink()) {
          this.considerSymlink(full, found);
          continue;
        }
        if (entry.isDirectory()) {
          if (isGitignored(rules, relative, true)) continue;
          visit(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (isGitignored(rules, relative, false) || isSecretFile(relative)) continue;
        found.push(full);
      }
    };
    visit(this.worktreeReal);
    found.sort((left, right) =>
      relativePosix(this.worktreeReal, left).localeCompare(relativePosix(this.worktreeReal, right)),
    );
    return found;
  }

  private considerSymlink(full: string, found: string[]): void {
    let real: string;
    try {
      real = fs.realpathSync(full);
    } catch (error) {
      if (error instanceof Error) return;
      throw error;
    }
    if (!isInsideRoot(this.worktreeReal, real)) return;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(real);
    } catch (error) {
      if (error instanceof Error) return;
      throw error;
    }
    if (!stat.isFile()) return;
    if (isSecretFile(full) || isSecretFile(real)) return;
    found.push(full);
  }
}

function containsNul(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, NUL_PROBE_BYTES)).includes(0);
}

function validateRange(range: LineRange): void {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 1 || range.end < range.start) {
    throw new InvalidLineRangeError(range.start, range.end);
  }
}

function selectWindow(
  allLines: readonly string[],
  range: LineRange | undefined,
  cap: number,
): { startIndex: number; endIndex: number; truncated: boolean } {
  if (allLines.length === 0) return { startIndex: 0, endIndex: 0, truncated: false };
  const requestedStart = range ? range.start : 1;
  const requestedEnd = range ? range.end : allLines.length;
  if (requestedStart > allLines.length) return { startIndex: allLines.length, endIndex: allLines.length, truncated: false };
  const startIndex = requestedStart - 1;
  const availableEnd = Math.min(requestedEnd, allLines.length);
  const cappedEnd = Math.min(availableEnd, startIndex + cap);
  return {
    startIndex,
    endIndex: cappedEnd,
    truncated: cappedEnd < availableEnd || (range === undefined && allLines.length > cap),
  };
}

function renderNumberedLine(
  line: string,
  lineNumber: number,
  totalLines: number,
  redactor: SecretRedactorPort,
): NumberedLine {
  const truncated = line.length > LONG_LINE_CHARS;
  const text = truncated
    ? `Line ${lineNumber} is ${formatGroupedNumber(line.length)} chars (minified/generated); truncated`
    : redactor.redact(line);
  const label = lineLabel(lineNumber, totalLines);
  return {
    lineNumber,
    text,
    display: `${label}: ${text}`,
    truncated,
    originalChars: line.length,
  };
}

function requestedLineCount(totalLines: number, range: LineRange | undefined): number {
  if (totalLines === 0) return 0;
  if (range === undefined) return totalLines;
  if (range.start > totalLines) return 0;
  const end = Math.min(range.end, totalLines);
  return Math.max(0, end - range.start + 1);
}

function rangeInstruction(totalLines: number): string {
  return `File has ${formatGroupedNumber(totalLines)} lines; call read_file(path, { start, end }) for specific ranges`;
}

function renderTextBody(input: {
  readonly fileHash: string;
  readonly rangeHash: string;
  readonly outlineText: string;
  readonly omittedLineCount: number;
  readonly numbered: readonly NumberedLine[];
  readonly instruction: string | null;
}): string {
  const lines = [`fileHash: ${input.fileHash}`, `rangeHash: ${input.rangeHash}`];
  if (input.outlineText.length > 0) lines.push(input.outlineText);
  if (input.omittedLineCount > 0) lines.push(`${input.omittedLineCount} lines omitted`);
  for (const line of input.numbered) lines.push(line.display);
  if (input.instruction) lines.push(input.instruction);
  return lines.join("\n");
}
