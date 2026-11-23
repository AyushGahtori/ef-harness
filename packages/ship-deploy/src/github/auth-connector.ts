import { parseGitHubRemote } from "./parse-remote.js";
import { GitHubDeviceOAuthFlow, type GitHubDeviceOAuthOptions } from "./device-oauth.js";
import type { CliAuthSnapshot, GitHubUserIdentity, VaultSecretWriter } from "./types.js";

export interface GhCliProbe {
  authStatus(hostname?: string): Promise<CliAuthSnapshot>;
}

export interface GitHubAuthConnectorOptions {
  readonly projectId: string;
  readonly vault: VaultSecretWriter;
  readonly cli: GhCliProbe;
  readonly deviceFlow?: GitHubDeviceOAuthOptions;
}

export interface CliReuseOffer {
  readonly login: string;
  readonly label: string;
}

export interface StoredGitHubSession {
  readonly secretId: string;
  readonly login: string;
  readonly scopes: readonly string[];
  readonly hostname: string | null;
}

export class GitHubAuthConnector {
  private readonly deviceFlow: GitHubDeviceOAuthFlow | null;
  private pendingCli: CliAuthSnapshot | null = null;

  constructor(private readonly options: GitHubAuthConnectorOptions) {
    this.deviceFlow = options.deviceFlow ? new GitHubDeviceOAuthFlow(options.deviceFlow) : null;
  }

  async probeCliReuse(hostname?: string): Promise<readonly CliReuseOffer[]> {
    const snapshot = await this.options.cli.authStatus(hostname);
    if (!snapshot.authenticated || !snapshot.login || !snapshot.token) return [];
    this.pendingCli = snapshot;
    return [
      {
        login: snapshot.login,
        label: `Use your signed-in GitHub account (@${snapshot.login})`,
      },
    ];
  }

  async acceptCliReuse(login: string, hostname?: string): Promise<StoredGitHubSession> {
    const snap = this.pendingCli;
    if (!snap?.token || snap.login !== login) {
      throw new Error("No signed-in GitHub CLI session is waiting for reuse");
    }
    const stored = await this.options.vault.putGitHubToken({
      projectId: this.options.projectId,
      login,
      token: snap.token,
      scopes: snap.scopes,
    });
    this.pendingCli = null;
    return {
      secretId: stored.secretId,
      login,
      scopes: snap.scopes,
      hostname: hostname ?? snap.hostname,
    };
  }

  async deviceAuthorize(workflowEdits = false): Promise<StoredGitHubSession> {
    if (!this.deviceFlow) throw new Error("GitHub device OAuth is not configured");
    const extra = workflowEdits ? (["workflow"] as const) : ([] as const);
    const auth = await this.deviceFlow.authorize(extra);
    const login = await resolveLogin(auth.accessToken);
    const stored = await this.options.vault.putGitHubToken({
      projectId: this.options.projectId,
      login,
      token: auth.accessToken,
      scopes: auth.scopes,
    });
    return { secretId: stored.secretId, login, scopes: auth.scopes, hostname: "github.com" };
  }

  parseRemote(remoteUrl: string) {
    return parseGitHubRemote(remoteUrl);
  }

  scopesCoverWorkflow(scopes: readonly string[]): boolean {
    return scopes.includes("workflow") || scopes.includes("admin:repo_hook");
  }
}

async function resolveLogin(token: string): Promise<string> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) throw new Error("Failed to resolve GitHub login after device authorization");
  const body = (await response.json()) as { login?: string };
  if (!body.login) throw new Error("GitHub user response missing login");
  return body.login;
}

export function identityFromLogin(login: string): GitHubUserIdentity {
  let hash = 0;
  for (let i = 0; i < login.length; i += 1) hash = (hash * 31 + login.charCodeAt(i)) >>> 0;
  return { userId: hash, login };
}