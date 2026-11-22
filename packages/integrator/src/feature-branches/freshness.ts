import type { ParallelFeatureBranchManager } from "./branch-manager.js";
import { ActiveTurnSyncError, DirtyWorktreeSyncError, GitCommandError } from "./errors.js";
import { diffNameOnly, revParse } from "./git.js";
import { LocalMergeTreeScanner } from "./merge-tree.js";
import {
  LOCKFILE_PATHS,
  SHARED_CONTRACT_PREFIXES,
  type FreshnessPlan,
  type FreshnessReason,
  type SyncOutcome,
} from "./types.js";

export type FreshnessApply =
  | { readonly action: "skipped"; readonly plan: FreshnessPlan }
  | { readonly action: "deferred"; readonly reason: "active_turn" | "dirty_worktree"; readonly plan: FreshnessPlan }
  | { readonly action: "held"; readonly reason: "textual_conflict"; readonly plan: FreshnessPlan }
  | { readonly action: "synced"; readonly plan: FreshnessPlan; readonly outcome: SyncOutcome };

/**
 * Decides whether a still-building feature must absorb a newly landed integration commit.
 * Disjoint clean branches are left alone. Lockfile, read-set, and merge-tree conflicts
 * wait for the next leaf boundary and never rebase a running worktree.
 */
export class SmartBranchFreshnessSync {
  constructor(
    private readonly branches: ParallelFeatureBranchManager,
    private readonly mergeTree = new LocalMergeTreeScanner(),
  ) {}

  plan(featureId: string): FreshnessPlan {
    const plan = this.decide(featureId);
    this.branches.refreshBehind(featureId);
    if (plan.action === "skip") this.branches.markActive(featureId);
    else this.branches.markScheduled(featureId, plan.reason);
    return plan;
  }

  applyDue(featureId: string): FreshnessApply {
    const plan = this.plan(featureId);
    if (plan.action === "skip") return { action: "skipped", plan };
    if (this.branches.runningTurnCount(featureId) > 0) {
      return { action: "deferred", reason: "active_turn", plan };
    }
    try {
      const outcome = this.branches.syncFromIntegration(featureId, "merge");
      return { action: "synced", plan, outcome };
    } catch (error) {
      if (error instanceof ActiveTurnSyncError) {
        return { action: "deferred", reason: "active_turn", plan };
      }
      if (error instanceof DirtyWorktreeSyncError) {
        return { action: "deferred", reason: "dirty_worktree", plan };
      }
      if (plan.reason === "textual_conflict" && error instanceof GitCommandError) {
        return { action: "held", reason: "textual_conflict", plan };
      }
      throw error;
    }
  }

  private decide(featureId: string): FreshnessPlan {
    const record = this.branches.read(featureId);
    const integration = revParse(this.branches.repo, this.branches.integrationRef);
    if (record.headSha === integration) {
      return { action: "skip", reason: "disjoint_clean" };
    }
    const scan = this.mergeTree.scan({
      repo: this.branches.repo,
      ours: record.headSha,
      theirs: integration,
    });
    const landed = diffNameOnly(this.branches.repo, `${record.headSha}...${integration}`);
    const reason = classify(landed, this.branches.readSet(featureId), scan.clean);
    if (!reason) return { action: "skip", reason: "disjoint_clean" };
    return { action: "schedule", reason, at: "next_leaf_boundary" };
  }
}

function classify(landed: readonly string[], readSet: readonly string[], clean: boolean): FreshnessReason | null {
  if (!clean) return "textual_conflict";
  if (landed.some((file) => (LOCKFILE_PATHS as readonly string[]).includes(normalize(file)))) return "lockfile";
  const overlap = landed.filter((file) => readSet.some((entry) => pathMatch(normalize(file), normalize(entry))));
  if (overlap.some((file) => SHARED_CONTRACT_PREFIXES.some((prefix) => normalize(file).startsWith(prefix)))) {
    return "shared_contract";
  }
  if (overlap.length > 0) return "read_set";
  return null;
}

function normalize(file: string): string {
  return file.replaceAll("\\", "/");
}

function pathMatch(file: string, entry: string): boolean {
  if (file === entry) return true;
  const prefix = entry.endsWith("/") ? entry : `${entry}/`;
  return file.startsWith(prefix);
}
