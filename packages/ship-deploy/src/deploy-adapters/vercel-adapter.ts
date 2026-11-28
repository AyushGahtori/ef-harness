import type { DeployApprovalPort, VaultNameHashPort, VercelDeployPort, VercelRemoteEnvPort } from "./contracts.js";
import { deployCanonicalPayloadHash } from "./payload-hash.js";
import type { DeployAdapter } from "./interface.js";
import { NameOnlySyncEnvController } from "./name-only-sync-env.js";
import type {
  DeployAuthProbe,
  DeployOutcome,
  DeployPlan,
  DeployTargetEnv,
  EnvDiffPlan,
  ReconcileOutcome,
} from "./types.js";

export interface VercelDeployAdapterOptions {
  readonly projectId: string;
  readonly envScope: string;
  readonly vault: VaultNameHashPort;
  readonly client: VercelDeployPort & VercelRemoteEnvPort;
  readonly approval: DeployApprovalPort;
  readonly syncEnvController?: NameOnlySyncEnvController;
}

export class VercelDeployAdapter implements DeployAdapter {
  readonly id = "vercel" as const;
  private readonly syncEnvController: NameOnlySyncEnvController;

  constructor(private readonly options: VercelDeployAdapterOptions) {
    this.syncEnvController =
      options.syncEnvController ?? new NameOnlySyncEnvController(options.vault);
  }

  async probeAuth(): Promise<DeployAuthProbe> {
    const probe = await this.options.client.probeAuth();
    return probe.user
      ? { ok: probe.ok, summary: probe.summary, accountLabel: probe.user }
      : { ok: probe.ok, summary: probe.summary };
  }

  async planDeploy(targetEnv: DeployTargetEnv, commitSha: string): Promise<DeployPlan> {
    const remote = await this.options.client.listNameHashes(this.options.projectId, targetEnv);
    const envDiff = this.syncEnvController.buildDiff(
      this.options.projectId,
      this.options.envScope,
      remote,
    );
    const approvalLines = this.options.approval.buildApprovalPayload({
      effectType: "deploy",
      targetEnv,
      commitSha,
      canonicalPayloadHash: deployCanonicalPayloadHash({ targetEnv, commitSha, envDiff }),
      envDiff,
    }).lines;
    return {
      targetEnv,
      commitSha,
      targetLabel: `vercel:${this.options.projectId}`,
      buildSummary: `Vercel deployment for ${commitSha.slice(0, 7)}`,
      envDiff,
      approvalLines,
      swapStrategy: targetEnv === "production" ? "instant-rollback" : "preview-url",
    };
  }

  async planEnvSync(targetEnv: DeployTargetEnv, projectId: string, envScope: string): Promise<EnvDiffPlan> {
    const remote = await this.options.client.listNameHashes(projectId, targetEnv);
    return this.syncEnvController.plan(projectId, envScope, remote);
  }

  async syncEnv(
    targetEnv: DeployTargetEnv,
    projectId: string,
    envScope: string,
    diffPlan: EnvDiffPlan,
  ): Promise<{ readonly synced: number }> {
    this.syncEnvController.assertNoSecretBytesInLines(diffPlan.approvalLines);
    const secrets = await this.options.vault.listSecretsForDeploy(projectId, envScope);
    const touched = new Set([...diffPlan.diff.added, ...diffPlan.diff.changed]);
    const toApply = secrets.filter((item) => touched.has(item.name));
    await this.syncEnvController.guardSecrets(targetEnv, toApply);
    await this.options.client.applyNameDiff(
      projectId,
      targetEnv,
      toApply,
      diffPlan.diff.deleted,
    );
    return { synced: toApply.length + diffPlan.diff.deleted.length };
  }

  async deploy(targetEnv: DeployTargetEnv, commitSha: string, effectId: string): Promise<DeployOutcome> {
    const outcome = await this.options.client.createDeployment({
      projectId: this.options.projectId,
      target: targetEnv,
      commitSha,
      effectId,
    });
    return outcome;
  }

  async reconcile(effectId: string, commitSha: string): Promise<ReconcileOutcome> {
    const found = await this.options.client.reconcileByEffect(effectId, commitSha);
    if (!found) return { state: "not_found" };
    if (found.state === "ready") {
      return {
        state: "succeeded",
        deploymentId: found.deploymentId,
        liveUrl: found.liveUrl,
        buildId: found.buildId,
      };
    }
    return { state: "in_progress", deploymentId: found.deploymentId, liveUrl: found.liveUrl };
  }

  async rollback(
    _targetEnv: DeployTargetEnv,
    targetDeploymentId: string,
    effectId: string,
  ): Promise<{ readonly liveUrl: string }> {
    void effectId;
    return this.options.client.rollback(this.options.projectId, targetDeploymentId);
  }
}