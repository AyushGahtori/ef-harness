/** Sandbox tiers from verification-and-isolation.md. */
export type SandboxTier = 0 | 1 | 2 | 3;

/** Legal `state.db.check_results.status` values. Unstable replays use `error` plus receipt stability. */
export type CheckDbStatus = "pass" | "fail" | "skip" | "missing" | "error";

export type CheckStability = "stable" | "unstable";

export type CheckVisibility = "visible" | "held_back";

export type CheckSurface =
  | "unit"
  | "time"
  | "network"
  | "browser"
  | "api"
  | "auth"
  | "cli"
  | "migration"
  | "ai-eval"
  | "job";

export type FailureAttribution =
  | "implementation"
  | "contract_mismatch"
  | "binding_defect"
  | "environment"
  | "flaky_test";

export type AttributionRoute =
  | "hint_ladder"
  | "plain_message"
  | "task_author"
  | "env_owner"
  | "test_owner";

export type RequirementResolution = "passing" | "failing" | "unresolved" | "not_run";

export type EnvironmentFailureKind = "postgres_crash" | "oom" | "port_failure" | "service_crash";

export type CasRetention = "evidence" | "diagnostic";

export type CollectedStatus = "pass" | "fail" | "skip" | "error";

export type HintFailureType =
  | "wrong_value"
  | "missing_item"
  | "extra_item"
  | "wrong_order"
  | "exception"
  | "timeout";

/** Trusted signals from host-owned kernel code. Reporter stdout cannot set these. */
export interface RunSignals {
  readonly environmentFailure?: EnvironmentFailureKind;
  readonly bindingDefect?: boolean;
  readonly binderCrash?: boolean;
  readonly missingSetup?: boolean;
  readonly contractMismatch?: boolean;
  readonly visibleControlMissing?: boolean;
  readonly plainMessage?: string;
}

export interface DispatchFingerprint {
  readonly runnerSha256: string;
  readonly commandSha256: string;
  readonly configSha256: string;
  readonly expectationsSha256: string;
  readonly pinnedCommand: readonly string[];
  readonly runnerDigest: string;
  readonly configDigest: string;
  readonly expectationDigest: string;
}

export interface RequiredCheckRef {
  readonly checkId: string;
  readonly checkVersion: number;
  readonly requirementId: string;
  readonly visibility: CheckVisibility;
  readonly ruleId: string | null;
  readonly surface: CheckSurface;
  readonly flaky: boolean;
}

export interface AttemptLeaseView {
  readonly attemptId: string;
  readonly ttlMs: number;
  readonly submissionPending: boolean;
  readonly epoch: number;
  readonly state: string;
}

export interface CheckResultInsert {
  readonly checkId: string;
  readonly attempt: string;
  readonly checkVersion: number;
  readonly artifactDigest: string;
  readonly status: CheckDbStatus;
  readonly receipt: string;
  readonly recordedAt: number;
}

export interface VerifyCandidateRequest {
  readonly taskId: string;
  readonly attemptId: string;
  readonly commitSha: string;
  readonly artifactDigest: string;
  readonly sandboxTier: SandboxTier;
  readonly workerWorktreePath: string;
  readonly workerWorktreeId: string;
  readonly dependencyLockDigest: string;
  readonly dispatch: DispatchFingerprint;
  /** Elapsed attempt time. A pending submission keeps the lease alive past `ttlMs`. */
  readonly elapsedMs: number;
  /**
   * Check ids the worker claims it already ran. Never the acceptance set.
   * Required ids come from state (`task_requirements` plus in-scope cross-cutting rules).
   */
  readonly workerLocalCheckIds: readonly string[];
  /** Rule ids in scope for this attempt, including any of X-01..X-14 that apply. */
  readonly inScopeRuleIds: readonly string[];
}

export interface WorkerFacingCheck {
  readonly checkId: string;
  readonly status: CheckDbStatus;
  readonly stability: CheckStability;
  readonly message: string;
}

