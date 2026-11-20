import { ArtifactNotFoundError, InvalidLineRangeError } from "./errors.js";
import { compileSafeRegex } from "./safe-regex.js";
import { splitLines } from "./text-util.js";

/**
 * Port for `ArtifactManager.readLogRange` / `queryLogStream` (Task 029).
 * Line numbers are 1-based and inclusive. The optional query window is a
 * local extension; the Task 029 adapter may filter matches after streaming.
 */
export interface LogLineWindow {
  readonly startLine?: number;
  readonly endLine?: number;
}

export interface LogRangeResult {
  readonly lines: readonly string[];
  readonly totalLines: number;
  readonly truncated: boolean;
}

export interface LogQueryMatch {
  readonly lineNumber: number;
  readonly line: string;
}

export interface LogQueryResult {
  readonly matches: readonly LogQueryMatch[];
  readonly totalMatches: number;
  readonly totalLines: number;
  readonly truncated: boolean;
}

export interface ArtifactLogPort {
  readLogRange(artifactId: string, startLine: number, endLine: number): LogRangeResult;
  queryLogStream(
    artifactId: string,
    pattern: string,
    maxMatches: number,
    range?: LogLineWindow,
  ): LogQueryResult;
}

export class MemoryArtifactLogStore implements ArtifactLogPort {
  private readonly logs = new Map<string, readonly string[]>();

  put(artifactId: string, text: string): void {
    this.logs.set(artifactId, Object.freeze(splitLines(text)));
  }

  has(artifactId: string): boolean {
    return this.logs.has(artifactId);
  }

  readLogRange(artifactId: string, startLine: number, endLine: number): LogRangeResult {
    const lines = this.linesOf(artifactId);
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
      throw new InvalidLineRangeError(startLine, endLine);
    }
    if (startLine > lines.length) {
      return { lines: [], totalLines: lines.length, truncated: false };
    }
    const end = Math.min(endLine, lines.length);
    return {
      lines: lines.slice(startLine - 1, end),
      totalLines: lines.length,
      truncated: false,
    };
  }

  queryLogStream(
    artifactId: string,
    pattern: string,
    maxMatches: number,
    range?: LogLineWindow,
  ): LogQueryResult {
    const lines = this.linesOf(artifactId);
    const expression = compileSafeRegex(pattern);
    const start = range?.startLine ?? 1;
    const end = range?.endLine ?? lines.length;
    if (start < 1 || end < start) throw new InvalidLineRangeError(start, end);
    const matches: LogQueryMatch[] = [];
    let totalMatches = 0;
    for (let index = Math.max(1, start); index <= Math.min(end, lines.length); index += 1) {
      const line = lines[index - 1] ?? "";
      const found = expression.execAll(line);
      if (found.length === 0) continue;
      totalMatches += found.length;
      if (matches.length < maxMatches) {
        matches.push({ lineNumber: index, line });
      }
    }
    return {
      matches,
      totalMatches,
      totalLines: lines.length,
      truncated: totalMatches > matches.length,
    };
  }

  private linesOf(artifactId: string): readonly string[] {
    const lines = this.logs.get(artifactId);
    if (!lines) throw new ArtifactNotFoundError(artifactId);
    return lines;
  }
}
