import { describe, expect, it } from "vitest";
import { PrePushGuard } from "../../src/github/pre-push.js";
import { GitHubRateAwareQueue } from "../../src/github/rate-queue.js";
import { MockGitHubApi } from "./mock-github-api.js";

describe("PrePushGuard", () => {
  it("flags public repositories", async () => {
    const api = new MockGitHubApi();
    api.route("/repos/pub/widget", {
      status: 200,
      body: { private: false, visibility: "public" },
    });
    const queue = new GitHubRateAwareQueue({ accountKey: "pp1", transport: api });
    const guard = new PrePushGuard({
      queue,
      minGit: {
        lsRemote: async () => "abc123",
        diffNameOnly: async () => ["src/index.ts"],
      },
      repoPath: "/tmp/r",
      owner: "pub",
      repo: "widget",
      headRef: "refs/heads/harness/f1",
      baseRef: "origin/main",
    });
    const result = await guard.inspect();
    expect(result.publicRepoBadge).toContain("Public repository");
  });

  it("warns when workflow files are in the diff", async () => {
    const api = new MockGitHubApi();
    api.route("/repos/acme/ci", { status: 200, body: { private: true, visibility: "private" } });
    const queue = new GitHubRateAwareQueue({ accountKey: "pp2", transport: api });
    const guard = new PrePushGuard({
      queue,
      minGit: {
        lsRemote: async () => null,
        diffNameOnly: async () => [".github/workflows/ci.yml"],
      },
      repoPath: "/tmp/r",
      owner: "acme",
      repo: "ci",
      headRef: "refs/heads/harness/f2",
      baseRef: "origin/main",
    });
    const result = await guard.inspect();
    expect(result.workflowScopeRequired).toBe(true);
    expect(result.workflowWarning).toContain("workflow");
  });
});