import { describe, expect, it } from "vitest";
import { evaluatePushPolicy } from "../../src/github/push-policy.js";

describe("evaluatePushPolicy", () => {
  it("blocks force push on main", () => {
    const verdict = evaluatePushPolicy({
      targetBranch: "main",
      force: true,
      forceWithLease: false,
      harnessOwnedPrBranch: false,
      userApprovedForceWithLease: false,
      branchProtected: true,
    });
    expect(verdict.allowed).toBe(false);
  });

  it("allows force-with-lease only when explicitly approved on harness branch", () => {
    const denied = evaluatePushPolicy({
      targetBranch: "harness/f-12",
      force: false,
      forceWithLease: true,
      harnessOwnedPrBranch: true,
      userApprovedForceWithLease: false,
      branchProtected: false,
    });
    expect(denied.allowed).toBe(false);
    const allowed = evaluatePushPolicy({
      targetBranch: "harness/f-12",
      force: false,
      forceWithLease: true,
      harnessOwnedPrBranch: true,
      userApprovedForceWithLease: true,
      branchProtected: false,
    });
    expect(allowed.allowed).toBe(true);
  });
});