import type {
  EffectReconcilerRegistrar,
  GitHubEffectReconciler,
  GitHubEffectReconcilerInput,
  GitHubReconcileOutcome,
  MinGitRepoInspectorPort,
} from "./types.js";
import type { GitHubRateAwareQueue } from "./rate-queue.js";

export interface GitHubReconcilerDeps {
  readonly registrar: EffectReconcilerRegistrar;
  readonly queue: GitHubRateAwareQueue;
  readonly minGit: MinGitRepoInspectorPort;
  readonly owner: string;
  readonly repo: string;
}

export interface GitPushPayload {
  readonly repoPath: string;
  readonly ref: string;
  readonly expectedSha: string;
}

export interface CreatePrPayload {
  readonly headBranch: string;
  readonly effectId: string;
  readonly baseBranch?: string;
}

export interface UpdatePrPayload {
  readonly prNumber: number;
  readonly effectId: string;
}

export function registerGitHubEffectReconcilers(deps: GitHubReconcilerDeps): void {
  deps.registrar.register("git_push", gitPushReconciler(deps));
  deps.registrar.register("create_pr", createPrReconciler(deps));
  deps.registrar.register("update_pr", updatePrReconciler(deps));
}

function gitPushReconciler(deps: GitHubReconcilerDeps): GitHubEffectReconciler {
  return async (input: GitHubEffectReconcilerInput): Promise<GitHubReconcileOutcome> => {
    const payload = input.payload as GitPushPayload;
    const remoteSha = await deps.minGit.lsRemote(payload.repoPath, payload.ref);
    if (remoteSha && remoteSha.startsWith(payload.expectedSha)) {
      return { kind: "succeeded", receipt: { ref: payload.ref, sha: remoteSha } };
    }
    if (remoteSha) {
      return { kind: "ambiguous", reason: "Remote ref exists but SHA does not match expected push result" };
    }
    return { kind: "safe_to_retry" };
  };
}

function createPrReconciler(deps: GitHubReconcilerDeps): GitHubEffectReconciler {
  return async (input: GitHubEffectReconcilerInput): Promise<GitHubReconcileOutcome> => {
    const payload = input.payload as CreatePrPayload;
    const response = await deps.queue.request({
      method: "GET",
      path: `/repos/${deps.owner}/${deps.repo}/pulls?state=open&head=${deps.owner}:${encodeURIComponent(payload.headBranch)}`,
    });
    if (response.status >= 400) return { kind: "safe_to_retry" };
    const pulls = JSON.parse(response.body) as { body?: string; number?: number }[];
    const match = pulls.find((pr) => pr.body?.includes(`EF-Effect-Id: ${payload.effectId}`));
    if (match?.number) {
      return { kind: "succeeded", receipt: { prNumber: match.number } };
    }
    return { kind: "safe_to_retry" };
  };
}

function updatePrReconciler(deps: GitHubReconcilerDeps): GitHubEffectReconciler {
  return async (input: GitHubEffectReconcilerInput): Promise<GitHubReconcileOutcome> => {
    const payload = input.payload as UpdatePrPayload;
    const response = await deps.queue.request({
      method: "GET",
      path: `/repos/${deps.owner}/${deps.repo}/pulls/${payload.prNumber}`,
    });
    if (response.status === 404) return { kind: "safe_to_retry" };
    if (response.status >= 400) return { kind: "ambiguous", reason: `Unexpected PR lookup status ${response.status}` };
    const body = JSON.parse(response.body) as { body?: string };
    if (body.body?.includes(`EF-Effect-Id: ${payload.effectId}`)) {
      return { kind: "succeeded", receipt: { prNumber: payload.prNumber } };
    }
    return { kind: "safe_to_retry" };
  };
}