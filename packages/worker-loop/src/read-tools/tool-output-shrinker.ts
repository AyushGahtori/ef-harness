import type { CasBlobStore } from "@ef-harness/db";
import { DEFAULT_STREAM_OVERLAP, toPrefixedSha256, type Sha256Prefixed } from "@ef-harness/shared-contracts";
import { SecretRedactor, StreamingRedactor } from "@ef-harness/shared-observability";
import type { ReadModelProfile } from "./model-profile.js";
import { capsForProfile } from "./model-profile.js";
import { oneLineSummary, type OneLineEvent } from "./one-line-summary.js";
import type { ReadLogResult } from "./read-log-tool.js";
import type { SecretRedactorPort } from "./secret-redactor.js";
import { shrinkBuildOutput, type ShrunkBuildOutput } from "./shrink-build.js";
import { shrinkKbOutput, type KbNodeView, type ShrunkKbOutput } from "./shrink-kb.js";
import { shrinkTestOutput, type ShrunkTestOutput } from "./shrink-test.js";
import { splitLines } from "./text-util.js";
import type { FileReadResult, GrepFilesResult, ListFilesResult } from "./windowed-file-reader.js";

/** Stdout and stderr at or above this size are stored in CasBlobStore. */
const CAS_SPILL_BYTES = 256 * 1024;
const STREAM_CHUNK_BYTES = 64 * 1024;

export interface PreparedHistory {
  readonly text: string;
  readonly oneLine: string;
  readonly artifactId: string | null;
  readonly omitted: boolean;
  /** Present when the full redacted stdout or stderr was stored in CasBlobStore. */
  readonly digest?: Sha256Prefixed;
}

export type HistoryToolInput =
  | { readonly kind: "test"; readonly output: string; readonly artifactId: string }
  | { readonly kind: "build"; readonly output: string; readonly artifactId: string }
  | { readonly kind: "grep"; readonly result: GrepFilesResult; readonly pattern: string }
  | { readonly kind: "file"; readonly result: FileReadResult }
  | { readonly kind: "list"; readonly result: ListFilesResult; readonly glob: string }
  | { readonly kind: "log"; readonly result: ReadLogResult }
  | { readonly kind: "kb"; readonly node: KbNodeView };

/**
 * Every tool result enters model history through `shrinkForHistory`.
 * Raw multi-thousand-line outputs are refused. Oversized stdout and stderr
 * are redacted with `StreamingRedactor` and spilled into `CasBlobStore`.
 */
export interface ToolOutputShrinkerDeps {
  readonly redactor?: SecretRedactorPort;
  readonly blobs?: CasBlobStore;
}

export class ToolOutputShrinker {
  private readonly redactor: SecretRedactorPort;
  private readonly blobs: CasBlobStore | null;

  constructor(
    private readonly modelProfile: ReadModelProfile,
    redactorOrDeps?: SecretRedactorPort | ToolOutputShrinkerDeps,
  ) {
    const deps = resolveDeps(redactorOrDeps);
    this.redactor = deps.redactor ?? new StreamingSecretRedactor(new SecretRedactor());
    this.blobs = deps.blobs ?? null;
  }

  shrinkTestOutput(raw: string, artifactId: string): ShrunkTestOutput {
    return shrinkTestOutput(raw, {
      artifactId,
      modelProfile: this.modelProfile,
      redactor: this.redactor,
    });
  }

  shrinkBuildOutput(raw: string, artifactId: string): ShrunkBuildOutput {
    return shrinkBuildOutput(raw, { artifactId, redactor: this.redactor });
  }

  shrinkKbOutput(node: KbNodeView): ShrunkKbOutput {
    return shrinkKbOutput(node, this.redactor);
  }

  oneLineSummary(event: OneLineEvent): string {
    return oneLineSummary(event);
  }

  async shrinkForHistory(input: HistoryToolInput): Promise<PreparedHistory> {
    const prepared = this.prepare(input);
    const spilled = await this.spill(input, prepared);
    return spilled ?? prepared;
  }

