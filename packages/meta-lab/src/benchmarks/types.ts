export type BenchmarkSplit = "dev" | "held_out";

export type SuiteId =
  | "suite:kitchen-web"
  | "suite:resume-changer-brownfield"
  | "suite:expense-cli"
  | "suite:booking-api"
  | "suite:ten-bug-set"
  | "suite:sweep-set"
  | "suite:red-team-security";

export interface GradeResult {
  readonly passed: boolean;
  readonly checksPassed: number;
  readonly checksTotal: number;
  readonly failedCheckIds: readonly string[];
  readonly durationMs: number;
  readonly paperworkPct: number;
  readonly securityViolations: readonly string[];
}

export interface BenchmarkReceipts {
  readonly split: BenchmarkSplit;
  readonly suiteVersion: string;
  readonly manifestDigest: string;
  readonly caseId: string;
  readonly suiteId: SuiteId;
}

export type GradeFn = (builtRepoPath: string, receipts: BenchmarkReceipts) => GradeResult;

export interface BenchmarkCaseDefinition {
  readonly id: string;
  readonly split: BenchmarkSplit;
  readonly tags: readonly string[];
  readonly smoke: boolean;
  readonly fixtureRelativePath: string;
  readonly pinnedCommitSha?: string;
  readonly grade: GradeFn;
}

export interface SuiteDefinition {
  readonly id: SuiteId;
  readonly title: string;
  readonly suiteVersion: string;
  readonly manifestDigest: string;
  readonly description: string;
  readonly cases: readonly BenchmarkCaseDefinition[];
}

export interface BenchmarkFilter {
  readonly suite?: SuiteId;
  readonly split?: BenchmarkSplit;
  readonly tag?: string;
  readonly smoke?: boolean;
}

export interface MaterializedBenchmark {
  readonly caseId: string;
  readonly suiteId: SuiteId;
  readonly split: BenchmarkSplit;
  readonly workspacePath: string;
  readonly pinnedCommitSha: string | null;
  readonly liveCloneSkippedOffline: boolean;
  readonly cleanup: () => Promise<void>;
}

export interface ResumeChangerBenchmarkManifest {
  readonly repository: string;
  readonly commit: string;
  readonly summary: {
    readonly markdown_files: number;
    readonly plan_or_task_files: number;
    readonly plan_or_task_lines: number;
  };
  readonly files: readonly {
    readonly path: string;
    readonly sha256: string;
    readonly lines: number;
    readonly plan_or_task: boolean;
  }[];
}

export interface ContaminationScanResult {
  readonly clean: boolean;
  readonly matches: readonly string[];
}