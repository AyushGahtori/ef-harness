import { ArgvSecretLeakError, UnhealthySwapAbortedError } from "./errors.js";
import { assertPinnedHost } from "./known-hosts.js";
import type {
  DeployApprovalPort,
  KnownHostsPort,
  SshTransportPort,
  VaultNameHashPort,
} from "./contracts.js";
import type { DeployAdapter } from "./interface.js";
import { NameOnlySyncEnvController } from "./name-only-sync-env.js";
import { assertShellSafeSegment } from "./validation.js";
import type {
  DeployAuthProbe,
  DeployOutcome,
  DeployPlan,
  DeployTargetEnv,
  EnvDiffPlan,
  ReconcileOutcome,
  VaultEnvSecret,
} from "./types.js";

export interface DockerOverSshDeployAdapterOptions {
  readonly projectId: string;
  readonly envScope: string;
  readonly appName: string;
  readonly vault: VaultNameHashPort;
  readonly ssh: SshTransportPort;
  readonly knownHosts: KnownHostsPort;
  readonly approval: DeployApprovalPort;
  readonly syncEnvController?: NameOnlySyncEnvController;
  readonly composeFile?: string;
  readonly remoteEnvDir?: string;
}

interface RemoteState {
  readonly deploymentId: string;
  readonly previousDeploymentId: string | null;
  readonly liveUrl: string;
}

export class DockerOverSshDeployAdapter implements DeployAdapter {
  readonly id = "docker-over-ssh" as const;
  private readonly syncEnvController: NameOnlySyncEnvController;
  private lastDeploy: RemoteState | null = null;

  constructor(private readonly options: DockerOverSshDeployAdapterOptions) {
    this.syncEnvController =
      options.syncEnvController ?? new NameOnlySyncEnvController(options.vault);
  }

  async probeAuth(): Promise<DeployAuthProbe> {
    assertPinnedHost(this.options.knownHosts, this.options.ssh);
    const result = await this.options.ssh.exec({
      command: "docker info --format '{{.ServerVersion}}'",
      strictHostKeyChecking: "yes",
    });
    return {
      ok: result.exitCode === 0,
      summary:
        result.exitCode === 0
          ? `Docker daemon ${result.stdout.trim()} on ${this.options.ssh.host}`
          : "Docker daemon unreachable",
    };
  }

  async planDeploy(targetEnv: DeployTargetEnv, commitSha: string): Promise<DeployPlan> {
    assertShellSafeSegment(this.options.appName, "app");
    assertShellSafeSegment(commitSha, "commitSha");
    const remote = await this.listRemoteNameHashes();
    const envDiff = this.syncEnvController.buildDiff(
      this.options.projectId,
      this.options.envScope,
      remote,
    );
    const approvalLines = this.options.approval.buildApprovalPayload({
      effectType: "deploy",
      targetEnv,
      commitSha,
      canonicalPayloadHash: commitSha,
      envDiff,
    }).lines;
    return {
      targetEnv,
      commitSha,
      targetLabel: `ssh://${this.options.ssh.host}/${this.options.appName}`,
      buildSummary: `Docker image ${this.options.appName}:${commitSha}`,
      envDiff,
      approvalLines,
      swapStrategy: "health-gated-blue-green",
    };
  }

  async planEnvSync(targetEnv: DeployTargetEnv, projectId: string, envScope: string): Promise<EnvDiffPlan> {
    const remote = await this.listRemoteNameHashes();
    return this.syncEnvController.plan(projectId, envScope, remote);
  }

  async syncEnv(
    targetEnv: DeployTargetEnv,
    projectId: string,
    envScope: string,
    diffPlan: EnvDiffPlan,
  ): Promise<{ readonly synced: number }> {
    assertPinnedHost(this.options.knownHosts, this.options.ssh);
    this.syncEnvController.assertNoSecretBytesInLines(diffPlan.approvalLines);
    const secrets = await this.options.vault.listSecretsForDeploy(projectId, envScope);
    const touched = new Set([...diffPlan.diff.added, ...diffPlan.diff.changed]);
    const toApply = secrets.filter((item) => touched.has(item.name));
    await this.syncEnvController.guardSecrets(targetEnv, toApply);
    const envFile = this.envFileBody(toApply);
    const path = `${this.options.remoteEnvDir ?? "/run/ef"}/${projectId}.env`;
    await this.options.ssh.exec({
      command: `install -m 600 /dev/stdin ${path}`,
      stdin: envFile,
      strictHostKeyChecking: "yes",
    });
    await this.persistRemoteDigests(diffPlan);
    return { synced: toApply.length + diffPlan.diff.deleted.length };
  }

