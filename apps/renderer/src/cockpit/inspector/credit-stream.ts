import { INITIAL_STREAM_CREDITS } from "./constants.js";
import type {
  BinaryStreamClient,
  DiffRangeChunk,
  LogByteChunk,
  ScreenshotChunk,
} from "./ports.js";

interface CreditWaiter {
  grant(): void;
  fail(error: Error): void;
}

/** One in-flight binary read consumes one credit. The cap matches Task 033's initial grant. */
export class CreditLimitedStream implements BinaryStreamClient {
  private outstanding = 0;
  private readonly waiters: CreditWaiter[] = [];

  constructor(private readonly inner: BinaryStreamClient) {}

  fetchDiffRange(
    attemptId: string,
    filePath: string,
    hunkOffset: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<DiffRangeChunk> {
    return this.run(
      () => this.inner.fetchDiffRange(attemptId, filePath, hunkOffset, limit, signal),
      signal,
    );
  }

  fetchLogChunk(
    artifactId: string,
    byteOffset: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<LogByteChunk> {
    return this.run(() => this.inner.fetchLogChunk(artifactId, byteOffset, limit, signal), signal);
  }

  fetchScreenshot(
    artifactId: string,
    byteOffset: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<ScreenshotChunk> {
    return this.run(() => this.inner.fetchScreenshot(artifactId, byteOffset, limit, signal), signal);
  }

  private async run<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      if (signal.aborted) throw abortError(signal);
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError(signal));
    if (this.outstanding < INITIAL_STREAM_CREDITS) {
      this.outstanding += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: CreditWaiter = {
        grant: (): void => {
          signal.removeEventListener("abort", onAbort);
          this.outstanding += 1;
          resolve();
        },
        fail(error: Error): void {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      };
      const onAbort = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        waiter.fail(abortError(signal));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    this.outstanding -= 1;
    const next = this.waiters.shift();
    if (next) next.grant();
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("The operation was aborted.", "AbortError");
}
