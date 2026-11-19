import type { GitExecResult } from "./git-runner.js";
import type { RejectedConfigPath } from "./types.js";

export class WorktreeSlotError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class GitCommandFailedError extends WorktreeSlotError {
  readonly args: readonly string[];
  readonly result: GitExecResult;

  constructor(args: readonly string[], result: GitExecResult) {
    super(
      "git_command_failed",
      `git ${args.join(" ")} failed (${result.exitCode}): ${trimGitText(result.stderr || result.stdout)}`,
    );
    this.args = args;
    this.result = result;
  }
}

export class SlotBusyError extends WorktreeSlotError {
  readonly args: readonly string[];
  readonly result: GitExecResult;

  constructor(args: readonly string[], result: GitExecResult) {
    super(
      "slot_busy",
      `git ${args.join(" ")} stayed busy after retries: ${trimGitText(result.stderr || result.stdout)}`,
    );
    this.args = args;
    this.result = result;
  }
}

export class GitLfsFetchError extends WorktreeSlotError {
  constructor(message: string) {
    super("git_lfs_fetch_failed", message);
  }
}

export class BeforeSlotResetRequiredError extends WorktreeSlotError {
  constructor() {
    super(
      "before_slot_reset_required",
      "beforeSlotReset(slotPath) is required before resetting or removing a worktree slot",
    );
  }
}

export class SecretConfigCopyRejectedError extends WorktreeSlotError {
  readonly rejected: readonly RejectedConfigPath[];

  constructor(rejected: readonly RejectedConfigPath[]) {
    const summary = rejected.map((item) => `${item.path} (${item.reason})`).join(", ");
    super("secret_config_rejected", `refusing to copy secret or vault paths into a worktree: ${summary}`);
    this.rejected = rejected;
  }
}

export class SlotOwnershipError extends WorktreeSlotError {
  constructor(slotPath: string) {
    super(
      "ownership_marker_mismatch",
      `refusing to delete ${slotPath}: missing or mismatched .ef-harness-slot-owner marker`,
    );
  }
}

export class IntegrationLeaseRejectedError extends WorktreeSlotError {
  readonly reason: "missing_lease" | "unauthorized" | "stale_epoch";

  constructor(reason: "missing_lease" | "unauthorized" | "stale_epoch", message: string) {
    super("integration_lease_rejected", message);
    this.reason = reason;
  }
}

export class IntegrationWorktreeExclusivityError extends WorktreeSlotError {
  constructor(purpose: string) {
    super(
      "integration_worktree_exclusive",
      `workers and merge-candidate builds cannot execute in the integration worktree (purpose: ${purpose})`,
    );
  }
}

export class IntegrationRefMissingError extends WorktreeSlotError {
  constructor() {
    super(
      "integration_ref_missing",
      "refs/heads/harness/integration does not exist; pass baseCommit to create it or create the ref first",
    );
  }
}

export class IntegrationRefMismatchError extends WorktreeSlotError {
  constructor(expected: string, actual: string) {
    super(
      "integration_ref_mismatch",
      `fast-forward sha ${expected} does not match refs/heads/harness/integration (${actual}) after CAS`,
    );
  }
}

function trimGitText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 500) return trimmed || "no git output";
  return `${trimmed.slice(0, 500)}…`;
}
