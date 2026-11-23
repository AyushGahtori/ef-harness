import type { GitHubRepoVisibility, MinGitRepoInspectorPort, PrePushGuardResult } from "./types.js";
import type { GitHubRateAwareQueue } from "./rate-queue.js";

const WORKFLOW_PATH_PREFIX = ".github/workflows/";

export interface PrePushGuardOptions {
  readonly queue: GitHubRateAwareQueue;
  readonly minGit: MinGitRepoInspectorPort;
  readonly repoPath: string;
  readonly owner: string;
  readonly repo: string;
  readonly headRef: string;
  readonly baseRef: string;
}

export class PrePushGuard {
  constructor(private readonly options: PrePushGuardOptions) {}

  async inspect(): Promise<PrePushGuardResult> {
    const visibility = await this.fetchVisibility();
    const remoteSha = await this.options.minGit.lsRemote(this.options.repoPath, this.options.headRef);
    const changed = await this.options.minGit.diffNameOnly(
      this.options.repoPath,
      `${this.options.baseRef}..HEAD`,
    );
    const workflowTouched = changed.some((path) => path.startsWith(WORKFLOW_PATH_PREFIX));
    const publicRepoBadge =
      visibility.visibility === "public"
        ? `Public repository (${visibility.owner}/${visibility.repo})`
        : null;
    return {
      visibility,
      publicRepoBadge,
      workflowScopeRequired: workflowTouched,
      workflowWarning: workflowTouched
        ? "Push touches .github/workflows/ — requires GitHub 'workflow' scope"
        : null,
      remoteRefOk: remoteSha !== null,
      remoteSha,
    };
  }

  private async fetchVisibility(): Promise<GitHubRepoVisibility> {
    const response = await this.options.queue.request({
      method: "GET",
      path: `/repos/${this.options.owner}/${this.options.repo}`,
    });
    if (response.status >= 400) {
      return {
        owner: this.options.owner,
        repo: this.options.repo,
        private: true,
        visibility: "private",
      };
    }
    const body = JSON.parse(response.body) as {
      private?: boolean;
      visibility?: string;
    };
    const visibility =
      body.visibility === "internal" ? "internal" : body.private ? "private" : "public";
    return {
      owner: this.options.owner,
      repo: this.options.repo,
      private: Boolean(body.private),
      visibility,
    };
  }
}