export class GitCommandError extends Error {
  readonly code = "git_command";
  readonly command: string;
  readonly exitCode: number;

  constructor(command: string, exitCode: number, detail: string) {
    super(`git ${command} failed (${exitCode}): ${detail.trim()}`);
    this.name = "GitCommandError";
    this.command = command;
    this.exitCode = exitCode;
  }
}

export class FeatureBranchError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class IntegrationUnverifiedError extends FeatureBranchError {
  constructor(message: string) {
    super("integration_unverified", message);
  }
}

export class ActiveTurnSyncError extends FeatureBranchError {
  constructor(featureId: string) {
    super(
      "active_turn",
      `Feature ${featureId} has a running leaf turn. Sync waits for the leaf boundary and does not mutate the worktree mid-turn.`,
    );
  }
}

export class HistoryRewriteRefusedError extends FeatureBranchError {
  constructor() {
    super(
      "mid_turn_rebase",
      "Feature branch sync uses a fast-forward or a merge commit from harness/integration. Rebase and hard reset are refused so pinned commit SHAs stay reachable.",
    );
  }
}

export class PruneRefusedError extends FeatureBranchError {
  constructor(message: string) {
    super("prune_refused", message);
  }
}

export class CasMismatchError extends FeatureBranchError {
  readonly actualSha: string;

  constructor(actualSha: string) {
    super("cas_mismatch", `compare-and-swap update-ref failed; actual SHA is ${actualSha}`);
    this.actualSha = actualSha;
  }
}

export class DirtyWorktreeSyncError extends FeatureBranchError {
  constructor(featureId: string) {
    super(
      "dirty_worktree",
      `Feature ${featureId} has uncommitted worktree changes. Base sync will not overwrite them.`,
    );
  }
}

export class LockfileIntegrityError extends FeatureBranchError {
  constructor(message: string) {
    super("lockfile_integrity", message);
  }
}

export class LockfileInstallError extends FeatureBranchError {
  constructor(message: string) {
    super("lockfile_install", message);
  }
}

export class RefLeaseHeldError extends FeatureBranchError {
  constructor(ref: string) {
    super("ref_lease_held", `Ref ${ref} is already leased to another holder.`);
  }
}

export class StaleRefLeaseError extends FeatureBranchError {
  constructor(ref: string) {
    super("stale_ref_lease", `Ref lease for ${ref} is stale or expired.`);
  }
}
