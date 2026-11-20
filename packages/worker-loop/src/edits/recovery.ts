import {
  EditStuckEscalation,
  FreshRegionViewError,
  NearestCandidateError,
  ReplaceLinesUnlockedError,
} from "./errors.js";
import { normalizePosix } from "./scope.js";

export interface ClosestFailureView {
  readonly startLine: number;
  readonly endLine: number;
  readonly snippet: string;
  readonly numberedView: string;
  readonly rangeHash: string;
}

export type RecoveryFailure =
  | NearestCandidateError
  | FreshRegionViewError
  | ReplaceLinesUnlockedError
  | EditStuckEscalation;

function trackerKey(attemptId: string, filePath: string): string {
  return `${attemptId}\0${normalizePosix(filePath)}`;
}

/**
 * Consecutive failed searches per attempt and file.
 * `replace_lines` stays enabled for that pair once the third failure lands.
 * A later success clears the consecutive count and does not revoke the unlock.
 */
export class EditRecoveryTracker {
  private readonly failures = new Map<string, number>();
  private readonly unlocked = new Set<string>();

  failureCount(attemptId: string, filePath: string): number {
    return this.failures.get(trackerKey(attemptId, filePath)) ?? 0;
  }

  isReplaceLinesEnabled(attemptId: string, filePath: string): boolean {
    return this.unlocked.has(trackerKey(attemptId, filePath));
  }

  recordSuccess(attemptId: string, filePath: string): void {
    this.failures.set(trackerKey(attemptId, filePath), 0);
  }

  recordMatchFailure(attemptId: string, filePath: string, closest: ClosestFailureView): RecoveryFailure {
    const key = trackerKey(attemptId, filePath);
    const next = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, next);
    if (next >= 3) this.unlocked.add(key);
    if (next >= 4) return new EditStuckEscalation(attemptId, normalizePosix(filePath), next);
    if (next === 3) {
      return new ReplaceLinesUnlockedError({
        path: normalizePosix(filePath),
        startLine: closest.startLine,
        endLine: closest.endLine,
        rangeHash: closest.rangeHash,
        numberedView: closest.numberedView,
      });
    }
    if (next === 2) {
      return new FreshRegionViewError({
        path: normalizePosix(filePath),
        startLine: closest.startLine,
        endLine: closest.endLine,
        numberedView: closest.numberedView,
      });
    }
    return new NearestCandidateError({
      path: normalizePosix(filePath),
      startLine: closest.startLine,
      endLine: closest.endLine,
      snippet: closest.snippet,
    });
  }
}