  async deploy(targetEnv: DeployTargetEnv, commitSha: string, effectId: string): Promise<DeployOutcome> {
    assertPinnedHost(this.options.knownHosts, this.options.ssh);
    assertShellSafeSegment(commitSha, "commitSha");
    assertShellSafeSegment(effectId, "effectId");
    const image = `${this.options.appName}:${commitSha}`;
    const previous = this.lastDeploy?.deploymentId ?? null;
    const container = `${this.options.appName}-${commitSha.slice(0, 12)}`;
    const envPath = `${this.options.remoteEnvDir ?? "/run/ef"}/${this.options.projectId}.env`;
    if (this.options.composeFile) {
      assertShellSafeSegment(this.options.composeFile, "composeFile");
      const compose = await this.options.ssh.exec({
        command: `docker compose -f ${this.options.composeFile} up -d --wait`,
        strictHostKeyChecking: "yes",
      });
      if (compose.exitCode !== 0) {
        throw new UnhealthySwapAbortedError(compose.stderr || "compose unhealthy");
      }
    } else {
      const runCommand = `docker run -d --name ${container} --env-file ${envPath} --label EF-Effect-Id=${effectId} ${image}`;
      if (/\s-e\s+\w+=/.test(runCommand)) throw new ArgvSecretLeakError();
      const started = await this.options.ssh.exec({
        command: runCommand,
        strictHostKeyChecking: "yes",
      });
      if (started.exitCode !== 0) {
        throw new UnhealthySwapAbortedError(started.stderr || "container start failed");
      }
      const health = await this.options.ssh.exec({
        command: `docker inspect --format='{{.State.Health.Status}}' ${container}`,
        strictHostKeyChecking: "yes",
      });
      if (health.stdout.trim() !== "healthy") {
        throw new UnhealthySwapAbortedError(health.stdout.trim() || "unhealthy");
      }
      if (previous) {
        await this.options.ssh.exec({
          command: `docker rm -f ${previous}`,
          strictHostKeyChecking: "yes",
        });
      }
    }
    const liveUrl = `https://${this.options.ssh.host}/${this.options.appName}`;
    const outcome: DeployOutcome = {
      deploymentId: container,
      liveUrl,
      buildId: commitSha.slice(0, 12),
      previousDeploymentId: previous,
    };
    this.lastDeploy = {
      deploymentId: container,
      previousDeploymentId: previous,
      liveUrl,
    };
    return outcome;
  }

  async reconcile(effectId: string, commitSha: string): Promise<ReconcileOutcome> {
    const result = await this.options.ssh.exec({
      command: `docker ps --filter label=EF-Effect-Id=${effectId} --format '{{.Names}}'`,
      strictHostKeyChecking: "yes",
    });
    const name = result.stdout.trim();
    if (!name) return { state: "not_found" };
    return {
      state: "succeeded",
      deploymentId: name,
      liveUrl: `https://${this.options.ssh.host}/${this.options.appName}`,
      buildId: commitSha.slice(0, 12),
    };
  }

  async rollback(
    _targetEnv: DeployTargetEnv,
    targetDeploymentId: string,
    effectId: string,
  ): Promise<{ readonly liveUrl: string }> {
    void effectId;
    assertShellSafeSegment(targetDeploymentId, "deploymentId");
    const previousImage = `${this.options.appName}:${targetDeploymentId}`;
    const runCommand = `docker run -d --name rollback-${targetDeploymentId} ${previousImage}`;
    await this.options.ssh.exec({ command: runCommand, strictHostKeyChecking: "yes" });
    const liveUrl = `https://${this.options.ssh.host}/${this.options.appName}`;
    this.lastDeploy = {
      deploymentId: `rollback-${targetDeploymentId}`,
      previousDeploymentId: this.lastDeploy?.deploymentId ?? null,
      liveUrl,
    };
    return { liveUrl };
  }

  private envFileBody(secrets: readonly VaultEnvSecret[]): string {
    return secrets.map((item) => `${item.name}=${item.value}`).join("\n");
  }

  private async listRemoteNameHashes() {
    const path = `${this.options.remoteEnvDir ?? "/run/ef"}/${this.options.projectId}.digests.json`;
    const result = await this.options.ssh.exec({
      command: `cat ${path}`,
      strictHostKeyChecking: "yes",
    });
    if (result.exitCode !== 0 || !result.stdout.trim()) return [];
    const parsed = JSON.parse(result.stdout) as Array<{ name: string; hmac: string }>;
    return parsed;
  }

  private async persistRemoteDigests(diffPlan: EnvDiffPlan): Promise<void> {
    const remote = await this.listRemoteNameHashes();
    const local = this.options.vault.listSecretNamesAndHashes(
      this.options.projectId,
      this.options.envScope,
    );
    const next = new Map(remote.map((item) => [item.name, item]));
    for (const name of diffPlan.diff.deleted) next.delete(name);
    for (const item of local) next.set(item.name, item);
    const path = `${this.options.remoteEnvDir ?? "/run/ef"}/${this.options.projectId}.digests.json`;
    await this.options.ssh.exec({
      command: `install -m 600 /dev/stdin ${path}`,
      stdin: JSON.stringify([...next.values()]),
      strictHostKeyChecking: "yes",
    });
  }
}