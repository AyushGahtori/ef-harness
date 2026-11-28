import { DIFF_CHUNK_BYTES, LARGE_FILE_BYTES } from "./constants.js";
import { el, type InspectorElement } from "./elements.js";
import { RangeLimitError, isAbortError } from "./errors.js";
import { largeFileLabel } from "./format.js";
import { highlightLine, lineClass } from "./highlight.js";
import { ResidentLedger, utf8Size } from "./memory.js";
import type { BinaryStreamClient, DiffRangeChunk } from "./ports.js";
import { assertPreRedacted } from "./redaction.js";
import type { DiffFileSummary, DiffHunkBody, DiffLayout } from "./types.js";

interface LoadedChunk {
  readonly filePath: string;
  readonly hunkOffset: number;
  readonly hunks: readonly DiffHunkBody[];
  readonly bytes: number;
}

/**
 * File tree plus a syntax-colored unified or split diff.
 * Bodies load only when the user opens a file, one 64 KB chunk at a time.
 */
export class LazyRangeDiffViewer {
  private attemptId = "";
  private files: readonly DiffFileSummary[] = [];
  private layout: DiffLayout = "unified";
  private loaded: LoadedChunk | null = null;
  private blocked: string | null = null;

  constructor(
    private readonly binary: BinaryStreamClient,
    private readonly ledger: ResidentLedger,
  ) {}

  setFiles(attemptId: string, files: readonly DiffFileSummary[]): void {
    this.discard();
    this.attemptId = attemptId;
    this.files = files;
  }

  setLayout(layout: DiffLayout): void {
    this.layout = layout;
  }

  firstLine(filePath: string): number {
    const hunk = this.loaded?.filePath === filePath ? this.loaded.hunks[0] : undefined;
    return hunk?.newStart ?? 1;
  }

  async loadFile(
    filePath: string,
    hunkOffset: number,
    signal: AbortSignal,
    live: () => boolean,
  ): Promise<"applied" | "discarded" | "blocked"> {
    const limit = DIFF_CHUNK_BYTES;
    let chunk: DiffRangeChunk;
    try {
      chunk = await this.binary.fetchDiffRange(this.attemptId, filePath, hunkOffset, limit, signal);
    } catch (error) {
      if (isAbortError(error) || !live()) return "discarded";
      throw error;
    }
    if (!live() || chunk.attemptId !== this.attemptId || chunk.filePath !== filePath) {
      return "discarded";
    }
    if (chunk.limit > DIFF_CHUNK_BYTES || chunk.bytesRead > DIFF_CHUNK_BYTES) {
      throw new RangeLimitError("diff chunk exceeded 64 KB");
    }
    const text = chunk.hunks.flatMap((hunk) => hunk.lines).join("\n");
    if (utf8Size(text) > DIFF_CHUNK_BYTES) {
      throw new RangeLimitError("diff text exceeded 64 KB");
    }
    try {
      assertPreRedacted(text, "diff");
    } catch {
      this.blocked = filePath;
      this.dropLoaded();
      return "blocked";
    }
    this.dropLoaded();
    const key = `diff:${this.attemptId}:${filePath}:${hunkOffset}`;
    this.ledger.retain(key, utf8Size(text));
    this.loaded = { filePath, hunkOffset, hunks: chunk.hunks, bytes: utf8Size(text) };
    this.blocked = null;
    return "applied";
  }

  discard(): void {
    this.dropLoaded();
    this.blocked = null;
    this.files = [];
    this.attemptId = "";
  }

  render(): InspectorElement {
    const rows = this.files.map((file) => this.renderFile(file));
    return el("tabpanel", "Diff", "", rows, { layout: this.layout });
  }

  private renderFile(file: DiffFileSummary): InspectorElement {
    const counts = `+${file.insertions} / -${file.deletions}`;
    const large = file.byteSize > LARGE_FILE_BYTES;
    const open = this.loaded?.filePath === file.path;
    const children: InspectorElement[] = [
      el("button", file.path, counts, [], { bytes: file.byteSize, large }),
    ];
    if (large && !open) {
      children.push(el("button", largeFileLabel(file.byteSize), file.path));
    }
    if (this.blocked === file.path) {
      children.push(el("alert", "Diff blocked", "Blocked: diff preview was not pre-redacted"));
    }
    if (open && this.loaded) {
      children.push(this.renderHunks(this.loaded.hunks));
    }
    return el("row", file.path, counts, children);
  }

  private renderHunks(hunks: readonly DiffHunkBody[]): InspectorElement {
    const lines = hunks.flatMap((hunk) =>
      hunk.lines.map((line) => {
        const tokens = highlightLine(line).map((token) =>
          el("token", token.kind, token.text, [], { kind: token.kind }),
        );
        const side = lineClass(line);
        if (this.layout === "split") {
          const left = side === "add" ? "" : line;
          const right = side === "del" ? "" : line;
          return el("line", side, line, tokens, { column: "split", left, right });
        }
        return el("line", side, line, tokens, { column: "unified" });
      }),
    );
    return el("region", "Diff view", "", lines, { layout: this.layout });
  }

  private dropLoaded(): void {
    if (!this.loaded) return;
    this.ledger.release(
      `diff:${this.attemptId}:${this.loaded.filePath}:${this.loaded.hunkOffset}`,
    );
    this.loaded = null;
  }
}
