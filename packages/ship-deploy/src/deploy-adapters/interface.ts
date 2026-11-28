import type {
  DeployAuthProbe,
  DeployOutcome,
  DeployPlan,
  DeployTargetEnv,
  EnvDiffPlan,
  ReconcileOutcome,
} from "./types.js";

export interface DeployAdapter {
  readonly id: string;
  probeAuth(): Promise<DeployAuthProbe>;
  planDeploy(targetEnv: DeployTargetEnv, commitSha: string): Promise<DeployPlan>;
  planEnvSync(targetEnv: DeployTargetEnv, projectId: string, envScope: string): Promise<EnvDiffPlan>;
  syncEnv(
    targetEnv: DeployTargetEnv,
    projectId: string,
    envScope: string,
    diffPlan: EnvDiffPlan,
  ): Promise<{ readonly synced: number }>;
  deploy(targetEnv: DeployTargetEnv, commitSha: string, effectId: string): Promise<DeployOutcome>;
  reconcile(effectId: string, commitSha: string): Promise<ReconcileOutcome>;
  rollback(
    targetEnv: DeployTargetEnv,
    targetDeploymentId: string,
    effectId: string,
  ): Promise<{ readonly liveUrl: string }>;
}