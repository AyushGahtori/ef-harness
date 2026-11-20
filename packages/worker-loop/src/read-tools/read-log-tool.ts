import { ArtifactNotFoundError, InvalidLineRangeError } from "./errors.js";
import type { ArtifactLogPort, LogLineWindow } from "./artifact-log.js";
import { READ_LOG_MAX_BYTES, READ_LOG_MAX_LINES } from "./model-profile.js";
import { oneLineSummary } from "./one-line-summary.js";
import { wrapData } from "./provenance.js";
import { compileSafeRegex } from "./safe-regex.js";
import type { SecretRedactorPort } from "./secret-redactor.js";
import { createDefaultRedactor } from "./secret-redactor.js";
import { lineLabel } from "./text-util.js";

export interface ReadLogOptions {
  readonly query?: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly maxLines?: number;
}

export interface ReadLogLine {
  readonly lineNumber: number;
  readonly text: string;
}

export interface ReadLogResult {
  readonly artifactId: string;
  readonly lines: readonly ReadLogLine[];
  readonly totalLines: number;
  readonly totalMatches: number | null;
  readonly truncated: boolean;
  readonly omittedLineCount: number;
  readonly bytesReturned: number;
  readonly hint: string | null;
  readonly oneLine: string;
  readonly text: string;
}

/**
 * `harness.read_log`. Every call is capped at 200 lines and 16 KB so a
 * multi-megabyte artifact never enters model context.
 */
export class ReadLogTool {
  private readonly redactor: SecretRedactorPort;

  constructor(
    private readonly artifacts: ArtifactLogPort,
    redactor?: SecretRedactorPort,
  ) {
    this.redactor = redactor ?? createDefaultRedactor();
  }

  readLog(artifactId: string, options?: ReadLogOptions): ReadLogResult {
    const maxLines = clampMaxLines(options?.maxLines);
    if (options?.query !== undefined && options.query.length > 0) {
      compileSafeRegex(options.query);
      return this.readQuery(artifactId, options.query, maxLines, options);
    }
    return this.readRange(artifactId, maxLines, options);
  }

  private readRange(artifactId: string, maxLines: number, options: ReadLogOptions | undefined): ReadLogResult {
    const startLine = options?.startLine ?? 1;
    const requestedEnd = options?.endLine ?? startLine + maxLines - 1;
    if (!Number.isInteger(startLine) || !Number.isInteger(requestedEnd) || startLine < 1 || requestedEnd < startLine) {
      throw new InvalidLineRangeError(startLine, requestedEnd);
    }
    const endLine = Math.min(requestedEnd, startLine + maxLines - 1);
    let slice;
    try {
      slice = this.artifacts.readLogRange(artifactId, startLine, endLine);
    } catch (error) {
      if (error instanceof ArtifactNotFoundError || error instanceof InvalidLineRangeError) throw error;
      throw error;
    }
    const packed = packLines(
      slice.lines.map((text, index) => ({ lineNumber: startLine + index, text })),
      maxLines,
    );
    const explicitEnd = options?.endLine !== undefined;
    const hitLineCap = requestedEnd - startLine + 1 > maxLines;
    const lastReturned = packed.lines[packed.lines.length - 1]?.lineNumber ?? startLine - 1;
    const moreRemain = lastReturned < slice.totalLines;
    const capped = packed.truncated || hitLineCap || (!explicitEnd && moreRemain);
    const omitted = capped ? Math.max(0, slice.totalLines - lastReturned) : 0;
    const hint = capped
      ? `${omitted} lines omitted; cap is ${READ_LOG_MAX_LINES} lines / ${READ_LOG_MAX_BYTES} bytes; use harness.read_log('${artifactId}', { startLine, endLine })`
      : null;
    return this.finish(artifactId, packed.lines, slice.totalLines, null, capped, omitted, hint);
  }

