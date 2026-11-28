import { describe, expect, it } from "vitest";
import {
  BaselineTestHealthRunner,
  BrokenBuildEntryGate,
  CharacterizationSafetyNetPlanner,
  InMemoryBaselineTestHealthStore,
  InMemoryGitWorktreeInspector,
  InMemoryQuarantinedTestsStore,
  InMemoryWorktreeSlotPool,
  ScriptedHarnessRunEngine,
  StubBrownfieldL0RepoScanner,
  ThreeRunFlakeDetector,
  buildBaselineCacheKey,
  parseTestReporterOutput,
  stableTestId,
} from "../../src/test-health/index.js";
import type { ParsedTestCase } from "../../src/test-health/types.js";
import {
  BROKEN_TS_OUTPUT,
  FLAKE_RERUN_JSON,
  HEALTHY_SCRIPTS,
  HEALTHY_VITEST_JSON,
  MIXED_VITEST_JSON,
  ZERO_TEST_SCRIPTS,
} from "./fixtures.js";

const BASE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ROOT = "/wt/repo";

type FixtureKind = "healthy" | "mixed" | "broken" | "zero";

function buildRunner(kind: FixtureKind, dirtyPaths: readonly string[] = []) {
  const healthStore = new InMemoryBaselineTestHealthStore();
  const quarantineStore = new InMemoryQuarantinedTestsStore();
  const statusLines = dirtyPaths.map((path) => ({ path, indexStatus: "?", workTreeStatus: "?" as const }));
  const git = new InMemoryGitWorktreeInspector(
    new Map([[ROOT, BASE_SHA]]),
    new Map([[ROOT, statusLines]]),
    new Map([["pnpm-lock.yaml", "lockhash-1"]]),
  );
  const worktrees = new InMemoryWorktreeSlotPool(new Map([["*", ROOT]]));
  const l0 = new StubBrownfieldL0RepoScanner(kind === "zero" ? ZERO_TEST_SCRIPTS : HEALTHY_SCRIPTS);
  const harness =
    kind === "broken"
      ? new ScriptedHarnessRunEngine([
          { argv: ["pnpm", "typecheck"], result: { exitCode: 1, stdout: BROKEN_TS_OUTPUT, stderr: "", durationMs: 12 } },
          { argv: ["pnpm", "build"], result: { exitCode: 0, stdout: "", stderr: "", durationMs: 5 } },
          { argv: ["pnpm", "lint"], result: { exitCode: 0, stdout: "", stderr: "", durationMs: 3 } },
          { argv: ["pnpm", "test", "--reporter=json"], result: { exitCode: 0, stdout: HEALTHY_VITEST_JSON, stderr: "", durationMs: 20 } },
        ])
      : kind === "mixed"
        ? new ScriptedHarnessRunEngine([
            { argv: ["pnpm", "typecheck"], result: { exitCode: 0, stdout: "", stderr: "", durationMs: 5 } },
            { argv: ["pnpm", "build"], result: { exitCode: 0, stdout: "", stderr: "", durationMs: 5 } },
            { argv: ["pnpm", "lint"], result: { exitCode: 0, stdout: "", stderr: "", durationMs: 3 } },
            { argv: ["pnpm", "test", "--reporter=json"], result: { exitCode: 1, stdout: MIXED_VITEST_JSON, stderr: "", durationMs: 40 } },
            {
              argv: ["pnpm", "test", "--reporter=json", "--", stableTestId("tests/mixed.test.ts", "mixed > broken invariant"), stableTestId("tests/mixed.test.ts", "mixed > stale assertion"), stableTestId("tests/mixed.test.ts", "mixed > flaky timer")],
              result: { exitCode: 1, stdout: MIXED_VITEST_JSON, stderr: "", durationMs: 30 },
            },
            {
              argv: ["pnpm", "test", "--reporter=json", "--", stableTestId("tests/mixed.test.ts", "mixed > broken invariant"), stableTestId("tests/mixed.test.ts", "mixed > stale assertion"), stableTestId("tests/mixed.test.ts", "mixed > flaky timer")],
              result: { exitCode: 1, stdout: MIXED_VITEST_JSON, stderr: "", durationMs: 28 },
            },
            {
              argv: ["pnpm", "test", "--reporter=json", "--", stableTestId("tests/mixed.test.ts", "mixed > broken invariant"), stableTestId("tests/mixed.test.ts", "mixed > stale assertion"), stableTestId("tests/mixed.test.ts", "mixed > flaky timer")],
              result: { exitCode: 0, stdout: FLAKE_RERUN_JSON, stderr: "", durationMs: 15 },
            },
            {
              argv: ["pnpm", "test", "--reporter=json", "--", stableTestId("tests/mixed.test.ts", "mixed > broken invariant"), stableTestId("tests/mixed.test.ts", "mixed > stale assertion"), stableTestId("tests/mixed.test.ts", "mixed > flaky timer")],
              result: { exitCode: 0, stdout: FLAKE_RERUN_JSON, stderr: "", durationMs: 12 },
            },
          ])
        : new ScriptedHarnessRunEngine([
            { argv: ["pnpm", "typecheck"], result: { exitCode: 0, stdout: "", stderr: "", durationMs: 5 } },
            { argv: ["pnpm", "build"], result: { exitCode: 0, stdout: "", stderr: "", durationMs: 5 } },
            { argv: ["pnpm", "lint"], result: { exitCode: 0, stdout: "", stderr: "", durationMs: 3 } },
            { argv: ["pnpm", "test", "--reporter=json"], result: { exitCode: 0, stdout: HEALTHY_VITEST_JSON, stderr: "", durationMs: 22 } },
          ]);

  return {
    runner: new BaselineTestHealthRunner({
      worktrees,
      harness,
      git,
      l0Scanner: l0,
      healthStore,
      quarantineStore,
      targetedModules: kind === "zero" ? ["src/billing/calculateTax.ts", "src/money/formatUsd.ts"] : [],
      moduleTestCoverage: kind === "zero" ? new Map() : undefined,
    }),
    healthStore,
    quarantineStore,
    git,
  };
}