  private prepare(input: HistoryToolInput): PreparedHistory {
    switch (input.kind) {
      case "test": {
        const shrunk = this.shrinkTestOutput(input.output, input.artifactId);
        assertShrunk(input.output, shrunk.text);
        return {
          text: shrunk.text,
          oneLine: shrunk.oneLine,
          artifactId: input.artifactId,
          omitted: splitLines(input.output).length > splitLines(shrunk.text).length,
        };
      }
      case "build": {
        const shrunk = this.shrinkBuildOutput(input.output, input.artifactId);
        assertShrunk(input.output, shrunk.text);
        return {
          text: shrunk.text,
          oneLine: shrunk.oneLine,
          artifactId: input.artifactId,
          omitted:
            shrunk.rawCount > shrunk.shownCount ||
            splitLines(input.output).length > splitLines(shrunk.text).length,
        };
      }
      case "grep":
        return {
          text: input.result.text,
          oneLine: oneLineSummary({
            kind: "grep",
            pattern: input.pattern,
            hits: input.result.totalMatches,
            fileCount: input.result.fileCount,
          }),
          artifactId: null,
          omitted: input.result.truncated,
        };
      case "file": {
        const cap = capsForProfile(this.modelProfile).readLines;
        if (input.result.totalLines > cap && input.result.lines.length > cap) {
          throw new Error("ToolOutputShrinker refused to forward an unwindowed file read");
        }
        const start = input.result.returnedStart ?? 0;
        const end = input.result.returnedEnd ?? 0;
        const oneLine = input.result.binary
          ? oneLineSummary({ kind: "read-binary", path: input.result.relativePath, bytes: input.result.bytes })
          : oneLineSummary({ kind: "read", path: input.result.relativePath, start, end });
        return { text: input.result.text, oneLine, artifactId: null, omitted: input.result.truncated };
      }
      case "list":
        return {
          text: input.result.text,
          oneLine: oneLineSummary({ kind: "list", glob: input.glob, count: input.result.total }),
          artifactId: null,
          omitted: input.result.truncated,
        };
      case "log":
        return {
          text: input.result.text,
          oneLine: input.result.oneLine,
          artifactId: input.result.artifactId,
          omitted: input.result.truncated,
        };
      case "kb": {
        const shrunk = this.shrinkKbOutput(input.node);
        return { text: shrunk.text, oneLine: shrunk.oneLine, artifactId: null, omitted: shrunk.omittedChars > 0 };
      }
      default: {
        const neverInput: never = input;
        return neverInput;
      }
    }
  }

  private async spill(input: HistoryToolInput, prepared: PreparedHistory): Promise<PreparedHistory | null> {
    if (!this.blobs) return null;
    if (input.kind !== "test" && input.kind !== "build") return null;
    const rawBytes = Buffer.byteLength(input.output);
    if (!prepared.omitted && rawBytes < CAS_SPILL_BYTES) return null;
    const redacted = this.redactor.redact(input.output);
    const written = await this.blobs.putBlob(Buffer.from(redacted, "utf8"), {
      holderKind: "project",
      holderId: input.artifactId.length > 0 ? input.artifactId : "tool-output",
    });
    const digest = toPrefixedSha256(written.hash);
    return {
      text: `${prepared.text}\ncas:${digest}`,
      oneLine: prepared.oneLine,
      artifactId: prepared.artifactId,
      omitted: prepared.omitted,
      digest,
    };
  }
}

function isRedactorPort(value: SecretRedactorPort | ToolOutputShrinkerDeps): value is SecretRedactorPort {
  return "redact" in value && typeof value.redact === "function";
}

function resolveDeps(
  redactorOrDeps?: SecretRedactorPort | ToolOutputShrinkerDeps,
): ToolOutputShrinkerDeps {
  if (!redactorOrDeps) return {};
  if (isRedactorPort(redactorOrDeps)) return { redactor: redactorOrDeps };
  return redactorOrDeps;
}

class StreamingSecretRedactor implements SecretRedactorPort {
  constructor(private readonly inner: SecretRedactor) {}

  redact(text: string): string {
    if (text.length === 0) return text;
    const bytes = Buffer.from(text, "utf8");
    const stream = new StreamingRedactor(this.inner, DEFAULT_STREAM_OVERLAP);
    let output = "";
    for (let offset = 0; offset < bytes.byteLength; offset += STREAM_CHUNK_BYTES) {
      output += stream.push(bytes.subarray(offset, offset + STREAM_CHUNK_BYTES));
    }
    output += stream.flush();
    return output;
  }
}

function assertShrunk(raw: string, shrunk: string): void {
  if (splitLines(raw).length > 150 && splitLines(shrunk).length >= splitLines(raw).length) {
    throw new Error("ToolOutputShrinker refused to forward unshrunk tool output into history");
  }
}
