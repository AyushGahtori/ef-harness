import type {
  AttemptLeaseView,
  CasRetention,
  CheckResultInsert,
  CheckSurface,
  LeafStaticAuditResult,
  ProvisionedEnv,
  ReplayClock,
  RequiredCheckRef,
  RunSignals,
  SandboxTier,
  VerifierWorktreeSlot,
} from "./types.js";

export type {
  AttemptLeaseView,
  CheckResultInsert,
  RequiredCheckRef,
  VerifierWorktreeSlot,
  ProvisionedEnv,
  LeafStaticAuditResult,
};

/** Local stand-in for `WorktreeSlotManager` (Task 038). */
export interface WorktreeSlotManagerPort {
  checkoutImmutable(request: {
    readonly commitSha: string;
    readonly kind: "verifier";
    readonly excludeWorktreePath: string;
    readonly excludeWorktreeId: string;
  }): Promise<VerifierWorktreeSlot>;
  attachLockedDependencies(slot: VerifierWorktreeSlot, lockDigest: string): Promise<void>;
  release(slot: VerifierWorktreeSlot): Promise<void>;
}

/** Local stand-in for `TestEnvOrchestrator` (Task 049). */
export interface TestEnvOrchestratorPort {
  provision(request: {
    readonly tier: SandboxTier;
    readonly isolatedFromAttemptId: string;
    readonly commitSha: string;
    readonly replay: boolean;
    readonly clock?: ReplayClock;
  }): Promise<ProvisionedEnv>;
}

/** Input passed into the sandbox. Expectations are intentionally absent. */
export interface SandboxCheckInput {
  readonly checkId: string;
  readonly input: unknown;
  readonly surface: CheckSurface;
  readonly entry?: string;
}

export interface PinnedRunRequest {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly envId: string;
  readonly sandboxTier: SandboxTier;
  readonly commitSha: string;
  readonly attemptId: string;
  readonly inputs: readonly SandboxCheckInput[];
  readonly hostChannel: "host-owned";
  readonly replay: boolean;
  readonly clock?: ReplayClock;
}

export interface PinnedRunResult {
  readonly exitCode: number | null;
  readonly reporterBody: string;
  readonly trace: Uint8Array;
  readonly log: Uint8Array;
  readonly signals?: RunSignals;
}

/** Local stand-in for `HarnessRunEngine` (Task 047). */
export interface HarnessRunEnginePort {
  runPinned(request: PinnedRunRequest): Promise<PinnedRunResult>;
}

/** Local stand-in for `CompletenessGateRunner` (Task 059). */
export interface CompletenessGateRunnerPort {
  runLeafStaticAudit(input: {
    readonly taskId: string;
    readonly attemptId: string;
    readonly commitSha: string;
    readonly checkoutPath: string;
  }): Promise<LeafStaticAuditResult>;
}

/** Local stand-in for `CasBlobStore` (Task 028). */
export interface CasBlobStorePort {
  get(digest: string): Promise<Uint8Array | null>;
  put(
    bytes: Uint8Array,
    meta: { readonly retention: CasRetention; readonly label: string },
  ): Promise<string>;
}

/**
 * Local stand-in for `state.db` reads and `check_results` writes.
 * `listRequiredChecks` must already union task requirements with in-scope cross-cutting rules.
 */
export interface CheckResultsPort {
  listRequiredChecks(taskId: string): Promise<readonly RequiredCheckRef[]>;
  readAttemptLease(attemptId: string): Promise<AttemptLeaseView>;
  insertCheckResult(row: CheckResultInsert): Promise<void>;
}

export interface SurfaceCheckResult {
  readonly checkId: string;
  readonly observed: unknown;
  readonly hasObserved: boolean;
  readonly reporterStatus: "pass" | "fail" | "skip" | "error" | null;
  readonly signals: RunSignals | null;
  readonly trace: Uint8Array;
  readonly log: Uint8Array;
}

export interface SurfaceCollectInput {
  readonly checkoutPath: string;
  readonly commitSha: string;
  readonly attemptId: string;
  readonly env: ProvisionedEnv;
  readonly checks: readonly SandboxCheckInput[];
  readonly replay: boolean;
  readonly clock?: ReplayClock;
}

/**
 * Plug-in for UI, API, auth, CLI, migration, and AI-eval verifiers (Tasks 062–064).
 * Adapters return observations. The runner compares them outside the candidate.
 */
export interface SurfaceVerifierAdapter {
  readonly id: string;
  supports(check: RequiredCheckRef): boolean;
  collect(input: SurfaceCollectInput): Promise<readonly SurfaceCheckResult[]>;
}

export interface ExpectationUnsealer {
  unseal(stored: Uint8Array): Uint8Array;
}

export interface CleanVerifierDeps {
  readonly slots: WorktreeSlotManagerPort;
  readonly environments: TestEnvOrchestratorPort;
  readonly engine: HarnessRunEnginePort;
  readonly gate: CompletenessGateRunnerPort;
  readonly cas: CasBlobStorePort;
  readonly state: CheckResultsPort;
  readonly unsealer?: ExpectationUnsealer;
  readonly now?: () => number;
  readonly hostTempRoot?: string;
}
