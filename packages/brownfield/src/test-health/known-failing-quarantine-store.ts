import type { BaselineTestRecord, QuarantinedTestRow, RegressionGateResult, ParsedTestCase } from "./types.js";
import type { QuarantinedTestsStorePort } from "./ports.js";

export interface QuarantineTransparencyReceipt {
  readonly knownFailingCount: number;
  readonly baselineFlakyCount: number;
  readonly summary: string;
  readonly offerFixThemToo: boolean;
}

/**
 * Records pre-existing baseline failures so later gates enforce zero NEW regressions.
 */
export class KnownFailingQuarantineStore {
  constructor(private readonly store: QuarantinedTestsStorePort) {}

  async recordFromBaseline(
    tests: readonly BaselineTestRecord[],
    baselineCommitSha: string,
  ): Promise<QuarantineTransparencyReceipt> {
    const rows: QuarantinedTestRow[] = [];
    for (const test of tests) {
      if (test.classification === "passing") continue;
      rows.push({
        testId: test.testId,
        filePath: test.filePath,
        errorFingerprint: test.errorFingerprint,
        baselineCommitSha,
        classification: test.classification === "baseline_flaky" ? "baseline_flaky" : "known_failing",
      });
    }
    await this.store.replaceAll(rows);
    const knownFailingCount = rows.filter((r) => r.classification === "known_failing").length;
    const baselineFlakyCount = rows.filter((r) => r.classification === "baseline_flaky").length;
    const parts: string[] = [];
    if (knownFailingCount > 0) {
      parts.push(`${knownFailingCount} pre-existing failing test${knownFailingCount === 1 ? "" : "s"} excluded from regression gate`);
    }
    if (baselineFlakyCount > 0) {
      parts.push(`${baselineFlakyCount} baseline flaky test${baselineFlakyCount === 1 ? "" : "s"} flagged transparently`);
    }
  const summary = parts.length > 0 ? parts.join("; ") : "All baseline tests passing";
    return {
      knownFailingCount,
      baselineFlakyCount,
      summary,
      offerFixThemToo: knownFailingCount > 0,
    };
  }

  async evaluateRegressionGate(
    baselinePassingIds: readonly string[],
    candidateResults: readonly ParsedTestCase[],
    quarantined: readonly QuarantinedTestRow[],
  ): Promise<RegressionGateResult> {
    const quarantineIds = new Set(quarantined.map((r) => r.testId));
    const passingFloor = new Set(baselinePassingIds);
    const fails = new Map<string, ParsedTestCase>();
    for (const row of candidateResults) {
      if (row.status === "fail" || row.status === "error") {
        fails.set(row.testId, row);
      }
    }

    const newRegressions: string[] = [];
    for (const testId of passingFloor) {
      if (fails.has(testId)) {
        newRegressions.push(testId);
      }
    }

    const quarantinedStillFailing: string[] = [];
    for (const row of quarantined) {
      if (fails.has(row.testId)) {
        quarantinedStillFailing.push(row.testId);
      }
    }

    const allowed = newRegressions.length === 0;
    const message = allowed
      ? quarantineIds.size > 0
        ? `Regression gate passed; quarantined pre-existing failures permitted (${quarantinedStillFailing.length} still failing)`
        : "Regression gate passed"
      : `Regression gate rejected ${newRegressions.length} new regression(s) on previously passing baseline tests`;

    return { allowed, newRegressions, quarantinedStillFailing, message };
  }

  async warnQuarantineInModifiedFiles(
    modifiedPaths: readonly string[],
    quarantined: readonly QuarantinedTestRow[],
  ): Promise<readonly string[]> {
    const normalized = new Set(modifiedPaths.map((p) => p.replaceAll("\\", "/").toLowerCase()));
    const warnings: string[] = [];
    for (const row of quarantined) {
      if (!row.filePath) continue;
      const file = row.filePath.replaceAll("\\", "/").toLowerCase();
      if (normalized.has(file)) {
        warnings.push(
          `Quarantined test ${row.testId} lives in ${row.filePath} which your change modifies — decide whether to fix or preserve quarantine`,
        );
      }
    }
    return warnings;
  }

  async listQuarantined(): Promise<readonly QuarantinedTestRow[]> {
    return this.store.listAll();
  }
}