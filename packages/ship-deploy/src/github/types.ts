export type ShipMode = "pr" | "direct";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface ParsedGitHubRemote {
  readonly owner: string;
  readonly repo: string;
  readonly host: string;
  readonly raw: string;
  readonly transport: "https" | "ssh";
}

export interface GitHubUserIdentity {
  readonly userId: number;
  readonly login: string;
}

export interface GitHubRepoVisibility {
  readonly owner: string;
  readonly repo: string;
  readonly private: boolean;
  readonly visibility: "public" | "private" | "internal";
}

export interface BranchProtectionSnapshot {
  readonly branch: string;
  readonly protected: boolean;
  readonly requiredPullRequest: boolean;
  readonly requiredApprovingReviewCount: number;
  readonly requiredStatusChecks: readonly string[];
  readonly linearHistoryRequired: boolean;
  readonly signedCommitsRequired: boolean;
  readonly forcePushForbidden: boolean;
  readonly rulesetEnforced: boolean;
}

export interface ShipStrategy {
  readonly mode: ShipMode;
  readonly reason: string;
  readonly protection: BranchProtectionSnapshot;
}

export interface GitHubHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly etag?: string;
}

export interface GitHubHttpRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly mutating?: boolean;
}

export interface RateLimitPauseEvent {
  readonly reason: "secondary" | "primary" | "spacing";
  readonly resumeAtMs: number;
  readonly message: string;
}

export interface PrePushGuardResult {
  readonly visibility: GitHubRepoVisibility;
  readonly publicRepoBadge: string | null;
  readonly workflowScopeRequired: boolean;
  readonly workflowWarning: string | null;
  readonly remoteRefOk: boolean;
  readonly remoteSha: string | null;
}

export interface PollRunSnapshot {
  readonly completed: boolean;
  readonly failed: boolean;
  readonly inProgress: boolean;
  readonly runs: readonly { readonly id: number; readonly status: string; readonly conclusion: string | null }[];
}

export interface CliAuthSnapshot {
  readonly authenticated: boolean;
  readonly login: string | null;
  readonly token: string | null;
  readonly scopes: readonly string[];
  readonly hostname: string | null;
}

export interface DeviceCodePrompt {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly deviceCode: string;
  readonly intervalSec: number;
  readonly expiresAtMs: number;
}

export interface VaultSecretWriter {
  putGitHubToken(input: {
    readonly projectId: string;
    readonly login: string;
    readonly token: string;
    readonly scopes: readonly string[];
  }): Promise<{ readonly secretId: string }>;
  readGitHubToken(secretId: string): Promise<string>;
}

export interface MinGitRepoInspectorPort {
  lsRemote(repoPath: string, ref: string): Promise<string | null>;
  diffNameOnly(repoPath: string, range: string): Promise<readonly string[]>;
}

export interface EffectReconcilerRegistrar {
  register(effectType: string, fn: GitHubEffectReconciler): void;
}

export interface GitHubEffectReconcilerInput {
  readonly effectType: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
}

export type GitHubReconcileOutcome =
  | { readonly kind: "succeeded"; readonly receipt: unknown }
  | { readonly kind: "safe_to_retry" }
  | { readonly kind: "ambiguous"; readonly reason: string };

export type GitHubEffectReconciler = (
  input: GitHubEffectReconcilerInput,
) => Promise<GitHubReconcileOutcome> | GitHubReconcileOutcome;

export const PROTECTED_DEFAULT_BRANCHES = ["main", "master", "develop", "production"] as const;

export const GITHUB_DEVICE_VERIFICATION_URL = "https://github.com/login/device" as const;