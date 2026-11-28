import { describe, expect, it } from "vitest";
import { registerGitHubEffectReconcilers } from "../../src/github/reconcilers.js";
import { GitHubRateAwareQueue } from "../../src/github/rate-queue.js";
import { MockGitHubApi } from "./mock-github-api.js";
import type { GitHubEffectReconciler, GitHubEffectReconcilerInput } from "../../src/github/types.js";

class Registrar {
  readonly handlers = new Map<string, GitHubEffectReconciler>();
  register(effectType: string, fn: GitHubEffectReconciler): void {
    this.handlers.set(effectType, fn);
  }
}

describe("registerGitHubEffectReconcilers", () => {
  it("finds an existing PR instead of creating a duplicate", async () => {
    const api = new MockGitHubApi();
    api.route("/repos/o/r/pulls", {
      status: 200,
      body: [
        {
          number: 42,
          body: "Summary\n\nEF-Effect-Id: eff-99",
        },
      ],
    });
    const queue = new GitHubRateAwareQueue({ accountKey: "rc1", transport: api });
    const registrar = new Registrar();
    registerGitHubEffectReconcilers({
      registrar,
      queue,
      minGit: { lsRemote: async () => null, diffNameOnly: async () => [] },
      owner: "o",
      repo: "r",
    });
    const reconcile = registrar.handlers.get("create_pr");
    expect(reconcile).toBeDefined();
    const input: GitHubEffectReconcilerInput = {
      effectType: "create_pr",
      idempotencyKey: "k1",
      payload: { headBranch: "harness/f1", effectId: "eff-99" },
    };
    const outcome = await reconcile!(input);
    expect(outcome).toEqual({ kind: "succeeded", receipt: { prNumber: 42 } });
  });

  it("reconciles git_push via ls-remote sha", async () => {
    const api = new MockGitHubApi();
    const queue = new GitHubRateAwareQueue({ accountKey: "rc2", transport: api });
    const registrar = new Registrar();
    registerGitHubEffectReconcilers({
      registrar,
      queue,
      minGit: { lsRemote: async () => "deadbeef", diffNameOnly: async () => [] },
      owner: "o",
      repo: "r",
    });
    const outcome = await registrar.handlers.get("git_push")!({
      effectType: "git_push",
      idempotencyKey: "k2",
      payload: { repoPath: "/r", ref: "refs/heads/harness/f1", expectedSha: "dead" },
    });
    expect(outcome.kind).toBe("succeeded");
  });
});