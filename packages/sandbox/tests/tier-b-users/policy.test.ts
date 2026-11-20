import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TierBModeSRequiredError,
  buildDesktopIsolation,
  buildScrubbedEnvironment,
  cacheLayout,
  compileTierBPolicy,
  evaluateTierBAccess,
  explainCreateProcessAsUserFailure,
  injectSingleVendorToken,
  redirectsAreInsideTemp,
  resolveTierBExecutionMode,
} from "../../src/tier-b-users/index.js";
import { SANDBOX_OFFLINE_ACCOUNT } from "../../src/tier-b-users/constants.js";
import { harness, launchSpec, makeTree, removeLater } from "./fixture.js";

describe("Tier B mode, environment, and access policy", () => {
  it("routes Gemini CLI to Mode S and does not change the developer home", async () => {
    const decision = resolveTierBExecutionMode("gemini", "wrapped");
    expect(decision.mode).toBe("stripped");
    expect(decision.reason).toBe("file_login_on_tier_b");
    expect(decision.homeAclMutations).toEqual([]);
    expect(decision.tokenEnv).toBeNull();
    const tree = makeTree();
    try {
      const rig = harness(tree);
      const before = rig.aclPort.commands.length;
      const spec = launchSpec(tree);
      await expect(
        rig.provider.spawnWrappedProcess({ ...spec, vendor: "gemini", command: "gemini", mode: "wrapped" }),
      ).rejects.toBeInstanceOf(TierBModeSRequiredError);
      expect(rig.aclPort.commands).toHaveLength(before);
      expect(rig.provisioner.executionCount).toBe(0);
    } finally {
      removeLater(tree.root);
    }
  });

  it("scrubs personal tokens and injects only the wrapped vendor token", () => {
    const tree = makeTree();
    try {
      const redirects = cacheLayout(tree.temp, 4318);
      expect(redirectsAreInsideTemp(redirects, tree.temp)).toBe(true);
      const scrubbed = buildScrubbedEnvironment(
        {
          PATH: "C:\\Windows\\System32",
          GH_TOKEN: "personal",
          GITHUB_TOKEN: "personal-github",
          OPENAI_API_KEY: "personal-openai",
          ACCESS_TOKEN: "personal-access",
          CURSOR_API_KEY: "personal-cursor",
          ANTHROPIC_API_KEY: "personal-anthropic",
          HOME: tree.profile,
          USERNAME: "developer",
        },
        redirects,
        SANDBOX_OFFLINE_ACCOUNT,
      );
      expect(scrubbed.GH_TOKEN).toBeUndefined();
      expect(scrubbed.GITHUB_TOKEN).toBeUndefined();
      expect(scrubbed.OPENAI_API_KEY).toBeUndefined();
      expect(scrubbed.ACCESS_TOKEN).toBeUndefined();
      expect(scrubbed.HOME).toBe(redirects.home);
      expect(scrubbed.USERPROFILE).toBe(redirects.home);
      expect(scrubbed.USERNAME).toBe(SANDBOX_OFFLINE_ACCOUNT);
      expect(scrubbed.TEMP.startsWith(tree.temp)).toBe(true);
      const cursor = injectSingleVendorToken(scrubbed, "cursor", "cursor-scoped");
      expect(cursor.CURSOR_API_KEY).toBe("cursor-scoped");
      expect(cursor.GH_TOKEN).toBeUndefined();
      expect(cursor.ACCESS_TOKEN).toBeUndefined();
      const copilot = resolveTierBExecutionMode("copilot", "wrapped");
      expect(copilot.mode).toBe("wrapped");
      expect(copilot.tokenEnv).toBe("GITHUB_TOKEN");
      expect(copilot.sdkField).toBe("gitHubToken");
      const injected = injectSingleVendorToken(scrubbed, "copilot", "copilot-scoped");
      expect(injected.GITHUB_TOKEN).toBe("copilot-scoped");
      expect(injected.CURSOR_API_KEY).toBeUndefined();
      expect(() => injectSingleVendorToken(scrubbed, "gemini", "nope")).toThrow(/does not accept an injected token/);
    } finally {
      removeLater(tree.root);
    }
  });

  it("denies secret reads, DPAPI, .git writes, store writes, and other worktrees", () => {
    const tree = makeTree();
    try {
      const spec = launchSpec(tree);
      const policy = compileTierBPolicy(spec, "S-1-5-21-9-9-9");
      expect(evaluateTierBAccess(policy, path.join(tree.profile, ".ssh", "id"), "read").allowed).toBe(false);
      expect(evaluateTierBAccess(policy, "dpapi://developer-credential-manager", "read").ruleId).toBe("deny_read_dpapi");
      expect(evaluateTierBAccess(policy, path.join(tree.slot, ".git", "HEAD"), "write").allowed).toBe(false);
      expect(evaluateTierBAccess(policy, path.join(tree.slot, ".git", "HEAD"), "read").allowed).toBe(true);
      expect(evaluateTierBAccess(policy, path.join(tree.store, "pkg"), "write").errno).toBe("EPERM");
      expect(evaluateTierBAccess(policy, path.join(tree.slot, "node_modules", "leftpad"), "write").errno).toBe("EPERM");
      expect(evaluateTierBAccess(policy, path.join(tree.slot, "src", "main.ts"), "write").allowed).toBe(true);
      expect(evaluateTierBAccess(policy, path.join(tree.otherSlot, "src", "main.ts"), "read").allowed).toBe(false);
      expect(evaluateTierBAccess(policy, path.join(tree.harness, "state.db"), "read").ruleId).toBe("deny_read_harness_data");
      expect(evaluateTierBAccess(policy, path.join(tree.checkout, "README.md"), "read").allowed).toBe(false);
      expect(evaluateTierBAccess(policy, path.join(tree.local, "Google", "Chrome", "Login Data"), "read").allowed).toBe(false);
    } finally {
      removeLater(tree.root);
    }
  });

  it("puts workers on a non-interactive desktop and explains CreateProcessAsUserW failures", () => {
    const desktop = buildDesktopIsolation("win32");
    expect(desktop.interactive).toBe(false);
    expect(desktop.blocksSendInput).toBe(true);
    expect(desktop.lpDesktop).toBe("EFHarnessSandboxWinSta\\EFHarnessSandboxDesktop");
    expect(desktop.lpDesktop).not.toBe("WinSta0\\Default");
    const posix = buildDesktopIsolation("linux");
    expect(posix.supported).toBe(false);
    expect(posix.applied).toBe(false);
    const explained = explainCreateProcessAsUserFailure(5);
    expect(explained.message).toContain("CreateProcessAsUserW");
    expect(explained.edrHint).toContain("CreateProcessAsUserW");
  });
});
