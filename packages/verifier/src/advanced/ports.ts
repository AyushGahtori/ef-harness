/**
 * Local ports for sibling contracts that are not on this branch.
 * Task 060 owns SurfaceVerifierAdapter. Task 053 owns ModelProtocolAdapter.
 * Swap these types for those exports when the sibling packages are integrated.
 */

export interface ModelFamilyProfile {
  readonly id: string;
  readonly family: string;
  readonly provider: string;
}

export interface ModelCompletionRequest {
  readonly role: "generator" | "judge" | "format_repair";
  readonly prompt: string;
  readonly inputHash: string;
  readonly sampleIndex?: number;
}

export type ModelStopReason =
  | "stop"
  | "malformed_json"
  | "empty"
  | "rate_limited"
  | "timeout"
  | "over_budget"
  | "unavailable";

export interface ModelCompletionResult {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number;
  readonly stopReason: ModelStopReason;
  readonly latencyMs: number;
}

export interface ModelProtocolAdapter {
  readonly profile: ModelFamilyProfile;
  complete(request: ModelCompletionRequest): Promise<ModelCompletionResult>;
}

export type SurfaceCheckStatus = "pass" | "fail" | "error" | "pending" | "skip";

export interface SurfaceCheckResult {
  readonly checkId: string;
  readonly status: SurfaceCheckStatus;
  readonly receipt: unknown;
}

export interface SurfaceVerifierContext {
  readonly taskId: string;
  readonly commitSha: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly surfaceInput?: unknown;
}

export interface SurfaceVerifierAdapter {
  readonly surface: string;
  verify(context: SurfaceVerifierContext): Promise<readonly SurfaceCheckResult[]>;
}
