import { ArtifactNotFoundError, InvalidStreamRequestError, PayloadExceedsJsonCapError } from "./errors.js";
import { assertJsonRpcWithinCap, jsonByteLength } from "./json-guard.js";
import type { DiffHunkBody, DiffSource } from "./ports.js";

export interface DiffGetParams {
  readonly task: string;
  readonly file: string;
  readonly hunks?: readonly number[];
}

export interface DiffGetHunk {
  readonly index: number;
  readonly header: string;
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly lines?: readonly string[];
}

export interface DiffGetResult {
  readonly task: string;
  readonly file: string;
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly hunks: readonly DiffGetHunk[];
  readonly bodies: "omitted" | "viewport";
}

/**
 * Diff tab fetcher. Headers come back first. Hunk bodies are loaded only for
 * the indexes the viewer asked for, and the JSON result must stay under 1 MB.
 */
export class RangeDiffHandler {
  constructor(
    private readonly projectId: string,
    private readonly diffs: DiffSource,
  ) {}

  async diffGet(params: DiffGetParams): Promise<DiffGetResult> {
    if (typeof params.task !== "string" || params.task.length === 0) {
      throw new InvalidStreamRequestError("diff task is required");
    }
    if (typeof params.file !== "string" || params.file.length === 0) {
      throw new InvalidStreamRequestError("diff file is required");
    }
    const summary = await this.diffs.summarize(this.projectId, params.task, params.file);
    if (!summary || (summary.projectId !== undefined && summary.projectId !== this.projectId)) {
      throw new ArtifactNotFoundError(params.file);
    }
    const requested = normalizeHunks(params.hunks);
    const bodies = new Map<number, DiffHunkBody>();
    if (requested.length > 0) {
      const loaded = await this.diffs.readHunks(this.projectId, params.task, params.file, requested);
      for (const hunk of loaded) bodies.set(hunk.index, hunk);
      for (const index of requested) {
        if (!bodies.has(index)) throw new InvalidStreamRequestError(`diff hunk ${String(index)} is not in ${params.file}`);
      }
    }
    const hunks: DiffGetHunk[] = summary.hunks.map((hunk) => {
      const body = bodies.get(hunk.index);
      const view: DiffGetHunk = {
        index: hunk.index,
        header: hunk.header,
        oldStart: hunk.oldStart,
        oldCount: hunk.oldCount,
        newStart: hunk.newStart,
        newCount: hunk.newCount,
        insertions: hunk.insertions,
        deletions: hunk.deletions,
      };
      if (!body) return view;
      return { ...view, lines: body.lines };
    });
    const result: DiffGetResult = {
      task: params.task,
      file: params.file,
      path: summary.path,
      insertions: summary.insertions,
      deletions: summary.deletions,
      hunks,
      bodies: requested.length > 0 ? "viewport" : "omitted",
    };
    const bytes = jsonByteLength(result);
    try {
      assertJsonRpcWithinCap(bytes);
    } catch (error) {
      if (error instanceof PayloadExceedsJsonCapError) throw error;
      throw error;
    }
    return result;
  }
}

function normalizeHunks(hunks: readonly number[] | undefined): number[] {
  if (hunks === undefined || hunks.length === 0) return [];
  const indexes: number[] = [];
  for (const index of hunks) {
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new InvalidStreamRequestError("diff hunk indexes must be non-negative integers");
    }
    indexes.push(index);
  }
  return indexes;
}
