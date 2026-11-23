export const DEPLOY_TARGET_ENVS = ["preview", "staging", "production"] as const;
export type DeployTargetEnv = (typeof DEPLOY_TARGET_ENVS)[number];

export interface SecretNameHash {
  readonly name: string;
  readonly hmac: string;
}

export interface NameOnlyEnvDiff {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly deleted: readonly string[];
  readonly summary: string;
}

export interface EnvDiffPlan {
  readonly diff: NameOnlyEnvDiff;
  readonly approvalLines: readonly string[];
}

export interface DeployPlan {
  readonly targetEnv: DeployTargetEnv;
  readonly commitSha: string;
  readonly targetLabel: string;
  readonly buildSummary: string;
  readonly envDiff: NameOnlyEnvDiff;
  readonly approvalLines: readonly string[];
  readonly swapStrategy: string;
}

export interface DeployOutcome {
  readonly deploymentId: string;
  readonly liveUrl: string;
  readonly buildId: string;
  readonly previousDeploymentId: string | null;
}

export interface DeployAuthProbe {
  readonly ok: boolean;
  readonly summary: string;
  readonly accountLabel?: string;
}

export interface ReconcileOutcome {
  readonly state: "succeeded" | "in_progress" | "not_found";
  readonly deploymentId?: string;
  readonly liveUrl?: string;
  readonly buildId?: string;
}

export interface VaultEnvSecret {
  readonly secretId: string;
  readonly name: string;
  readonly value: string;
  readonly envScope: string;
}

export interface ApprovalCardPayload {
  readonly effectType: string;
  readonly targetEnv: DeployTargetEnv;
  readonly commitSha: string;
  readonly canonicalPayloadHash: string;
  readonly envDiff: NameOnlyEnvDiff;
  readonly migrationStatus?: string;
}

export type ApprovalStatus = "pending_approval" | "approved" | "denied" | "auto_allowed";