import { execGit } from "@ef-harness/git-engine";
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

async function runGit(repoPath: string, args: readonly string[]): Promise<string> {
  const result = await execGit({
    args,
    cwd: repoPath,
    developerCheckout: false,
  });
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`;
    throw new LocalizationToolkitError(detail);
  }
  return result.stdout.trim();
}

function defaultGit(repoPath: string): MinGitRepoInspectorPort {
  return {
    isShallowRepository: async () => (await runGit(repoPath, ["rev-parse", "--is-shallow-repository"])) === "true",
    revListCount: async (range) => {
      const out = await runGit(repoPath, ["rev-list", "--count", range]);
      return Number.parseInt(out, 10);
    },
    resolveRef: (ref) => runGit(repoPath, ["rev-parse", ref]),
  };
}

async function listCommitsOldestFirst(
  repoPath: string,
  goodRef: string,
  badRef: string,
): Promise<string[]> {
  const out = await runGit(repoPath, ["rev-list", "--reverse", `${goodRef}..${badRef}`]);
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

async function checkoutRef(repoPath: string, ref: string): Promise<void> {
  await runGit(repoPath, ["checkout", "--force", ref]);
}

async function restoreBadRef(repoPath: string, badRef: string): Promise<void> {
  try {
    await checkoutRef(repoPath, badRef);
  } catch {
    return;
  }
}

function pickUnskipped(low: number, high: number, skipped: ReadonlySet<number>): number | null {
  if (low > high) return null;
  const mid = Math.floor((low + high) / 2);
  if (!skipped.has(mid)) return mid;
  const span = high - low;
  for (let distance = 1; distance <= span; distance += 1) {
    const before = mid - distance;
    const after = mid + distance;
    if (before >= low && !skipped.has(before)) return before;
    if (after <= high && !skipped.has(after)) return after;
  }
  return null;
}

export class FlakeSafeGitBisector {
  async run(options: FlakeSafeGitBisectorOptions): Promise<BisectRunResult> {
    try {
      return await this.execute(options);
    } finally {
      await restoreBadRef(options.repoPath, options.badRef);
    }
  }

  private async execute(options: FlakeSafeGitBisectorOptions): Promise<BisectRunResult> {
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
      await checkoutRef(options.repoPath, options.goodRef);
      return options.runRepro();
    });
    assertStability("good", goodRuns, targetRawFingerprint);

    await checkoutRef(options.repoPath, options.badRef);
    let skippedCommitCount = 0;
    let bisectSteps = 0;
    let suspectCommit = "";
    const commits = await listCommitsOldestFirst(options.repoPath, options.goodRef, options.badRef);
    let low = 0;
    let high = commits.length - 1;
    const skipped = new Set<number>();

    while (low <= high && bisectSteps < MAX_BISECT_STEPS) {
      const probe = pickUnskipped(low, high, skipped);
      if (probe === null) break;
      const commit = commits[probe];
      if (!commit) break;
      await checkoutRef(options.repoPath, commit);
      const outcome = await options.runRepro();
      const exitCode = bisectStepExitCode(outcome, targetRawFingerprint);
      bisectSteps += 1;
      if (exitCode === GIT_BISECT_SKIP_EXIT) {
        skippedCommitCount += 1;
        skipped.add(probe);
        continue;
      }
      if (exitCode === 1) {
        suspectCommit = commit;
        high = probe - 1;
        continue;
      }
      low = probe + 1;
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
    await checkoutRef(repoPath, parentRef);
  } catch {
    return false;
  }
  const parentRuns = await runMany(REVERT_VERIFY_RUN_COUNT, runRepro);
  const parentStable = parentRuns.every((o) => o.exitCode === 0);
  await checkoutRef(repoPath, badRef);
  const badRuns = await runMany(REVERT_VERIFY_RUN_COUNT, runRepro);
  const badStable = badRuns.every(
    (o) => o.exitCode !== 0 && fingerprintsMatch(targetFingerprint, o.fingerprint),
  );
  return parentStable && badStable;
}
