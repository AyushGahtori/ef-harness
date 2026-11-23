import { createHash } from "node:crypto";
import type { DeployTargetEnv, SecretNameHash, VaultEnvSecret } from "./types.js";
import type { VercelDeployPort, VercelRemoteEnvPort } from "./contracts.js";

function vercelTarget(target: DeployTargetEnv): string {
  if (target === "production") return "production";
  if (target === "staging") return "preview";
  return "preview";
}

export interface VercelClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly fetchImpl?: typeof fetch;
}

export class VercelHttpClient implements VercelDeployPort, VercelRemoteEnvPort {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: VercelClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.options.token}`, "content-type": "application/json" };
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.options.baseUrl.replace(/\/$/, "")}${path}`;
    return this.fetchImpl(url, { ...init, headers: { ...this.headers(), ...(init?.headers ?? {}) } });
  }

  async probeAuth(): Promise<{ readonly ok: boolean; readonly summary: string; readonly user?: string }> {
    const res = await this.request("/v2/user");
    if (!res.ok) return { ok: false, summary: `Vercel auth failed (${res.status})` };
    const body = (await res.json()) as { user?: { username?: string } };
    return {
      ok: true,
      summary: "Vercel token verified",
      user: body.user?.username ?? "unknown",
    };
  }

  async listNameHashes(projectId: string, target: DeployTargetEnv): Promise<readonly SecretNameHash[]> {
    const res = await this.request(
      `/v9/projects/${projectId}/env?decrypt=false&target=${encodeURIComponent(vercelTarget(target))}`,
    );
    if (!res.ok) throw new Error(`vercel_env_list_${res.status}`);
    const body = (await res.json()) as { envs?: Array<{ key: string; valueDigest?: string }> };
    return (body.envs ?? []).map((item) => ({
      name: item.key,
      hmac: item.valueDigest ?? createHash("sha256").update(item.key).digest("hex"),
    }));
  }

  async applyNameDiff(
    projectId: string,
    target: DeployTargetEnv,
    secrets: readonly VaultEnvSecret[],
    deleted: readonly string[],
  ): Promise<void> {
    const vercelTargetValue = vercelTarget(target);
    for (const secret of secrets) {
      await this.request(`/v10/projects/${projectId}/env`, {
        method: "POST",
        body: JSON.stringify({
          key: secret.name,
          value: secret.value,
          target: [vercelTargetValue],
          type: "encrypted",
        }),
      });
    }
    for (const name of deleted) {
      await this.request(`/v10/projects/${projectId}/env/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
    }
  }

  async createDeployment(input: {
    readonly projectId: string;
    readonly target: DeployTargetEnv;
    readonly commitSha: string;
    readonly effectId: string;
  }): Promise<{
    readonly deploymentId: string;
    readonly liveUrl: string;
    readonly buildId: string;
    readonly previousDeploymentId: string | null;
  }> {
    const res = await this.request("/v13/deployments", {
      method: "POST",
      body: JSON.stringify({
        name: input.projectId,
        target: input.target === "production" ? "production" : "preview",
        meta: {
          githubCommitSha: input.commitSha,
          "EF-Effect-Id": input.effectId,
        },
      }),
    });
    if (!res.ok) throw new Error(`vercel_deploy_${res.status}`);
    const body = (await res.json()) as {
      id: string;
      url: string;
      buildId?: string;
      previousDeploymentId?: string | null;
    };
    return {
      deploymentId: body.id,
      liveUrl: `https://${body.url}`,
      buildId: body.buildId ?? input.commitSha.slice(0, 12),
      previousDeploymentId: body.previousDeploymentId ?? null,
    };
  }

  async reconcileByEffect(
    effectId: string,
    commitSha: string,
  ): Promise<{
    readonly deploymentId: string;
    readonly liveUrl: string;
    readonly buildId: string;
    readonly state: "ready" | "building" | "error";
  } | null> {
    const res = await this.request(
      `/v6/deployments?meta-EF-Effect-Id=${encodeURIComponent(effectId)}&meta-githubCommitSha=${encodeURIComponent(commitSha)}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      deployments?: Array<{ uid: string; url: string; state: string; meta?: { buildId?: string } }>;
    };
    const match = body.deployments?.[0];
    if (!match) return null;
    const state =
      match.state === "READY" ? "ready" : match.state === "ERROR" ? "error" : "building";
    return {
      deploymentId: match.uid,
      liveUrl: `https://${match.url}`,
      buildId: match.meta?.buildId ?? commitSha.slice(0, 12),
      state,
    };
  }

  async rollback(projectId: string, deploymentId: string): Promise<{ readonly liveUrl: string }> {
    const res = await this.request(`/v9/projects/${projectId}/rollback/${deploymentId}`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`vercel_rollback_${res.status}`);
    const body = (await res.json()) as { url?: string };
    return { liveUrl: body.url ? `https://${body.url}` : `https://${projectId}.vercel.app` };
  }
}