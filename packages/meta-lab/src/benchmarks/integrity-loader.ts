import { BenchmarkIntegrityError, BenchmarkVersionMismatchError } from "./errors.js";
import { materializeBenchmarkCase } from "./hermetic-workspace.js";
import { verifySuiteFixturePins } from "./manifest-digest.js";
import type { MetaLabBenchmarkRegistry } from "./registry.js";
import type { BenchmarkReceipts, SuiteId } from "./types.js";

export class FrozenSuiteIntegrityLoader {
  load(registry: MetaLabBenchmarkRegistry): void {
    for (const suite of registry.listSuites()) {
      try {
        verifySuiteFixturePins(suite);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new BenchmarkIntegrityError(`${suite.id}: ${message}`);
      }
    }
  }

  assertComparableVersions(digestA: string, digestB: string): void {
    if (digestA !== digestB) {
      throw new BenchmarkVersionMismatchError(
        "cannot compare evaluation results across different suite manifest digests",
      );
    }
  }

  async verifyTenBugBaselines(registry: MetaLabBenchmarkRegistry): Promise<void> {
    const suite = registry.getSuite("suite:ten-bug-set");
    for (const benchmarkCase of suite.cases) {
      const materialized = await materializeBenchmarkCase(registry, suite.id, benchmarkCase.id);
      try {
        const receipts = this.stampReceipt(suite.id, benchmarkCase.id, registry);
        const grade = benchmarkCase.grade(materialized.workspacePath, receipts);
        if (grade.passed) {
          throw new BenchmarkIntegrityError(
            `ten-bug-set case ${benchmarkCase.id} must fail on untouched baseline`,
          );
        }
      } finally {
        await materialized.cleanup();
      }
    }
  }

  stampReceipt(
    suiteId: SuiteId,
    caseId: string,
    registry: MetaLabBenchmarkRegistry,
  ): BenchmarkReceipts {
    const suite = registry.getSuite(suiteId);
    const benchmarkCase = suite.cases.find((row) => row.id === caseId);
    if (!benchmarkCase) {
      throw new BenchmarkIntegrityError(`unknown case ${caseId} in ${suiteId}`);
    }
    return {
      caseId,
      suiteId,
      split: benchmarkCase.split,
      suiteVersion: suite.suiteVersion,
      manifestDigest: suite.manifestDigest,
    };
  }
}