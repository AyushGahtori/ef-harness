import type { LandingDependencies } from "./contracts.js";
import { DirtyOverlapFourOptionDialog } from "./four-option-dialog.js";
import { readGitInvocationJournal, runGit, runGitOrThrow } from "./git-runner.js";
import { persistLandingReceipt } from "./receipt-store.js";
import { LandingRollbackSafetyPoint } from "./rollback-safety-point.js";
import type { CommitStyleChoice, FourOptionId, PreFlightReport } from "./types.js";
import { SafeLandingPreFlightAnalyzer } from "./pre-flight-analyzer.js";

const DEFAULT_INTEGRATION = "harness/integration";

export interface LandingExecutionInput {
  readonly repoPath: string;
  readonly targetBranch: string;
  readonly harnessIntegrationRef?: string;
  readonly featureSlug?: string;
  readonly commitStyle?: CommitStyleChoice;
  readonly overlapChoice?: FourOptionId;
}

export interface LandingExecutionResult {
  readonly ok: boolean;
  readonly landedSha?: string;
  readonly safetyRef?: string;
  readonly undoMessage?: string;
  readonly haltedForOverlap?: boolean;
  readonly newBranch?: string;
  readonly receiptId?: string;
  readonly reason?: string;
}

export class ZeroStashLandingExecutor {
  private readonly analyzer: SafeLandingPreFlightAnalyzer;
  private readonly dialog = new DirtyOverlapFourOptionDialog();
  private readonly safety: LandingRollbackSafetyPoint;

  constructor(private readonly deps: LandingDependencies = {}) {
    this.analyzer = new SafeLandingPreFlightAnalyzer(deps);
    this.safety = new LandingRollbackSafetyPoint(deps.dirtySnapshot);
  }

  async execute(input: LandingExecutionInput): Promise<LandingExecutionResult> {
    const harnessRef = input.harnessIntegrationRef ?? DEFAULT_INTEGRATION;
    const report = await this.analyzer.analyze({
      repoPath: input.repoPath,
      targetBranch: input.targetBranch,
      harnessIntegrationRef: harnessRef,
      ...(input.featureSlug !== undefined ? { featureSlug: input.featureSlug } : {}),
    });

    if (report.detachedHead) {
      return this.landOntoNewBranch(input, report, `ef/${input.featureSlug ?? "landing"}`);
    }

    if (report.path === "C") {
      if (!input.overlapChoice) {
        return { ok: false, haltedForOverlap: true, reason: "dirty_overlap_requires_dialog" };
      }
      const resolution = this.dialog.resolveChoice(input.overlapChoice, {
        repoPath: input.repoPath,
        featureSlug: input.featureSlug ?? "landing",
        harnessIntegrationRef: harnessRef,
      });
      if (resolution.action === "cancel" || resolution.action === "halt") {
        return { ok: false, haltedForOverlap: true, reason: input.overlapChoice };
      }
      if (resolution.action === "create_branch" && resolution.branchName) {
        return this.landOntoNewBranch(input, report, resolution.branchName);
      }
    }

    if (report.path === "D") {
      const sync = await this.deps.baseSync?.runIsolatedBaseSync({
        repoPath: input.repoPath,
        targetBranch: input.targetBranch,
        harnessIntegrationRef: harnessRef,
      });
      if (!sync?.ok) {
        return { ok: false, reason: sync?.error ?? "path_d_base_sync_failed" };
      }
      if (this.deps.regressionGate && sync.mergedSha) {
        const gate = await this.deps.regressionGate.runInEphemeralWorktree(input.repoPath, sync.mergedSha);
        if (!gate.green) return { ok: false, reason: "path_d_regression_not_green" };
      }
    }

    if (input.commitStyle === "create_new_branch") {
      return this.landOntoNewBranch(input, report, `ef/${input.featureSlug ?? "landing"}`);
    }

    const safety = await this.safety.writePreLandSafetyPoint({
      repoPath: input.repoPath,
      targetBranch: input.targetBranch,
      headSha: report.headSha,
      dirtyPaths: [...report.dirtyPaths, ...report.untrackedPaths],
    });

    const landedSha = await this.applyLandingToBranch(input, report, harnessRef);
    if (!landedSha) return { ok: false, reason: "landing_apply_failed" };

    const receipt = persistLandingReceipt({
      targetBranch: input.targetBranch,
      preLandSha: report.headSha,
      landedSha,
      safetyRef: safety.safetyRef,
      strategy: report.path,
      overlappingFilesHandled: report.overlappingPaths,
    });

    await this.postLandingCleanup(input.repoPath, harnessRef, landedSha);

    return {
      ok: true,
      landedSha,
      safetyRef: safety.safetyRef,
      undoMessage: safety.undoMessage,
      receiptId: receipt.landingId,
    };
  }

