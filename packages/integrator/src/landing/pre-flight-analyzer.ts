import type { LandingDependencies } from "./contracts.js";
import { parsePorcelainZ } from "./porcelain.js";
import { findUntrackedCaseCollisions, intersectsPathSets, normalizeRepoPath } from "./paths.js";
import { parseMergeTreeOutput, runGit, runGitOrThrow } from "./git-runner.js";
import type { CommitStyleChoice, LandingPathId, PreFlightInput, PreFlightReport } from "./types.js";

const DEFAULT_INTEGRATION = "harness/integration";

export class SafeLandingPreFlightAnalyzer {
  constructor(private readonly deps: LandingDependencies = {}) {}

  async analyze(input: PreFlightInput): Promise<PreFlightReport> {
    const harnessRef = input.harnessIntegrationRef ?? DEFAULT_INTEGRATION;
    const porcelain = parsePorcelainZ(
      runGitOrThrow({
        cwd: input.repoPath,
        args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      }).stdout,
    );
    const dirtyPaths = porcelain
      .filter((entry) => entry.kind !== "untracked" && entry.kind !== "ignored")
      .map((entry) => normalizeRepoPath(entry.path));
    const untrackedPaths = porcelain
      .filter((entry) => entry.kind === "untracked")
      .map((entry) => normalizeRepoPath(entry.path));
    const workingTreeClean = porcelain.length === 0;

    const headSha = runGitOrThrow({
      cwd: input.repoPath,
      args: ["rev-parse", "HEAD"],
    }).stdout.trim();

    const detachedHead =
      this.deps.minGit?.inspectCheckout
        ? (await this.deps.minGit.inspectCheckout(input.repoPath)).detachedHead
        : runGit({
            cwd: input.repoPath,
            args: ["symbolic-ref", "-q", "HEAD"],
          }).exitCode !== 0;

    const harnessIntegrationSha = runGitOrThrow({
      cwd: input.repoPath,
      args: ["rev-parse", harnessRef],
      developerCheckout: false,
    }).stdout.trim();

    const mergeBaseSha = runGitOrThrow({
      cwd: input.repoPath,
      args: ["merge-base", headSha, harnessIntegrationSha],
    }).stdout.trim();

    const integrationChangedPaths = runGitOrThrow({
      cwd: input.repoPath,
      args: ["diff", "--name-only", `${mergeBaseSha}..${harnessIntegrationSha}`],
    })
      .stdout.split(/\r?\n/)
      .map((line) => normalizeRepoPath(line.trim()))
      .filter((line) => line.length > 0);

    const overlappingPaths = intersectsPathSets([...dirtyPaths, ...untrackedPaths], integrationChangedPaths);

    const mergeTree = runGit({
      cwd: input.repoPath,
      args: ["merge-tree", "--write-tree", "--name-only", headSha, harnessIntegrationSha],
    });
    const parsedMerge = parseMergeTreeOutput(mergeTree.stdout);
    const mergeTreeConflicts = parsedMerge.conflictingPaths;

    const integrationAdded = runGitOrThrow({
      cwd: input.repoPath,
      args: ["diff", "--diff-filter=A", "--name-only", `${mergeBaseSha}..${harnessIntegrationSha}`],
    })
      .stdout.split(/\r?\n/)
      .map((line) => normalizeRepoPath(line.trim()))
      .filter((line) => line.length > 0);

    const untrackedCaseCollisions = findUntrackedCaseCollisions(untrackedPaths, integrationAdded);

    const headOnlyCount = Number(
      runGitOrThrow({
        cwd: input.repoPath,
        args: ["rev-list", "--count", `${mergeBaseSha}..${headSha}`],
      }).stdout.trim() || "0",
    );
    const harnessOnlyCount = Number(
      runGitOrThrow({
        cwd: input.repoPath,
        args: ["rev-list", "--count", `${mergeBaseSha}..${harnessIntegrationSha}`],
      }).stdout.trim() || "0",
    );
    const ffFromHeadToHarness =
      runGit({
        cwd: input.repoPath,
        args: ["merge-base", "--is-ancestor", headSha, harnessIntegrationSha],
      }).exitCode === 0;
    const divergedBase = headOnlyCount > 0 && harnessOnlyCount > 0 && !ffFromHeadToHarness;

    const modifyDeleteConflicts = integrationChangedPaths.filter((filePath) => {
      const deletedOnHead = runGit({
        cwd: input.repoPath,
        args: ["diff", "--name-only", "--diff-filter=D", headSha, mergeBaseSha, "--", filePath],
      }).stdout.trim();
      const modifiedOnHarness =
        runGit({
          cwd: input.repoPath,
          args: ["diff", "--name-only", headSha, harnessIntegrationSha, "--", filePath],
        }).stdout.trim().length > 0;
      return deletedOnHead.length > 0 && modifiedOnHarness;
    });

    const path = this.classifyPath({
      workingTreeClean,
      overlappingPaths,
      mergeTreeConflicts,
      divergedBase,
      modifyDeleteConflicts,
      untrackedCaseCollisions,
      detachedHead,
    });

    const commitCount = Number(
      runGitOrThrow({
        cwd: input.repoPath,
        args: ["rev-list", "--count", `${mergeBaseSha}..${harnessIntegrationSha}`],
      }).stdout.trim() || "0",
    );
    const diffStat = runGitOrThrow({
      cwd: input.repoPath,
      args: ["diff", "--shortstat", `${mergeBaseSha}..${harnessIntegrationSha}`],
    }).stdout.trim();
    const additions = Number(/\d+ insertion/.exec(diffStat)?.[0]?.split(" ")[0] ?? "0");
    const deletions = Number(/\d+ deletion/.exec(diffStat)?.[0]?.split(" ")[0] ?? "0");
    const summary =
      (await this.deps.landingSummary?.buildPreviewSummary({
        commitCount,
        changedFileCount: integrationChangedPaths.length,
        additions,
        deletions,
      })) ?? `EF landing preview: ${commitCount} commits · ${integrationChangedPaths.length} files`;

    const commitStyleChoices: CommitStyleChoice[] = detachedHead
      ? ["create_new_branch"]
      : ["keep_feature_commits", "squash_single_commit", "create_new_branch"];

    return {
      path,
      targetBranch: input.targetBranch,
      headSha,
      harnessIntegrationSha,
      mergeBaseSha,
      workingTreeClean,
      dirtyPaths,
      untrackedPaths,
      integrationChangedPaths,
      overlappingPaths,
      mergeTreeConflicts,
      detachedHead,
      divergedBase,
      modifyDeleteConflicts,
      untrackedCaseCollisions,
      preview: {
        commitCount,
        changedFileCount: integrationChangedPaths.length,
        additions,
        deletions,
        verificationReceiptSummary: summary,
        commitStyleChoices,
      },
    };
  }

  private classifyPath(input: {
    readonly workingTreeClean: boolean;
    readonly overlappingPaths: readonly string[];
    readonly mergeTreeConflicts: readonly string[];
    readonly divergedBase: boolean;
    readonly modifyDeleteConflicts: readonly string[];
    readonly untrackedCaseCollisions: readonly string[];
    readonly detachedHead: boolean;
  }): LandingPathId {
    if (input.overlappingPaths.length > 0 || input.untrackedCaseCollisions.length > 0) return "C";
    if (input.mergeTreeConflicts.length > 0) return "C";
    if (input.divergedBase || input.modifyDeleteConflicts.length > 0) return "D";
    if (input.workingTreeClean) return "A";
    return "B";
  }
}