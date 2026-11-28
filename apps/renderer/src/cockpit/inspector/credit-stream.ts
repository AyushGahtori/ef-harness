import { INITIAL_STREAM_CREDITS } from "./constants.js";
import { RangeLimitError } from "./errors.js";
import type {
  BinaryStreamClient,
  DiffRangeChunk,
  LogByteChunk,
  ScreenshotChunk,
} from "./ports.js";

/** One in-flight binary read consumes one credit. The cap matches Task 033's initial grant. */
export class CreditLimitedStream implements BinaryStreamClient {
  private outstanding = 0;

  constructor(private readonly inner: BinaryStreamClient) {}

  fetchDiffRange(
    attemptId: string,
    filePath: string,
    hunkOffset: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<DiffRangeChunk> {
    return this.run(() => this.inner.fetchDiffRange(attemptId, filePath, hunkOffset, limit, signal));
  }

  fetchLogChunk(
    artifactId: string,
    byteOffset: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<LogByteChunk> {
    return this.run(() => this.inner.fetchLogChunk(artifactId, byteOffset, limit, signal));
  }

  fetchScreenshot(
    artifactId: string,
    byteOffset: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<ScreenshotChunk> {
    return this.run(() => this.inner.fetchScreenshot(artifactId, byteOffset, limit, signal));
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.outstanding >= INITIAL_STREAM_CREDITS) {
      throw new RangeLimitError("stream credits exhausted");
    }
    this.outstanding += 1;
    try {
      return await fn();
    } finally {
      this.outstanding -= 1;
    }
  }
}
