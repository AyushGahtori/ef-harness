export type TestOutcomeStatus = "pass" | "fail" | "skip" | "error";

export type BaselineTestClassification = "passing" | "known_failing" | "baseline_flaky";

export interface ParsedTestCase {
  readonly testId: string;
  readonly filePath: string | null;
  readonly status: TestOutcomeStatus;
  readonly errorMessage: string | null;
  readonly durationMs: number | null;
}

export interface CommandReceipt {
  readonly commandId: "typecheck" | "lint" | "build" | "test";
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly durationMs: number;
  readonly reporterOutput: string | null;
}

export interface BaselineTestRecord {
  readonly testId: string;
  readonly filePath: string | null;
  readonly classification: BaselineTestClassification;
  readonly passCount: number;
  readonly runCount: number;
  readonly errorFingerprint: string | null;
  readonly durationMs: number | null;
}

export interface BaselineTestHealthReceipt {
  readonly baselineCommitSha: string;
  readonly lockfileSha256: string;
  readonly worktreeSlotId: string;
  readonly capturedAt: string;
  readonly commands: readonly CommandReceipt[];
  readonly tests: readonly BaselineTestRecord[];
  readonly passingCount: number;
  readonly knownFailingCount: number;
  readonly baselineFlakyCount: number;
  readonly buildBlocked: boolean;
  readonly dirtyTreePaths: readonly string[];
  readonly characterizationPhaseSuggested: boolean;
  readonly quarantineSummary: string;
}

export interface QuarantinedTestRow {
  readonly testId: string;
  readonly filePath: string | null;
  readonly errorFingerprint: string | null;
  readonly baselineCommitSha: string;
  readonly classification: "known_failing" | "baseline_flaky";
}

export type BrokenBuildChoice =
  | "fix_baseline_first"
  | "inspect_environment"
  | "proceed_scoped_anyway";

export interface BrokenBuildGateResult {
  readonly blocked: boolean;
  readonly failedCommand: CommandReceipt | null;
  readonly choices: readonly BrokenBuildChoice[];
  readonly compilerErrors: readonly string[];
}

export interface FlakeClassification {
  readonly testId: string;
  readonly passCount: number;
  readonly runCount: number;
  readonly classification: BaselineTestClassification;
}

export interface CharacterizationTestSpec {
  readonly testId: string;
  readonly modulePath: string;
  readonly title: string;
  readonly source: "generated";
}

export interface CharacterizationSafetyNetPlan {
  readonly phaseId: "P0.B-Char";
  readonly targetModules: readonly string[];
  readonly tests: readonly CharacterizationTestSpec[];
  readonly skippedByDeveloper: boolean;
  readonly baselineGreenVerified: boolean;
}

export interface RegressionGateResult {
  readonly allowed: boolean;
  readonly newRegressions: readonly string[];
  readonly quarantinedStillFailing: readonly string[];
  readonly message: string;
}

export interface BaselineHealthCacheEntry {
  readonly cacheKey: string;
  readonly receipt: BaselineTestHealthReceipt;
}

export interface DetectedRepoScripts {
  readonly typecheck: readonly string[] | null;
  readonly lint: readonly string[] | null;
  readonly build: readonly string[] | null;
  readonly test: readonly string[] | null;
  readonly testFileCount: number;
}