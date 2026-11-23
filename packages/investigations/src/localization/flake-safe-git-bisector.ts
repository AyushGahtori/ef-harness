import { execFileSync } from "node:child_process";
import { LocalizationArtifactStore } from "./artifacts.js";
import {
  BisectDepthExceededError,
  FlakyReproBlocksBisectError,
  LocalizationToolkitError,
} from "./errors.js";
import { fingerprintsMatch, normalizeFailureFingerprint } from "./fingerprint.js";
import type { MinGitRepoInspectorPort } from "./ports.js";
import {
  GIT_BISECT_SKIP_EXIT,
  MAX_BISECT_COMMITS,
  MAX_BISECT_STEPS,
  REVERT_VERIFY_RUN_COUNT,
  STABILITY_RUN_COUNT,
  type BisectRunResult,
  type ReproOutcome,
  type ReproRunner,
} from "./types.js";

export type FlakeSafeGitBisectorOptions = {
  readonly repoPath: string;
  readonly badRef: string;
  readonly goodRef: string;
  readonly runRepro: ReproRunner;
  readonly git?: MinGitRepoInspectorPort;
  readonly artifactStore?: LocalizationArtifactStore;
};

function defaultGit(repoPath: string): MinGitRepoInspectorPort {
  const run = (args: string[]): string =>
    execFileSync("git", args, { cwd: repoPath, encoding: "utf8" }).trim();
  return {
    isShallowRepository: () => run(["rev-parse", "--is-shallow-repository"]) === "true",
    revListCount: (range) => {
      const out = run(["rev-list", "--count", range]);
      return Number.parseInt(out, 10);
    },
    resolveRef: (ref) => run(["rev-parse", ref]),
  };
}

