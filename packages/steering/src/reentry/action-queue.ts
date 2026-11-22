import type { ColdOpenReport, GatePhase, ProposedAction } from "./types.js";
import type { IndexLockPort, ReentryStateStore } from "./state-store.js";

export interface ResumeConfirmation {
  readonly importViewPaths: readonly string[];
  readonly includeCommitShas: readonly string[];
  readonly includeLockfile: boolean;
  readonly verifyMatchIds: readonly string[];
  readonly recoverOrphanedAttempts: boolean;
  readonly pruneSafeStaleLocks: boolean;
  readonly branchChoice: "sync_harness_base" | "keep_recorded_branch" | "undecided";
  readonly relocateTo: string | null;
  readonly retireObsoleteQuestions: boolean;
  readonly recordVerifiedHumanSteps: boolean;
  readonly recordCliConformanceRequests: boolean;
  readonly recreateWorktrees: boolean;
}

export interface ApplyResult {
  readonly applied: readonly { readonly type: string; readonly detail: string }[];
  readonly skipped: readonly { readonly type: string; readonly reason: string }[];
  readonly phase: GatePhase;
  readonly lifted: boolean;
  readonly blockedReason: string | null;
  readonly projectId: string;
  readonly snapshotId: string;
  readonly integrationHead: string;
  readonly projectRoot: string;
}

export function confirmationForResumeBuild(overrides: Partial<ResumeConfirmation> = {}): ResumeConfirmation {
  return {
    importViewPaths: overrides.importViewPaths ?? [],
    includeCommitShas: overrides.includeCommitShas ?? [],
    includeLockfile: overrides.includeLockfile ?? false,
    verifyMatchIds: overrides.verifyMatchIds ?? [],
    recoverOrphanedAttempts: overrides.recoverOrphanedAttempts ?? true,
    pruneSafeStaleLocks: overrides.pruneSafeStaleLocks ?? true,
    branchChoice: overrides.branchChoice ?? "undecided",
    relocateTo: overrides.relocateTo ?? null,
    retireObsoleteQuestions: overrides.retireObsoleteQuestions ?? true,
    recordVerifiedHumanSteps: overrides.recordVerifiedHumanSteps ?? true,
    recordCliConformanceRequests: overrides.recordCliConformanceRequests ?? true,
    recreateWorktrees: overrides.recreateWorktrees ?? false,
  };
}

/**
 * Applies only the reconciliation items the developer confirmed, then lifts the gate.
 * Unconfirmed questions, lockfile includes, manual commits, and branch switches stay open.
 * A live index lock is never deleted.
 */
export class ReconciledActionQueue {
  constructor(
    private readonly store: ReentryStateStore,
    private readonly locks: IndexLockPort,
  ) {}

  apply(report: ColdOpenReport, confirmation: ResumeConfirmation): ApplyResult {
    const applied: { type: string; detail: string }[] = [];
    const skipped: { type: string; reason: string }[] = [];
    if (report.folderMissing && confirmation.relocateTo === null) {
      for (const action of report.actions) skipped.push({ type: action.type, reason: report.relocatePrompt ?? "folder missing" });
      return this.result(report, applied, skipped, report.relocatePrompt);
    }

    const snap = this.store.snapshot();
    const removed: string[] = [];
    try {
      if (report.folderMissing && confirmation.relocateTo) {
        this.store.relocate(confirmation.relocateTo);
        const record = { type: "relocate_project_folder", detail: confirmation.relocateTo };
        this.store.noteApplied(record);
        applied.push(record);
      }
      for (const action of report.actions) {
        const outcome = this.applyOne(report, action, confirmation, removed);
        if (outcome.applied) {
          this.store.noteApplied(outcome.applied);
          applied.push(outcome.applied);
        }
        if (outcome.skipped) skipped.push(outcome.skipped);
      }
      report.gate.grantResumeClearance();
      report.gate.click("Resume Build");
      return this.result(report, applied, skipped, null);
    } catch (error) {
      this.store.restore(snap);
      for (const lockPath of removed) this.locks.restore(lockPath);
      const message = error instanceof Error ? error.message : "Reconciliation apply failed";
      return this.result(report, [], [{ type: "apply", reason: message }], message);
    }
  }

