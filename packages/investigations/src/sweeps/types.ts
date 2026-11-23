export const REPO_WIDE_PREFIX = "" as const;
export const MAX_TAIL_SHARD_FILES = 8 as const;
export const CODEMOD_SANDBOX_TIMEOUT_MS = 60_000 as const;
export const SWEEP_BRANCH_PREFIX = "harness/s/" as const;
export const ACTIVE_OVERLAP_TASK_STATES = [
  "LEASED",
  "CODING",
  "STATIC_AUDIT",
  "CLEAN_VERIFY",
] as const;

export type PathLeaseMode = "intent" | "granted";

export type SweepPathScope =
  | { readonly kind: "repo_wide" }
  | { readonly kind: "globs"; readonly globs: readonly string[] };

export type SweepIntentRecord = {
  readonly leaseId: string;
  readonly sweepTask: string;
  readonly mode: "intent";
  readonly prefixes: readonly string[];
};

export type SweepGrantRecord = {
  readonly granted: boolean;
  readonly mode: PathLeaseMode;
  readonly blockedBy: string | null;
};

export type SweepLeaseAcquireInput = {
  readonly leaseId: string;
  readonly sweepTask: string;
  readonly scope: SweepPathScope;
  readonly now: number;
};

export type ActiveTaskSnapshot = {
  readonly taskId: string;
  readonly pathPrefixes: readonly string[];
  readonly state: string;
};

export type DrainProgress = {
  readonly sweepLabel: string;
  readonly overlappingActive: number;
  readonly overlappingDone: number;
  readonly cancellable: boolean;
  readonly message: string;
};

export type DrainResult =
  | { readonly ok: true; readonly granted: SweepGrantRecord }
  | { readonly ok: false; readonly reason: "cancelled" | "drain_timeout" | "grant_failed" };

export type CodemodEngine = "ts-morph" | "ast-grep" | "jscodeshift";

export type CodemodPlanStep = {
  readonly engine: CodemodEngine;
  readonly scopeGlobs: readonly string[];
  readonly dryRun: boolean;
};

export type CodemodDiffPreview = {
  readonly filesChanged: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly samplePaths: readonly string[];
};

export type CodemodRunResult =
  | { readonly ok: true; readonly preview: CodemodDiffPreview; readonly applied: boolean }
  | { readonly ok: false; readonly reason: "timeout" | "syntax_error" | "sandbox_error"; readonly detail: string };

export type SweepPlannerPlan = {
  readonly mechanicalSteps: readonly CodemodPlanStep[];
  readonly tailPaths: readonly string[];
  readonly behaviorPreserving: boolean;
  readonly persistedNamesKept: readonly string[];
};

export type SweepPlanPreview = {
  readonly title: string;
  readonly totalFiles: number;
  readonly codemodFiles: number;
  readonly manualEdgeFiles: number;
  readonly persistedNotes: readonly string[];
  readonly summaryLine: string;
};

export type TailShard = {
  readonly shardId: string;
  readonly paths: readonly string[];
};

export type SweepOrchestratorInput = {
  readonly sweepId: string;
  readonly slug: string;
  readonly label: string;
  readonly scope: SweepPathScope;
  readonly plan: SweepPlannerPlan;
  readonly integrationHead: string;
};

export type SweepOrchestratorResult =
  | {
      readonly ok: true;
      readonly branch: string;
      readonly shards: readonly TailShard[];
      readonly landed: boolean;
    }
  | { readonly ok: false; readonly phase: "lease" | "drain" | "branch" | "codemod" | "aborted"; readonly detail: string };

export type StaleSweepLease = {
  readonly leaseId: string;
  readonly sweepTask: string;
  readonly mode: PathLeaseMode;
  readonly branch?: string;
};

export type StaleSweepRecoveryChoice = "resume" | "discard";

export type StaleSweepRecoveryResult = {
  readonly leases: readonly StaleSweepLease[];
  readonly prompt: string;
};