function listCommitsNewestFirst(repoPath: string, goodRef: string, badRef: string): string[] {
  const out = execFileSync("git", ["rev-list", "--reverse", `${goodRef}..${badRef}`], {
    cwd: repoPath,
    encoding: "utf8",
  });
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function runMany(
  count: number,
  runner: ReproRunner,
): Promise<readonly ReproOutcome[]> {
  const results: ReproOutcome[] = [];
  for (let i = 0; i < count; i += 1) {
    results.push(await runner());
  }
  return results;
}

function assertStability(
  label: "bad" | "good",
  outcomes: readonly ReproOutcome[],
  targetFingerprint: string,
): void {
  if (label === "bad") {
    const failCount = outcomes.filter((o) => o.exitCode !== 0).length;
    const sameFingerprint = outcomes
      .filter((o) => o.exitCode !== 0)
      .every((o) => fingerprintsMatch(targetFingerprint, o.fingerprint));
    if (failCount !== STABILITY_RUN_COUNT || !sameFingerprint) {
      throw new FlakyReproBlocksBisectError(
        `${label} endpoint unstable (${failCount}/${STABILITY_RUN_COUNT} failing with identical fingerprint)`,
      );
    }
    return;
  }
  const passCount = outcomes.filter((o) => o.exitCode === 0).length;
  if (passCount !== STABILITY_RUN_COUNT) {
    throw new FlakyReproBlocksBisectError(
      `${label} endpoint unstable (${passCount}/${STABILITY_RUN_COUNT} passing)`,
    );
  }
}

function bisectStepExitCode(
  outcome: ReproOutcome,
  targetFingerprint: string,
): number {
  if (outcome.exitCode === 0) {
    return 0;
  }
  if (fingerprintsMatch(targetFingerprint, outcome.fingerprint)) {
    return 1;
  }
  return GIT_BISECT_SKIP_EXIT;
}

function checkoutRef(repoPath: string, ref: string): void {
  execFileSync("git", ["checkout", "--force", ref], { cwd: repoPath, stdio: "pipe" });
}

export class FlakeSafeGitBisector {
  async run(options: FlakeSafeGitBisectorOptions): Promise<BisectRunResult> {
    const git = options.git ?? defaultGit(options.repoPath);
    const store = options.artifactStore ?? new LocalizationArtifactStore();
    const shallow = await git.isShallowRepository();
    const commitCount = await git.revListCount(`${options.goodRef}..${options.badRef}`);
    if (commitCount > MAX_BISECT_COMMITS) {
      throw new LocalizationToolkitError(
        `bisect range has ${commitCount} commits; maximum is ${MAX_BISECT_COMMITS}`,
      );
    }

    await checkoutRef(options.repoPath, options.badRef);
    const badRuns = await runMany(STABILITY_RUN_COUNT, options.runRepro);
    const failing = badRuns.find((o) => o.exitCode !== 0);
    if (!failing) {
      throw new FlakyReproBlocksBisectError("bad ref must fail reproduction");
    }
    const targetRawFingerprint = failing.fingerprint;
    const targetFingerprint = normalizeFailureFingerprint(targetRawFingerprint);
    assertStability("bad", badRuns, targetRawFingerprint);

    const goodRuns = await runMany(STABILITY_RUN_COUNT, async () => {
      checkoutRef(options.repoPath, options.goodRef);
      return options.runRepro();
    });
    assertStability("good", goodRuns, targetRawFingerprint);

    await checkoutRef(options.repoPath, options.badRef);
    let skippedCommitCount = 0;
    let bisectSteps = 0;
    let suspectCommit = "";
    const commits = listCommitsNewestFirst(options.repoPath, options.goodRef, options.badRef);
    let low = 0;
    let high = commits.length - 1;

    while (low <= high && bisectSteps < MAX_BISECT_STEPS) {
      const mid = Math.floor((low + high) / 2);
      const commit = commits[mid];
      if (!commit) {
        break;
      }
      checkoutRef(options.repoPath, commit);
      const outcome = await options.runRepro();
      const exitCode = bisectStepExitCode(outcome, targetRawFingerprint);
      bisectSteps += 1;
      if (exitCode === GIT_BISECT_SKIP_EXIT) {
        skippedCommitCount += 1;
        low = mid + 1;
        continue;
      }
      if (exitCode === 1) {
        suspectCommit = commit;
        high = mid - 1;
        continue;
      }
      low = mid + 1;
    }

    if (!suspectCommit && commits.length > 0) {
      suspectCommit = commits[Math.min(low, commits.length - 1)] ?? "";
    }
    if (!suspectCommit) {
      suspectCommit = await git.resolveRef(options.badRef);
    }
    if (bisectSteps >= MAX_BISECT_STEPS && low <= high) {
      throw new BisectDepthExceededError(bisectSteps);
    }

    const parent = `${suspectCommit}^`;
    const revertVerified = await verifyRevert(
      options.repoPath,
      parent,
      suspectCommit,
      options.runRepro,
      targetRawFingerprint,
    );

    const artifactRef = store.put({
      bisectSuspectCommit: suspectCommit,
    });

    await checkoutRef(options.repoPath, options.badRef);

    return {
      suspectCommit,
      stability: {
        badRuns,
        goodRuns,
        targetFingerprint,
      },
      revertVerified,
      skippedCommitCount,
      shallowLimited: shallow,
      artifactRef,
    };
  }
}

async function verifyRevert(
  repoPath: string,
  parentRef: string,
  badRef: string,
  runRepro: ReproRunner,
  targetFingerprint: string,
): Promise<boolean> {
  try {
    checkoutRef(repoPath, parentRef);
  } catch {
    return false;
  }
  const parentRuns = await runMany(REVERT_VERIFY_RUN_COUNT, runRepro);
  const parentStable = parentRuns.every((o) => o.exitCode === 0);
  checkoutRef(repoPath, badRef);
  const badRuns = await runMany(REVERT_VERIFY_RUN_COUNT, runRepro);
  const badStable = badRuns.every(
    (o) => o.exitCode !== 0 && fingerprintsMatch(targetFingerprint, o.fingerprint),
  );
  return parentStable && badStable;
}