  private applyOne(
    report: ColdOpenReport,
    action: ProposedAction,
    confirmation: ResumeConfirmation,
    removed: string[],
  ): {
    applied: { type: string; detail: string } | null;
    skipped: { type: string; reason: string } | null;
  } {
    if (action.type === "recover_orphaned_attempts") {
      if (!confirmation.recoverOrphanedAttempts) return skip(action.type, "not_confirmed");
      this.store.markCheckpointed(report.orphans.map((attempt) => attempt.id));
      return done(action.type, action.detail);
    }
    if (action.type === "prune_stale_index_lock" && action.lockPath) {
      if (!confirmation.pruneSafeStaleLocks) return skip(action.type, "not_confirmed");
      const decision = this.locks.assess(action.lockPath);
      if (!decision.safe) return skip(action.type, decision.reason);
      this.locks.remove(action.lockPath);
      removed.push(action.lockPath);
      this.store.noteLockRemoved(action.lockPath);
      return done(action.type, action.lockPath);
    }
    if (action.type === "import_view_edits") {
      const accepted = action.paths.filter((file) => confirmation.importViewPaths.includes(file));
      if (accepted.length === 0) return skip(action.type, "not_confirmed");
      this.store.importViews(accepted);
      return done(action.type, accepted.join(","));
    }
    if (action.type === "include_manual_commits") {
      const accepted = action.shas.filter((sha) => confirmation.includeCommitShas.includes(sha));
      if (accepted.length === 0) return skip(action.type, "not_confirmed");
      this.store.includeCommits(accepted);
      return done(action.type, accepted.join(","));
    }
    if (action.type === "include_lockfile") {
      if (!confirmation.includeLockfile) return skip(action.type, "not_confirmed");
      this.store.includeLockfile();
      return done(action.type, action.detail);
    }
    if (action.type === "resolve_commit_answered") {
      if (!action.matchId || !confirmation.verifyMatchIds.includes(action.matchId)) {
        return skip(action.type, "not_confirmed");
      }
      const match = report.commitAnswered.find((item) => item.matchId === action.matchId);
      if (match?.questionId) this.store.closeQuestions([match.questionId]);
      if (match?.taskId) this.store.verifyTasks([match.taskId]);
      return done(action.type, action.matchId);
    }
    if (action.type === "choose_branch") {
      if (confirmation.branchChoice === "undecided") return skip(action.type, "not_confirmed");
      this.store.chooseBranch(confirmation.branchChoice);
      return done(action.type, confirmation.branchChoice);
    }
    if (action.type === "relocate_project_folder") {
      return { applied: null, skipped: null };
    }
    if (action.type === "request_cli_conformance") {
      if (!confirmation.recordCliConformanceRequests) return skip(action.type, "not_confirmed");
      this.store.recordConformance([action.detail]);
      return done(action.type, action.detail);
    }
    if (action.type === "retire_obsolete_question") {
      if (!confirmation.retireObsoleteQuestions || !action.matchId) return skip(action.type, "not_confirmed");
      this.store.retireQuestions([action.matchId]);
      return done(action.type, action.matchId);
    }
    if (action.type === "record_verified_human_step") {
      if (!confirmation.recordVerifiedHumanSteps || !action.matchId) return skip(action.type, "not_confirmed");
      this.store.recordHumanSteps([action.matchId]);
      return done(action.type, action.matchId);
    }
    if (action.type === "recreate_worktree") {
      if (!confirmation.recreateWorktrees) return skip(action.type, "not_confirmed");
      this.store.recordWorktreeRecreate([action.detail]);
      return done(action.type, action.detail);
    }
    return skip(action.type, "unsupported");
  }

  private result(
    report: ColdOpenReport,
    applied: readonly { type: string; detail: string }[],
    skipped: readonly { type: string; reason: string }[],
    blockedReason: string | null,
  ): ApplyResult {
    return {
      applied,
      skipped,
      phase: report.gate.phase,
      lifted: report.gate.phase === "RESUMED" || report.gate.phase === "OPEN",
      blockedReason,
      projectId: this.store.projectId,
      snapshotId: this.store.snapshotId,
      integrationHead: this.store.integrationHead,
      projectRoot: this.store.projectRoot,
    };
  }
}

function done(type: string, detail: string): {
  applied: { type: string; detail: string };
  skipped: null;
} {
  return { applied: { type, detail }, skipped: null };
}

function skip(type: string, reason: string): {
  applied: null;
  skipped: { type: string; reason: string };
} {
  return { applied: null, skipped: { type, reason } };
}
