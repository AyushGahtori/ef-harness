import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LANDING_TEST_TIMEOUT_MS = 60_000;
import {
  DirtyOverlapFourOptionDialog,
  LandingRollbackSafetyPoint,
  SafeLandingPreFlightAnalyzer,
  ZeroStashLandingExecutor,
  assertDeveloperCheckoutGitAllowed,
  fileSha256,
  readGitInvocationJournal,
} from "../../src/landing/index.js";
import {
  advanceHarness,
  ensureHarnessIntegration,
  initRepo,
  makeSandbox,
  rawGit,
  removeSandbox,
  stashListEmpty,
  writeAndCommit,
} from "./helpers.js";

describe("Safe Landing Engine", () => {
  it("Path A: clean fast-forward merge lands harness/integration onto main", { timeout: LANDING_TEST_TIMEOUT_MS }, async () => {
    const sandbox = makeSandbox();
    const repo = initRepo(sandbox);
    try {
      ensureHarnessIntegration(repo, sandbox);
      const harnessSha = advanceHarness(repo, sandbox, "src/api/orders.ts", "export const x = 1;\n");
      const analyzer = new SafeLandingPreFlightAnalyzer();
      const report = await analyzer.analyze({ repoPath: repo, targetBranch: "main" });
      expect(report.path).toBe("A");
      expect(report.workingTreeClean).toBe(true);
      const executor = new ZeroStashLandingExecutor();
      const result = await executor.execute({ repoPath: repo, targetBranch: "main", featureSlug: "kitchen-orders" });
      expect(result.ok).toBe(true);
      expect(result.landedSha).toBe(harnessSha);
      expect(stashListEmpty(repo, sandbox)).toBe(true);
      expect(executor.verifyZeroForbiddenGitInvocations()).toBe(true);
    } finally {
      removeSandbox(sandbox.root);
    }
  });

  it("Path B: untouched dirty file keeps byte-identical SHA-256 after landing", { timeout: LANDING_TEST_TIMEOUT_MS }, async () => {
    const sandbox = makeSandbox();
    const repo = initRepo(sandbox);
    try {
      ensureHarnessIntegration(repo, sandbox);
      advanceHarness(repo, sandbox, "src/api/orders.ts", "export const x = 1;\n");
      const notes = path.join(repo, "docs", "notes.md");
      fs.mkdirSync(path.dirname(notes), { recursive: true });
      fs.writeFileSync(notes, "private notes\n");
      const before = fileSha256(repo, "docs/notes.md");
      const report = await new SafeLandingPreFlightAnalyzer().analyze({ repoPath: repo, targetBranch: "main" });
      expect(report.path).toBe("B");
      const executor = new ZeroStashLandingExecutor();
      const result = await executor.execute({ repoPath: repo, targetBranch: "main" });
      expect(result.ok).toBe(true);
      const after = fileSha256(repo, "docs/notes.md");
      expect(after).toBe(before);
      expect(stashListEmpty(repo, sandbox)).toBe(true);
    } finally {
      removeSandbox(sandbox.root);
    }
  });

  it("Path C: modified overlap halts and exposes all four options", { timeout: LANDING_TEST_TIMEOUT_MS }, async () => {
    const sandbox = makeSandbox();
    const repo = initRepo(sandbox);
    try {
      writeAndCommit(repo, sandbox, "src/api/orders.ts", "export const base = 1;\n", "seed");
      ensureHarnessIntegration(repo, sandbox);
      rawGit(repo, ["checkout", "harness/integration"], sandbox.env);
      writeAndCommit(repo, sandbox, "src/api/orders.ts", "export const harness = 2;\n", "harness");
      rawGit(repo, ["checkout", "main"], sandbox.env);
      fs.writeFileSync(path.join(repo, "src/api/orders.ts"), "export const local = 3;\n");
      const report = await new SafeLandingPreFlightAnalyzer().analyze({ repoPath: repo, targetBranch: "main" });
      expect(report.path).toBe("C");
      const dialog = new DirtyOverlapFourOptionDialog();
      const presentation = dialog.buildPresentation(report.overlappingPaths);
      expect(presentation.options.map((o) => o.id)).toEqual([
        "commit_first_then_land",
        "land_separate_branch",
        "side_by_side_diff",
        "cancel",
      ]);
      const halted = await new ZeroStashLandingExecutor().execute({ repoPath: repo, targetBranch: "main" });
      expect(halted.haltedForOverlap).toBe(true);
      const separate = await new ZeroStashLandingExecutor().execute({
        repoPath: repo,
        targetBranch: "main",
        overlapChoice: "land_separate_branch",
        featureSlug: "kitchen-orders",
      });
      expect(separate.ok).toBe(true);
      expect(separate.newBranch).toBe("ef/kitchen-orders");
      const head = rawGit(repo, ["rev-parse", "HEAD"], sandbox.env).stdout.trim();
      const pre = report.headSha;
      expect(head).toBe(pre);
    } finally {
      removeSandbox(sandbox.root);
    }
  });

  it("Path C: case-insensitive untracked collision routes to overlap dialog", { timeout: LANDING_TEST_TIMEOUT_MS }, async () => {
    const sandbox = makeSandbox();
    const repo = initRepo(sandbox);
    try {
      ensureHarnessIntegration(repo, sandbox);
      rawGit(repo, ["checkout", "harness/integration"], sandbox.env);
      writeAndCommit(repo, sandbox, "src/components/PrintView.tsx", "export {}\n", "harness");
      rawGit(repo, ["checkout", "main"], sandbox.env);
      const untracked = path.join(repo, "src/components/printview.tsx");
      fs.mkdirSync(path.dirname(untracked), { recursive: true });
      fs.writeFileSync(untracked, "local prototype\n");
      const report = await new SafeLandingPreFlightAnalyzer().analyze({ repoPath: repo, targetBranch: "main" });
      expect(report.path).toBe("C");
      expect(report.untrackedCaseCollisions.length).toBeGreaterThan(0);
    } finally {
      removeSandbox(sandbox.root);
    }
  });

  it("LandingRollbackSafetyPoint supports one-click undo landing", { timeout: LANDING_TEST_TIMEOUT_MS }, async () => {
    const sandbox = makeSandbox();
    const repo = initRepo(sandbox);
    try {
      ensureHarnessIntegration(repo, sandbox);
      advanceHarness(repo, sandbox, "src/feature.ts", "ok\n");
      const preSha = rawGit(repo, ["rev-parse", "HEAD"], sandbox.env).stdout.trim();
      const safety = new LandingRollbackSafetyPoint();
      const point = await safety.writePreLandSafetyPoint({
        repoPath: repo,
        targetBranch: "main",
        headSha: preSha,
        dirtyPaths: [],
        timestamp: 1_727_000_000,
      });
      expect(point.safetyRef).toBe("refs/ef-safety/pre-land-1727000000");
      const landed = await new ZeroStashLandingExecutor().execute({ repoPath: repo, targetBranch: "main" });
      expect(landed.ok).toBe(true);
      const afterLand = rawGit(repo, ["rev-parse", "HEAD"], sandbox.env).stdout.trim();
      expect(afterLand).not.toBe(preSha);
      const undone = await safety.undoLanding({
        repoPath: repo,
        targetBranch: "main",
        safetyRef: point.safetyRef,
      });
      expect(undone.restoredSha).toBe(preSha);
    } finally {
      removeSandbox(sandbox.root);
    }
  });

  it("keeps unmerged harness/f branches and drops only ancestors of the landed sha", { timeout: LANDING_TEST_TIMEOUT_MS }, async () => {
    const sandbox = makeSandbox();
    const repo = initRepo(sandbox);
    try {
      ensureHarnessIntegration(repo, sandbox);
      const harnessSha = advanceHarness(repo, sandbox, "src/api/orders.ts", "export const x = 1;\n");
      rawGit(repo, ["branch", "harness/f/included", harnessSha], sandbox.env);
      rawGit(repo, ["checkout", "-b", "harness/f/future", harnessSha], sandbox.env);
      writeAndCommit(repo, sandbox, "src/future.ts", "export const future = true;\n", "future");
      rawGit(repo, ["checkout", "main"], sandbox.env);
      const executor = new ZeroStashLandingExecutor();
      const result = await executor.execute({ repoPath: repo, targetBranch: "main" });
      expect(result.ok).toBe(true);
      expect(result.landedSha).toBe(harnessSha);
      const included = rawGit(repo, ["rev-parse", "--verify", "refs/heads/harness/f/included"], sandbox.env);
      const future = rawGit(repo, ["rev-parse", "--verify", "refs/heads/harness/f/future"], sandbox.env);
      expect(included.code).not.toBe(0);
      expect(future.code).toBe(0);
      expect(future.stdout.trim().length).toBeGreaterThan(0);
    } finally {
      removeSandbox(sandbox.root);
    }
  });

  it("aborts without moving HEAD when the developer checkout is not the target branch", { timeout: LANDING_TEST_TIMEOUT_MS }, async () => {
    const sandbox = makeSandbox();
    const repo = initRepo(sandbox);
    try {
      ensureHarnessIntegration(repo, sandbox);
      advanceHarness(repo, sandbox, "src/api/orders.ts", "export const x = 1;\n");
      rawGit(repo, ["checkout", "-b", "side"], sandbox.env);
      const before = rawGit(repo, ["rev-parse", "HEAD"], sandbox.env).stdout.trim();
      const result = await new ZeroStashLandingExecutor().execute({ repoPath: repo, targetBranch: "main" });
      expect(result.ok).toBe(false);
      expect(rawGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"], sandbox.env).stdout.trim()).toBe("side");
      expect(rawGit(repo, ["rev-parse", "HEAD"], sandbox.env).stdout.trim()).toBe(before);
    } finally {
      removeSandbox(sandbox.root);
    }
  });

  it("forbids stash/reset-hard/checkout -f in developer checkout git journal", () => {
    expect(() => assertDeveloperCheckoutGitAllowed(["stash", "push"])).toThrow();
    expect(() => assertDeveloperCheckoutGitAllowed(["reset", "--hard", "HEAD"])).toThrow();
    expect(() => assertDeveloperCheckoutGitAllowed(["checkout", "-f", "main"])).toThrow();
    const journal = readGitInvocationJournal();
    expect(journal.every((entry) => !entry.argv.join(" ").includes("stash"))).toBe(true);
  });

  it("Path D: diverged base is classified before automatic landing", { timeout: LANDING_TEST_TIMEOUT_MS }, async () => {
    const sandbox = makeSandbox();
    const repo = initRepo(sandbox);
    try {
      ensureHarnessIntegration(repo, sandbox);
      rawGit(repo, ["checkout", "harness/integration"], sandbox.env);
      writeAndCommit(repo, sandbox, "src/api/orders.ts", "harness\n", "harness");
      rawGit(repo, ["checkout", "main"], sandbox.env);
      writeAndCommit(repo, sandbox, "docs/dev.md", "diverged\n", "dev");
      const report = await new SafeLandingPreFlightAnalyzer().analyze({ repoPath: repo, targetBranch: "main" });
      expect(report.path).toBe("D");
      const withoutDeps = await new ZeroStashLandingExecutor().execute({ repoPath: repo, targetBranch: "main" });
      expect(withoutDeps.ok).toBe(false);
      const withDeps = await new ZeroStashLandingExecutor({
        baseSync: {
          async runIsolatedBaseSync() {
            return { ok: true, mergedSha: report.harnessIntegrationSha, diverged: true, modifyDeletePaths: [] };
          },
        },
        regressionGate: {
          async runInEphemeralWorktree() {
            return { green: true };
          },
        },
      }).execute({ repoPath: repo, targetBranch: "main" });
      expect(withDeps.ok).toBe(true);
    } finally {
      removeSandbox(sandbox.root);
    }
  });
});