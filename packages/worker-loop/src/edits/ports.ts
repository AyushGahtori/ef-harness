import type { EditFormat } from "./errors.js";
import { hashFileContent } from "./hash.js";
import { normalizePosix } from "./scope.js";

/**
 * Local port of Task 053 `ModelProfile`. Only `editFormat` is consumed.
 * Swap this for the sibling `ModelProfile` when that package is wired.
 */
export interface ModelProfileEditView {
  readonly editFormat: EditFormat;
  readonly family?: string;
}

/**
 * Local port of Task 055 `WindowedFileReader` hash cache.
 * `observedContent` is optional so a hash-only reader still detects staleness;
 * when the snapshot is present, external-change errors limit the numbered view
 * to the modified line span.
 */
export interface WindowedFileReaderPort {
  observedContentHash(attemptId: string, relativePath: string): string | undefined;
  observedContent?(attemptId: string, relativePath: string): string | undefined;
}

interface Snapshot {
  readonly hash: string;
  readonly content: string;
}

function cacheKey(attemptId: string, relativePath: string): string {
  return `${attemptId}\0${normalizePosix(relativePath)}`;
}

/** In-memory stand-in a caller can fill from `WindowedFileReader.readFile` results. */
export class MemoryReadObservationCache implements WindowedFileReaderPort {
  private readonly snapshots = new Map<string, Snapshot>();

  note(attemptId: string, relativePath: string, content: string): void {
    this.snapshots.set(cacheKey(attemptId, relativePath), {
      hash: hashFileContent(content),
      content,
    });
  }

  observedContentHash(attemptId: string, relativePath: string): string | undefined {
    return this.snapshots.get(cacheKey(attemptId, relativePath))?.hash;
  }

  observedContent(attemptId: string, relativePath: string): string | undefined {
    return this.snapshots.get(cacheKey(attemptId, relativePath))?.content;
  }
}