  private readQuery(
    artifactId: string,
    query: string,
    maxLines: number,
    options: ReadLogOptions,
  ): ReadLogResult {
    const window = lineWindow(options);
    let result;
    try {
      result = this.artifacts.queryLogStream(artifactId, query, maxLines, window);
    } catch (error) {
      if (error instanceof ArtifactNotFoundError || error instanceof InvalidLineRangeError) throw error;
      throw error;
    }
    const packed = packLines(
      result.matches.map((match) => ({ lineNumber: match.lineNumber, text: match.line })),
      maxLines,
    );
    const truncated = result.truncated || packed.truncated || result.totalMatches > packed.lines.length;
    const omitted = Math.max(0, result.totalMatches - packed.lines.length);
    const hint = truncated
      ? `Showing ${packed.lines.length} of ${result.totalMatches} matches; cap is ${READ_LOG_MAX_LINES} lines / ${READ_LOG_MAX_BYTES} bytes; use harness.read_log('${artifactId}', { query, startLine, endLine })`
      : null;
    return this.finish(artifactId, packed.lines, result.totalLines, result.totalMatches, truncated, omitted, hint);
  }

  private finish(
    artifactId: string,
    lines: readonly ReadLogLine[],
    totalLines: number,
    totalMatches: number | null,
    truncated: boolean,
    omittedLineCount: number,
    hint: string | null,
  ): ReadLogResult {
    const redacted = lines.map((line) => ({
      lineNumber: line.lineNumber,
      text: this.redactor.redact(line.text),
    }));
    const bytesReturned = Buffer.byteLength(redacted.map((line) => line.text).join("\n"), "utf8");
    const start = redacted[0]?.lineNumber ?? 0;
    const end = redacted[redacted.length - 1]?.lineNumber ?? 0;
    const body = [
      `artifactId: ${artifactId}`,
      `totalLines: ${totalLines}`,
      ...redacted.map((line) => `${lineLabel(line.lineNumber, totalLines)}: ${line.text}`),
      ...(hint ? [hint] : []),
    ].join("\n");
    return {
      artifactId,
      lines: redacted,
      totalLines,
      totalMatches,
      truncated,
      omittedLineCount,
      bytesReturned,
      hint,
      oneLine: oneLineSummary({ kind: "log", artifactId, start, end }),
      text: wrapData({
        source: `log:${artifactId}`,
        trust: "untrusted",
        body,
        redactor: this.redactor,
      }),
    };
  }
}

function clampMaxLines(requested: number | undefined): number {
  if (requested === undefined) return READ_LOG_MAX_LINES;
  if (!Number.isInteger(requested) || requested < 0) {
    throw new InvalidLineRangeError(requested, requested);
  }
  return Math.min(requested, READ_LOG_MAX_LINES);
}

function lineWindow(options: ReadLogOptions): LogLineWindow | undefined {
  if (options.startLine === undefined && options.endLine === undefined) return undefined;
  const window: { startLine?: number; endLine?: number } = {};
  if (options.startLine !== undefined) window.startLine = options.startLine;
  if (options.endLine !== undefined) window.endLine = options.endLine;
  return window;
}

function packLines(
  lines: readonly ReadLogLine[],
  maxLines: number,
): { lines: ReadLogLine[]; truncated: boolean } {
  const packed: ReadLogLine[] = [];
  let bytes = 0;
  for (const line of lines) {
    if (packed.length >= maxLines) return { lines: packed, truncated: true };
    const size = Buffer.byteLength(line.text, "utf8") + (packed.length > 0 ? 1 : 0);
    if (bytes + size > READ_LOG_MAX_BYTES) {
      if (packed.length === 0) {
        const room = READ_LOG_MAX_BYTES;
        packed.push({ lineNumber: line.lineNumber, text: truncateUtf8(line.text, room) });
      }
      return { lines: packed, truncated: true };
    }
    packed.push(line);
    bytes += size;
  }
  return { lines: packed, truncated: false };
}

function truncateUtf8(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0) {
    const byte = buffer[end] ?? 0;
    if ((byte & 0xc0) !== 0x80) break;
    end -= 1;
  }
  return buffer.subarray(0, end).toString("utf8");
}