describe("test-health matrix", () => {
  it("runs healthy baseline and records passing tests", async () => {
    const { runner, quarantineStore } = buildRunner("healthy");
    const outcome = await runner.run({ repoRoot: ROOT, baselineCommitSha: BASE_SHA });
    expect(outcome.buildGateBlocked).toBe(false);
    expect(outcome.receipt.passingCount).toBe(2);
    expect(outcome.receipt.knownFailingCount).toBe(0);
    expect((await quarantineStore.listAll()).length).toBe(0);
  });

  it("classifies 0/3 known_failing and 2/3 baseline_flaky on mixed repo", async () => {
    const { runner } = buildRunner("mixed");
    const outcome = await runner.run({ repoRoot: ROOT, baselineCommitSha: BASE_SHA, skipCache: true });
    expect(outcome.receipt.passingCount).toBe(1);
    expect(outcome.receipt.knownFailingCount).toBeGreaterThanOrEqual(2);
    expect(outcome.receipt.baselineFlakyCount).toBeGreaterThanOrEqual(1);
    expect(outcome.receipt.quarantineSummary).toMatch(/pre-existing failing/);
  });

  it("stops at BrokenBuildEntryGate on baseline typecheck failure", async () => {
    const { runner } = buildRunner("broken");
    const outcome = await runner.run({ repoRoot: ROOT, baselineCommitSha: BASE_SHA, skipCache: true });
    expect(outcome.buildGateBlocked).toBe(true);
    expect(outcome.receipt.buildBlocked).toBe(true);
    const gate = runner.getBuildGate().evaluate(outcome.receipt.commands);
    expect(gate.blocked).toBe(true);
    expect(gate.choices).toContain("fix_baseline_first");
    expect(gate.compilerErrors.some((e) => e.includes("TS2322"))).toBe(true);
  });

  it("suggests characterization safety-net on zero-test repo", async () => {
    const { runner } = buildRunner("zero");
    const outcome = await runner.run({ repoRoot: ROOT, baselineCommitSha: BASE_SHA, skipCache: true });
    expect(outcome.receipt.characterizationPhaseSuggested).toBe(true);
    const plan = runner.getSafetyNetPlanner().plan(["src/billing/calculateTax.ts", "src/money/formatUsd.ts"]);
    expect(plan.tests.length).toBeGreaterThanOrEqual(3);
    expect(plan.tests.length).toBeLessThanOrEqual(8);
    const cases: ParsedTestCase[] = plan.tests.map((t) => ({
      testId: t.testId,
      filePath: t.modulePath,
      status: "pass",
      errorMessage: null,
      durationMs: 1,
    }));
    const verified = runner.getSafetyNetPlanner().verifyBaselineGreen(plan, cases);
    expect(verified.baselineGreenVerified).toBe(true);
  });

  it("rejects inaccurate characterization tests that fail on untouched baseline", () => {
    const planner = new CharacterizationSafetyNetPlanner();
    const plan = planner.plan(["src/a.ts"]);
    const failing: ParsedTestCase[] = plan.tests.map((t) => ({ testId: t.testId, filePath: t.modulePath, status: "fail", errorMessage: "wrong guess", durationMs: 1 }));
    const verified = planner.verifyBaselineGreen(plan, failing);
    expect(verified.baselineGreenVerified).toBe(false);
  });

  it("regression gate catches new failures on baseline-passing tests", async () => {
    const { runner, quarantineStore } = buildRunner("mixed");
    const outcome = await runner.run({ repoRoot: ROOT, baselineCommitSha: BASE_SHA, skipCache: true });
    const quarantine = await quarantineStore.listAll();
    const passingIds = outcome.receipt.tests.filter((t) => t.classification === "passing").map((t) => t.testId);
    const candidateFails = parseTestReporterOutput(
      JSON.stringify({
        testResults: [
          {
            name: "tests/mixed.test.ts",
            assertionResults: [
              { fullName: "mixed > always passes", status: "failed", failureMessages: ["regression"] },
            ],
          },
        ],
      }),
    ).cases as ParsedTestCase[];
    const gate = await runner.getQuarantineStore().evaluateRegressionGate(passingIds, candidateFails, quarantine);
    expect(gate.allowed).toBe(false);
    expect(gate.newRegressions.length).toBe(1);
  });

  it("permits quarantined pre-existing failures with transparency", async () => {
    const { runner, quarantineStore } = buildRunner("mixed");
    const outcome = await runner.run({ repoRoot: ROOT, baselineCommitSha: BASE_SHA, skipCache: true });
    const passingIds = outcome.receipt.tests.filter((t) => t.classification === "passing").map((t) => t.testId);
    const stillBroken = parseTestReporterOutput(MIXED_VITEST_JSON).cases as ParsedTestCase[];
    const gate = await runner.getQuarantineStore().evaluateRegressionGate(passingIds, stillBroken, await quarantineStore.listAll());
    expect(gate.allowed).toBe(true);
    expect(gate.message).toMatch(/quarantined/);
  });

  it("detects dirty baseline worktree leaks", async () => {
    const { runner } = buildRunner("healthy", ["debug.log"]);
    const outcome = await runner.run({ repoRoot: ROOT, baselineCommitSha: BASE_SHA, skipCache: true });
    expect(outcome.receipt.dirtyTreePaths).toContain("debug.log");
  });

  it("skips redundant baseline reruns via HEAD+lockfile cache", async () => {
    const { runner, healthStore } = buildRunner("healthy");
    const first = await runner.run({ repoRoot: ROOT, baselineCommitSha: BASE_SHA });
    const second = await runner.run({ repoRoot: ROOT, baselineCommitSha: BASE_SHA });
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(buildBaselineCacheKey(BASE_SHA, "lockhash-1")).toBeTruthy();
    expect(healthStore.listReceipts().length).toBeGreaterThanOrEqual(1);
  });

  it("classifies flake pass counts via ThreeRunFlakeDetector", () => {
    const detector = new ThreeRunFlakeDetector();
    expect(detector.classifyFromPassCounts(0, 3)).toBe("known_failing");
    expect(detector.classifyFromPassCounts(2, 3)).toBe("baseline_flaky");
    expect(detector.classifyFromPassCounts(3, 3)).toBe("passing");
  });

  it("BrokenBuildEntryGate exposes three choices on compile failure", () => {
    const gate = new BrokenBuildEntryGate();
    const result = gate.evaluate([
      {
        commandId: "typecheck",
        argv: ["pnpm", "typecheck"],
        exitCode: 1,
        durationMs: 9,
        reporterOutput: BROKEN_TS_OUTPUT,
      },
    ]);
    expect(result.choices.length).toBe(3);
  });
});