  verifyZeroForbiddenGitInvocations(): boolean {
    return readGitInvocationJournal().every((record) => {
      const joined = record.argv.join(" ").toLowerCase();
      return !joined.includes("stash") && !joined.includes("reset --hard") && !joined.includes("checkout -f");
    });
  }

  private async applyLandingToBranch(
    input: LandingExecutionInput,
    report: PreFlightReport,
    harnessRef: string,
  ): Promise<string | null> {
    const style = input.commitStyle ?? "keep_feature_commits";
    if (style === "squash_single_commit") {
      runGitOrThrow({
        cwd: input.repoPath,
        args: ["checkout", input.targetBranch],
      });
      runGitOrThrow({
        cwd: input.repoPath,
        args: ["merge", "--squash", harnessRef],
      });
      runGitOrThrow({
        cwd: input.repoPath,
        args: ["commit", "-m", "EF landing squash"],
      });
    } else {
      runGitOrThrow({
        cwd: input.repoPath,
        args: ["checkout", input.targetBranch],
      });
      const ff = runGit({
        cwd: input.repoPath,
        args: ["merge", "--ff-only", harnessRef],
      });
      if (ff.exitCode !== 0) {
        runGitOrThrow({
          cwd: input.repoPath,
          args: ["merge", "--no-ff", "--no-edit", harnessRef],
        });
      }
    }
    return runGitOrThrow({
      cwd: input.repoPath,
      args: ["rev-parse", "HEAD"],
    }).stdout.trim();
  }

  private landOntoNewBranch(
    input: LandingExecutionInput,
    report: PreFlightReport,
    branchName: string,
  ): LandingExecutionResult {
    runGitOrThrow({
      cwd: input.repoPath,
      args: ["branch", branchName, report.harnessIntegrationSha],
      developerCheckout: false,
    });
    persistLandingReceipt({
      targetBranch: branchName,
      preLandSha: report.headSha,
      landedSha: report.harnessIntegrationSha,
      safetyRef: `refs/ef-safety/pre-land-branch-${Date.now()}`,
      strategy: "separate_branch",
      overlappingFilesHandled: report.overlappingPaths,
    });
    return { ok: true, landedSha: report.harnessIntegrationSha, newBranch: branchName };
  }

  private async postLandingCleanup(repoPath: string, harnessRef: string, landedSha: string): Promise<void> {
    const harnessHead = harnessRef.startsWith("refs/heads/")
      ? harnessRef
      : `refs/heads/${harnessRef}`;
    runGitOrThrow({
      cwd: repoPath,
      args: ["update-ref", harnessHead, landedSha],
      developerCheckout: false,
    });
    runGit({
      cwd: repoPath,
      args: ["for-each-ref", "--format=%(refname)", "refs/heads/harness/f/"],
      developerCheckout: false,
    })
      .stdout.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .forEach((ref) => {
        runGit({
          cwd: repoPath,
          args: ["update-ref", "-d", ref],
          developerCheckout: false,
        });
      });
  }
}