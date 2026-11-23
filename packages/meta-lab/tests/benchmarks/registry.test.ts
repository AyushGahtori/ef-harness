import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  BenchmarkContaminationError,
  BenchmarkIntegrityError,
  BenchmarkVersionMismatchError,
  BenchmarkVersionLedger,
  FrozenSuiteIntegrityLoader,
  MetaLabBenchmarkRegistry,
  PromptContaminationScanner,
  SEVEN_SUITE_DEFINITIONS,
  SUITE_IDS,
  cleanupAllHermeticWorkspaces,
  loadResumeChangerBenchmarkManifest,
  materializeBenchmarkCase,
  verifyResumeChangerManifestParity,
} from "../../src/benchmarks/index.js";

afterEach(async () => {
  await cleanupAllHermeticWorkspaces();
});

describe("meta-lab benchmarks registry", () => {
  it("registers all seven frozen suites with manifest pins", () => {
    const registry = new MetaLabBenchmarkRegistry();
    expect(registry.listSuites()).toHaveLength(7);
    expect(SUITE_IDS).toEqual([
      "suite:kitchen-web",
      "suite:resume-changer-brownfield",
      "suite:expense-cli",
      "suite:booking-api",
      "suite:ten-bug-set",
      "suite:sweep-set",
      "suite:red-team-security",
    ]);
    for (const suite of SEVEN_SUITE_DEFINITIONS) {
      expect(suite.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(suite.suiteVersion).toBe("suite_v1.0");
    }
  });

  it("loads integrity pins and verifies resume-changer manifest parity", () => {
    const registry = new MetaLabBenchmarkRegistry();
    const loader = new FrozenSuiteIntegrityLoader();
    loader.load(registry);
    const manifest = loadResumeChangerBenchmarkManifest();
    verifyResumeChangerManifestParity(manifest);
  });

  it("filters suites by split, tag, and smoke", () => {
    const registry = new MetaLabBenchmarkRegistry();
    expect(registry.listCases({ suite: "suite:booking-api", tag: "concurrency" })).toHaveLength(1);
    expect(registry.listCases({ split: "held_out" }).length).toBeGreaterThan(0);
    expect(registry.listCases({ smoke: true }).length).toBeGreaterThan(0);
  });

  it("rejects tampered manifest digests", () => {
    const tampered = SEVEN_SUITE_DEFINITIONS.map((suite) =>
      suite.id === "suite:expense-cli"
        ? { ...suite, manifestDigest: "0".repeat(64) }
        : suite,
    );
    const registry = new MetaLabBenchmarkRegistry(tampered);
    const loader = new FrozenSuiteIntegrityLoader();
    expect(() => loader.load(registry)).toThrow(BenchmarkIntegrityError);
  });

  it(
    "proves every ten-bug fixture fails on untouched baseline",
    async () => {
      const registry = new MetaLabBenchmarkRegistry();
      const loader = new FrozenSuiteIntegrityLoader();
      loader.load(registry);
      await loader.verifyTenBugBaselines(registry);
    },
    30_000,
  );

  it("rejects unpaired cross-version comparisons", () => {
    const loader = new FrozenSuiteIntegrityLoader();
    expect(() => loader.assertComparableVersions("a".repeat(64), "b".repeat(64))).toThrow(
      BenchmarkVersionMismatchError,
    );
    const ledger = new BenchmarkVersionLedger(new MetaLabBenchmarkRegistry());
    expect(() => ledger.assertPairedComparison("a".repeat(64), "b".repeat(64))).toThrow(
      BenchmarkVersionMismatchError,
    );
  });

  it("materializes and cleans up hermetic workspaces", async () => {
    const registry = new MetaLabBenchmarkRegistry();
    const materialized = await materializeBenchmarkCase(
      registry,
      "suite:resume-changer-brownfield",
      "resume-changer:offline-slice",
    );
    expect(fs.existsSync(materialized.workspacePath)).toBe(true);
    expect(materialized.liveCloneSkippedOffline).toBe(true);
    const loader = new FrozenSuiteIntegrityLoader();
    const receipts = loader.stampReceipt(
      materialized.suiteId,
      materialized.caseId,
      registry,
    );
    expect(receipts.split).toBe("held_out");
    const suite = registry.getSuite(materialized.suiteId);
    const benchmarkCase = suite.cases.find((row) => row.id === materialized.caseId)!;
    const grade = benchmarkCase.grade(materialized.workspacePath, receipts);
    expect(grade.passed).toBe(true);
    await materialized.cleanup();
    expect(fs.existsSync(materialized.workspacePath)).toBe(false);
    await cleanupAllHermeticWorkspaces();
  });

  it("detects held-out contamination in candidate prompts", () => {
    const scanner = new PromptContaminationScanner();
    const contaminated =
      "For example, check 11:00 AM kitchen cutoff and CateringEmail before promoting.";
    expect(scanner.scan(contaminated).clean).toBe(false);
    expect(() => scanner.scan(contaminated, { hardFail: true })).toThrow(
      BenchmarkContaminationError,
    );
    const clean = "Plan features using the project's own acceptance criteria.";
    expect(scanner.scan(clean).clean).toBe(true);
  });

  it("stamps split metadata on receipts for held-out cases", () => {
    const registry = new MetaLabBenchmarkRegistry();
    const loader = new FrozenSuiteIntegrityLoader();
    const receipt = loader.stampReceipt(
      "suite:kitchen-web",
      "kitchen:order-cutoff",
      registry,
    );
    expect(receipt.split).toBe("held_out");
    expect(receipt.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});