import type { DirtySnapshotEngine } from "./contracts.js";
import { runGit, runGitOrThrow } from "./git-runner.js";

export interface SafetyPointInput {
  readonly repoPath: string;
  readonly targetBranch: string;
  readonly headSha: string;
  readonly dirtyPaths: readonly string[];
  readonly dirtySnapshot?: DirtySnapshotEngine;
  readonly timestamp?: number;
}

export interface SafetyPointRecord {
  readonly safetyRef: string;
  readonly snapshotId: string | null;
  readonly undoMessage: string;
}

export class LandingRollbackSafetyPoint {
  constructor(private readonly dirtySnapshot?: DirtySnapshotEngine) {}

  async writePreLandSafetyPoint(input: SafetyPointInput): Promise<SafetyPointRecord> {
    const ts = input.timestamp ?? Date.now();
    const safetyRef = `refs/ef-safety/pre-land-${ts}`;
    runGitOrThrow({
      cwd: input.repoPath,
      args: ["update-ref", safetyRef, input.headSha],
      developerCheckout: false,
    });
    let snapshotId: string | null = null;
    if (input.dirtyPaths.length > 0 && this.dirtySnapshot) {
      const snap = await this.dirtySnapshot.captureDirtySnapshot(input.repoPath, input.dirtyPaths);
      snapshotId = snap.snapshotId;
    }
    const short = input.headSha.slice(0, 7);
    return {
      safetyRef,
      snapshotId,
      undoMessage: `Landed cleanly onto ${input.targetBranch} (${short}) · Undo landing`,
    };
  }

  async undoLanding(input: {
    readonly repoPath: string;
    readonly targetBranch: string;
    readonly safetyRef: string;
    readonly snapshotId?: string | null;
  }): Promise<{ readonly restoredSha: string }> {
    const restoredSha = runGitOrThrow({
      cwd: input.repoPath,
      args: ["rev-parse", input.safetyRef],
      developerCheckout: false,
    }).stdout.trim();
    runGitOrThrow({
      cwd: input.repoPath,
      args: ["update-ref", `refs/heads/${input.targetBranch}`, restoredSha],
      developerCheckout: false,
    });
    if (input.snapshotId && this.dirtySnapshot) {
      await this.dirtySnapshot.restoreDirtySnapshot(input.repoPath, input.snapshotId);
    }
    return { restoredSha };
  }

  listSafetyRefs(repoPath: string): string[] {
    const refs = runGit({
      cwd: repoPath,
      args: ["for-each-ref", "--format=%(refname)", "refs/ef-safety/"],
      developerCheckout: false,
    }).stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return refs;
  }
}