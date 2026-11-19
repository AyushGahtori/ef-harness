import { ArtifactNotFoundError, InvalidStreamRequestError } from "./errors.js";
import { assertJsonRpcWithinCap, jsonByteLength } from "./json-guard.js";
import type { ArtifactLogReader, LogRangeResult, LogSearchResult } from "./ports.js";

export interface LogRangeParams {
  readonly artifactId: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface LogSearchParams {
  readonly artifactId: string;
  readonly query: string;
  readonly maxMatches: number;
}

/**
 * Viewport log reads. Delegates to `ArtifactManager.readLogRange` / `queryLogStream`
 * and never asks for a wider line span than the caller requested.
 */
export class RangeLogHandler {
  constructor(
    private readonly logs: ArtifactLogReader,
    private readonly belongsToProject: (artifactId: string) => boolean,
  ) {}

  async logRange(params: LogRangeParams): Promise<LogRangeResult> {
    this.assertVisible(params.artifactId);
    assertLineSpan(params.startLine, params.endLine);
    const result = await this.logs.readLogRange(params.artifactId, params.startLine, params.endLine);
    assertJsonRpcWithinCap(jsonByteLength(result));
    return result;
  }

  async logSearch(params: LogSearchParams): Promise<LogSearchResult> {
    this.assertVisible(params.artifactId);
    if (typeof params.query !== "string" || params.query.length === 0) {
      throw new InvalidStreamRequestError("log search query is required");
    }
    if (!Number.isSafeInteger(params.maxMatches) || params.maxMatches < 1) {
      throw new InvalidStreamRequestError("maxMatches must be a positive integer");
    }
    const result = await this.logs.queryLogStream(params.artifactId, params.query, params.maxMatches);
    assertJsonRpcWithinCap(jsonByteLength(result));
    return result;
  }

  private assertVisible(artifactId: string): void {
    if (typeof artifactId !== "string" || artifactId.length === 0 || !this.belongsToProject(artifactId)) {
      throw new ArtifactNotFoundError(typeof artifactId === "string" ? artifactId : "");
    }
  }
}

function assertLineSpan(startLine: number, endLine: number): void {
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine) {
    throw new InvalidStreamRequestError("log range bounds must be positive integers with endLine >= startLine");
  }
}
