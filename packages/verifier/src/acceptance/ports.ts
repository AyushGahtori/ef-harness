import type { SearchDivergence, QueuedRuleCheck } from "./types.js";

export interface SearchVerification {
  readonly divergences: readonly SearchDivergence[];
  readonly checked: number;
  readonly truncated: boolean;
}

/** Local stand-in for Task 018 `KnowledgeSearchService.verifyRecordedSearchReads`. */
export interface KnowledgeSearchPort {
  verifyRecordedSearchReads(input: {
    readonly attempt: string;
    readonly limit: number;
  }): SearchVerification;
}

/** Local stand-in for Task 077 diff touch detection. */
export interface DiffTouchPort {
  detectTouches(input: {
    readonly task: string;
    readonly attempt: string;
    readonly commitSha: string | null;
    readonly payload: unknown;
  }): readonly string[];
}

/** Local stand-in for Task 089 diff-touched rule check queue. */
export interface RuleCheckQueuePort {
  queueRuleChecks(request: QueuedRuleCheck): void;
}

export type CleanCheckStatus = "pass" | "fail" | "skip" | "missing" | "error";

export interface RerunCheckReceipt {
  readonly checkId: string;
  readonly status: CleanCheckStatus;
  readonly artifactDigest: string;
  readonly receipt: string | null;
}

/** Local stand-in for Task 060 `CleanVerifierRunner`. */
export interface CleanVerifierPort {
  rerunCurrentChecks(input: {
    readonly task: string;
    readonly attempt: string;
    readonly commitSha: string;
    readonly checkIds: readonly string[];
  }): readonly RerunCheckReceipt[];
}

/** Local stand-in for Task 029 `ArtifactManager.archiveClosedAttemptTurnLog`. */
export interface TurnLogArchivePort {
  archiveClosedAttemptTurnLog(attempt: string): void;
}
