import type {
  ActiveTaskSnapshot,
  CodemodRunResult,
  SweepGrantRecord,
  SweepIntentRecord,
  SweepPathScope,
} from "./types.js";

export type SweepLeasePort = {
  readonly openSweepIntent: (input: {
    readonly leaseId: string;
    readonly sweepTask: string;
    readonly globs: readonly string[];
    readonly now: number;
  }) => SweepIntentRecord;
  readonly grantSweepLease: (leaseId: string) => SweepGrantRecord;
  readonly releaseSweepLease: (leaseId: string) => { readonly released: boolean };
  readonly listActiveRepoWideLeases?: () => readonly string[];
};

export type TaskRuntimePort = {
  readonly listActiveTasks: () => readonly ActiveTaskSnapshot[];
  readonly requestDrain: (taskId: string) => Promise<void> | void;
  readonly onTaskParked?: (taskId: string) => void;
};

export type WorktreeSlotPoolPort = {
  readonly ensureSweepBranch: (input: {
    readonly slug: string;
    readonly integrationHead: string;
  }) => Promise<{ readonly branch: string; readonly worktreePath: string }>;
  readonly discardSweepBranch: (slug: string) => Promise<void> | void;
};

export type RefLeaseAndCasManagerPort = {
  readonly casUpdateRef: (input: {
    readonly ref: string;
    readonly newSha: string;
    readonly message: string;
  }) => Promise<{ readonly updated: boolean }>;
};

export type SandboxedRunnerPort = {
  readonly run: (
    cwd: string,
    command: string,
    args: readonly string[],
    timeoutMs: number,
  ) => Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>;
};

export type CodemodBackendPort = {
  readonly runTsMorphRename: (input: {
    readonly projectRoot: string;
    readonly oldName: string;
    readonly newName: string;
    readonly fileGlobs: readonly string[];
    readonly dryRun: boolean;
  }) => Promise<CodemodRunResult>;
  readonly runAstGrepRule: (input: {
    readonly projectRoot: string;
    readonly ruleYaml: string;
    readonly dryRun: boolean;
  }) => Promise<CodemodRunResult>;
};

export type SweepSafetyPort = {
  readonly runLeftoverScan?: (branch: string) => Promise<{ readonly ok: boolean }>;
  readonly runRegressionGate?: (branch: string) => Promise<{ readonly ok: boolean }>;
};

export type SweepOrchestratorPorts = {
  readonly leases: SweepLeasePort;
  readonly tasks: TaskRuntimePort;
  readonly worktrees: WorktreeSlotPoolPort;
  readonly refs: RefLeaseAndCasManagerPort;
  readonly sandbox: SandboxedRunnerPort;
  readonly codemods: CodemodBackendPort;
  readonly safety?: SweepSafetyPort;
};

export type ScopeToGlobs = (scope: SweepPathScope) => readonly string[];