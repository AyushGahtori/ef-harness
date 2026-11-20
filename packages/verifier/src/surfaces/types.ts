/**
 * Local port of `SurfaceVerifierAdapter` and `SurfaceCheckResult` from Task 060.
 * Task 060 owns `packages/verifier/src/runner/**` and is not on this branch.
 * The shapes match `state.db.check_results` so `CleanVerifierRunner` can record
 * every check uniformly once that runner is wired.
 */

export const CHECK_STATUSES = ["pass", "fail", "skip", "missing", "error"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const FAILURE_ATTRIBUTIONS = [
  "implementation",
  "contract_mismatch",
  "binding_defect",
  "environment",
  "flaky_test",
] as const;
export type FailureAttribution = (typeof FAILURE_ATTRIBUTIONS)[number];

export interface SurfaceCheckResult {
  readonly check_id: string;
  readonly status: CheckStatus;
  readonly receipt: Readonly<Record<string, unknown>>;
  readonly message?: string;
  readonly attribution?: FailureAttribution;
}

export interface CheckResultRow {
  readonly check_id: string;
  readonly attempt: string;
  readonly check_version: number;
  readonly artifact_digest: string;
  readonly status: CheckStatus;
  readonly receipt: string;
  readonly recorded_at: number;
}

export interface AttemptEnvironment {
  readonly id: string;
  readonly tier: 0 | 1 | 2 | 3;
  vars(): Readonly<Record<string, string>> & { readonly APP_URL?: string };
}

export interface SurfaceVerifierContext {
  readonly env: AttemptEnvironment;
  readonly attemptId: string;
  readonly checkVersion: number;
  readonly artifactDigest: string;
  readonly recordedAt?: number;
}

export interface SurfaceVerifierAdapter {
  readonly id: string;
  readonly surface: string;
  verify(spec: unknown, context: SurfaceVerifierContext): Promise<readonly SurfaceCheckResult[]>;
}

export interface SurfaceVerifierRegistry {
  register(adapter: SurfaceVerifierAdapter): void;
  list(): readonly SurfaceVerifierAdapter[];
}
