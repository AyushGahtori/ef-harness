import type {
  ApprovalCardPayload,
  ApprovalStatus,
  DeployTargetEnv,
  SecretNameHash,
  VaultEnvSecret,
} from "./types.js";

/** Local port of Task 120 `WindowsDpapiSecretsVault` name-only exports. */
export interface VaultNameHashPort {
  listSecretNamesAndHashes(projectId: string, envScope: string): readonly SecretNameHash[];
  listSecretsForDeploy(projectId: string, envScope: string): Promise<readonly VaultEnvSecret[]>;
}

/** Local port of Task 176 `EnvApprovalPolicyEngine`. */
export interface DeployApprovalPort {
  requiresExplicitApproval(effectType: string, targetEnv: DeployTargetEnv): boolean;
  assertDispatchAllowed(input: {
    readonly effectType: string;
    readonly targetEnv: DeployTargetEnv;
    readonly approvalStatus: ApprovalStatus;
    readonly autoApprove?: boolean;
  }): void;
  buildApprovalPayload(input: ApprovalCardPayload): { readonly lines: readonly string[] };
}

export interface SshExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SshExecRequest {
  readonly command: string;
  readonly stdin?: string;
  readonly strictHostKeyChecking: "yes";
}

export interface SshTransportPort {
  readonly host: string;
  readonly fingerprint: string;
  exec(request: SshExecRequest): Promise<SshExecResult>;
}

export interface KnownHostsPort {
  lookup(host: string): string | null;
  pin(host: string, fingerprint: string): void;
}

export interface VercelRemoteEnvPort {
  listNameHashes(projectId: string, target: DeployTargetEnv): Promise<readonly SecretNameHash[]>;
  applyNameDiff(
    projectId: string,
    target: DeployTargetEnv,
    secrets: readonly VaultEnvSecret[],
    deleted: readonly string[],
  ): Promise<void>;
}

export interface VercelDeployPort {
  createDeployment(input: {
    readonly projectId: string;
    readonly target: DeployTargetEnv;
    readonly commitSha: string;
    readonly effectId: string;
  }): Promise<{
    readonly deploymentId: string;
    readonly liveUrl: string;
    readonly buildId: string;
    readonly previousDeploymentId: string | null;
  }>;
  reconcileByEffect(effectId: string, commitSha: string): Promise<{
    readonly deploymentId: string;
    readonly liveUrl: string;
    readonly buildId: string;
    readonly state: "ready" | "building" | "error";
  } | null>;
  rollback(projectId: string, deploymentId: string): Promise<{ readonly liveUrl: string }>;
  probeAuth(): Promise<{ readonly ok: boolean; readonly summary: string; readonly user?: string }>;
}