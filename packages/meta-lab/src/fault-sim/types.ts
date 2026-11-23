export const TX_BOUNDARY_HOOKS = [
  "before_begin_immediate",
  "before_sqlite_commit",
  "after_commit_before_git_update_ref",
  "after_git_update_ref_before_cas_pin",
  "after_cas_pin_before_ack",
  "after_effects_dispatched_before_http_response",
  "mid_sqlite_wal_write",
] as const;

export type TxBoundaryHook = (typeof TX_BOUNDARY_HOOKS)[number];

export const FAULT_CLASSES = [
  "tx_crash",
  "provider_network",
  "git_worktree",
  "disk_ram",
  "sandbox_subprocess",
  "foreign_cli",
  "human_interference",
] as const;

export type FaultClass = (typeof FAULT_CLASSES)[number];

export interface ScheduledFault {
  readonly tick: number;
  readonly class: FaultClass;
  readonly hook?: TxBoundaryHook;
  readonly detail: string;
}

export interface FaultEvent {
  readonly tick: number;
  readonly class: FaultClass;
  readonly hook: TxBoundaryHook | null;
  readonly detail: string;
  readonly recovered: boolean;
}

export interface FaultCoverageMatrix {
  readonly hooks: Readonly<Record<TxBoundaryHook, number>>;
  readonly classes: Readonly<Record<FaultClass, number>>;
  readonly totalRuns: number;
}

export interface ChaosRunResult {
  readonly seed: number;
  readonly passed: boolean;
  readonly invariantViolations: readonly string[];
  readonly faultTrace: readonly FaultEvent[];
  readonly scheduledFaults: readonly ScheduledFault[];
  readonly coverageMatrix: FaultCoverageMatrix;
  readonly traceHash: string;
  readonly virtualTimeMs: number;
  readonly artifactRoot: string | null;
}

export interface ChaosSweepResult {
  readonly seeds: number;
  readonly passed: number;
  readonly failed: number;
  readonly elapsedMs: number;
  readonly coverage: FaultCoverageMatrix;
  readonly runs: readonly ChaosRunResult[];
}

export interface ChaosInvariantSnapshot {
  readonly stateIntegrity: "ok" | "bad";
  readonly globalIntegrity: "ok" | "bad";
  readonly pathLeases: number;
  readonly duplicateEffects: number;
  readonly integrationCommits: number;
  readonly budgetOverruns: number;
  readonly leakedChildPids: number;
  readonly watcherHandles: number;
  readonly plaintextSecrets: number;
  readonly silentStashes: number;
  readonly parkedOrProgressing: boolean;
}