/** Payload that may be shown to the implementing worker. Held-back inputs and expectations are absent. */
export interface WorkerFacingReport {
  readonly accepted: boolean;
  readonly summary: string;
  readonly messages: readonly string[];
  readonly checks: readonly WorkerFacingCheck[];
}

/** Raw held-back failure handed only to the hint ladder (Task 065), never to the worker. */
export interface HintLadderPayload {
  readonly checkId: string;
  readonly ruleId: string | null;
  readonly failureType: HintFailureType;
  readonly input: unknown;
  readonly expected: unknown;
  readonly observed: unknown;
}

export interface CheckRunRecord {
  readonly observed: unknown;
  readonly traceDigest: string;
  readonly logDigest: string;
  readonly observationsDigest: string;
}

export interface CheckOutcome {
  readonly checkId: string;
  readonly checkVersion: number;
  readonly requirementId: string;
  readonly visibility: CheckVisibility;
  readonly ruleId: string | null;
  readonly status: CheckDbStatus;
  readonly stability: CheckStability;
  readonly attribution: FailureAttribution | null;
  readonly affectsWorkerQualityScore: boolean;
  readonly burnsHiddenLadder: boolean;
  readonly route: AttributionRoute | null;
  readonly runs: readonly CheckRunRecord[];
}

export interface VerificationOutcome {
  readonly accepted: boolean;
  readonly taskId: string;
  readonly attemptId: string;
  readonly commitSha: string;
  readonly artifactDigest: string;
  readonly sandboxTier: SandboxTier;
  readonly ranCandidate: boolean;
  readonly cleanCheckoutPath: string | null;
  readonly workerWorktreePath: string;
  readonly usedPinnedCommand: readonly string[];
  readonly ignoredCandidateTestScript: string | null;
  readonly ignoredWorkerLocalCheckIds: readonly string[];
  readonly leaseProtected: boolean;
  readonly staticAuditPassed: boolean;
  readonly candidateExitCode: number | null;
  readonly attribution: FailureAttribution | null;
  readonly affectsWorkerQualityScore: boolean;
  readonly burnsHiddenLadder: boolean;
  readonly requirementResolution: RequirementResolution;
  readonly holdForEnvRecovery: boolean;
  readonly checks: readonly CheckOutcome[];
  readonly workerFacing: WorkerFacingReport;
  readonly sealedHintLadder: readonly HintLadderPayload[];
}

export interface FailureAttributionDecision {
  readonly attribution: FailureAttribution;
  readonly affectsWorkerQualityScore: boolean;
  readonly burnsHiddenLadder: boolean;
  readonly burnsWorkerRetry: boolean;
  readonly route: AttributionRoute;
  readonly requirementEffect: "failing" | "unresolved";
  readonly holdForEnvRecovery: boolean;
  readonly workerMessage: string;
}

export interface AttributionInput {
  readonly status: CheckDbStatus | "unstable";
  readonly checkId: string;
  readonly visibility: CheckVisibility;
  readonly ruleId: string | null;
  readonly signals: RunSignals | null;
  readonly flakyDisagreement: boolean;
}

/** Fixed clock and seed for a clean flake replay. */
export const CLEAN_VERIFIER_REPLAY_CLOCK = {
  fixedIso: "2026-03-29T00:59:59.000Z",
  seed: "ef-clean-verifier-replay",
} as const;

export interface ReplayClock {
  readonly fixedIso: string;
  readonly seed: string;
}

export interface VerifierWorktreeSlot {
  readonly slotId: string;
  readonly commitSha: string;
  readonly worktreePath: string;
  readonly kind: "verifier";
}

export interface ProvisionedEnv {
  readonly id: string;
  readonly tier: SandboxTier;
  readonly isolatedFromAttemptId: string;
  vars(): Readonly<Record<string, string>>;
  destroy(): Promise<void>;
}

export interface LeafStaticAuditResult {
  readonly passed: boolean;
  readonly findings: readonly string[];
  readonly fingerprint: string;
}
