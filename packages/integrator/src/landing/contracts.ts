import type { WorkingTreeEntry } from "./types.js";

/** Task 035 — minimal surface used by landing pre-flight. */
export interface MinGitRepoInspector {
  inspectCheckout(repoPath: string): Promise<{
    readonly headRef: string | null;
    readonly detachedHead: boolean;
    readonly porcelain: readonly WorkingTreeEntry[];
    readonly midOperation: boolean;
  }>;
}

/** Task 037 — dirty snapshot for rollback safety. */
export interface DirtySnapshotEngine {
  captureDirtySnapshot(repoPath: string, paths: readonly string[]): Promise<{
    readonly snapshotId: string;
    readonly treeSha: string;
  }>;
  restoreDirtySnapshot(repoPath: string, snapshotId: string): Promise<void>;
}

/** Task 039 — CAS ref updates when landing succeeds. */
export interface RefLeaseAndCasManager {
  compareAndSwapRef(
    repoPath: string,
    refName: string,
    expectedSha: string,
    newSha: string,
  ): Promise<{ readonly ok: boolean; readonly actualSha: string | null }>;
}

/** Task 101 — summary shown on the landing preview card. */
export interface LandingSummaryGenerator {
  buildPreviewSummary(input: {
    readonly commitCount: number;
    readonly changedFileCount: number;
    readonly additions: number;
    readonly deletions: number;
  }): Promise<string>;
}

/** Task 171 — base sync for Path D before touching developer branch. */
export interface BaseSyncIntegrationMerger {
  runIsolatedBaseSync(input: {
    readonly repoPath: string;
    readonly targetBranch: string;
    readonly harnessIntegrationRef: string;
  }): Promise<{
    readonly ok: boolean;
    readonly mergedSha: string | null;
    readonly diverged: boolean;
    readonly modifyDeletePaths: readonly string[];
    readonly error?: string;
  }>;
}

/** Task 111 — regression gate for Path D. */
export interface CombinedRegressionGate {
  runInEphemeralWorktree(repoPath: string, sha: string): Promise<{ readonly green: boolean }>;
}

export interface LandingDependencies {
  readonly minGit?: MinGitRepoInspector;
  readonly dirtySnapshot?: DirtySnapshotEngine;
  readonly refLease?: RefLeaseAndCasManager;
  readonly landingSummary?: LandingSummaryGenerator;
  readonly baseSync?: BaseSyncIntegrationMerger;
  readonly regressionGate?: CombinedRegressionGate;
}