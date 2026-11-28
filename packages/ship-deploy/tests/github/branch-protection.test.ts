import { describe, expect, it } from "vitest";
import { BranchProtectionPolicyReader } from "../../src/github/branch-protection.js";
import { GitHubRateAwareQueue } from "../../src/github/rate-queue.js";
import { MockGitHubApi } from "./mock-github-api.js";

describe("BranchProtectionPolicyReader", () => {
  it("locks protected main to PR mode", async () => {
    const api = new MockGitHubApi();
    api.route("/repos/acme/app/branches/main/protection", {
      status: 200,
      body: {
        required_pull_request_reviews: { required_approving_review_count: 1 },
        required_status_checks: { contexts: ["ci/test", "ci/build"] },
        allow_force_pushes: false,
      },
    });
    api.route("/repos/acme/app/rules/branches/main", { status: 200, body: { rules: [] } });
    const queue = new GitHubRateAwareQueue({ accountKey: "bp1", transport: api });
    const reader = new BranchProtectionPolicyReader({ queue, owner: "acme", repo: "app" });
    const strategy = await reader.chooseShipStrategy({
      defaultBranch: "main",
      multiContributor: false,
    });
    expect(strategy.mode).toBe("pr");
    expect(strategy.reason).toContain("protected");
    expect(strategy.protection.requiredStatusChecks).toEqual(["ci/test", "ci/build"]);
  });

  it("offers direct mode only when explicitly chosen on solo unprotected repos", async () => {
    const api = new MockGitHubApi();
    api.route("/repos/solo/dev/branches/main/protection", { status: 404, body: { message: "not found" } });
    api.route("/repos/solo/dev/rules/branches/main", { status: 404, body: {} });
    const queue = new GitHubRateAwareQueue({ accountKey: "bp2", transport: api });
    const reader = new BranchProtectionPolicyReader({ queue, owner: "solo", repo: "dev" });
    const strategy = await reader.chooseShipStrategy({
      defaultBranch: "main",
      multiContributor: false,
      directModeExplicit: true,
    });
    expect(strategy.mode).toBe("direct");
  });
});