import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHelperPayload,
  compileMxcPolicy,
  evaluateAccess,
  evaluateNetwork,
  expandDenyReadFiles,
  freezeDenyReadAtStart,
  isInsideFrozenSnapshot,
  MxcPolicyPathError,
  sealPolicyAtStart,
  TIER_A_CAPABILITIES,
} from "../../src/tier-a-mxc/index.js";
import { policySpec } from "./fixture.js";

describe("compileMxcPolicy", () => {
  it("covers writable, read-only, deny-read, and deny-write rules", () => {
    const policy = compileMxcPolicy(policySpec());
    const ids = policy.rules.map((rule) => rule.id);
    for (const id of [
      "writable_worktree",
      "writable_temp",
      "writable_build_output",
      "read_only_node_modules",
      "read_only_pnpm_store",
      "read_only_git",
      "deny_write_git",
      "deny_read_ssh",
      "deny_read_aws",
      "deny_read_azure",
      "deny_read_gnupg",
      "deny_read_npmrc",
      "deny_read_chrome",
      "deny_read_edge",
      "deny_read_brave",
      "deny_read_firefox",
      "deny_read_appdata_credentials",
      "deny_read_appdata_protect",
      "deny_read_vault",
      "deny_read_local_credentials",
      "deny_read_harness_data",
      "deny_read_developer_checkout",
      "deny_read_other_worktree_0",
      "read_only_toolchain_0",
    ]) {
      expect(ids).toContain(id);
    }
    expect(policy.policyBasedGrants).toBe(true);
    expect(policy.launch.failOpen).toBe(false);
    expect(policy.launch.aclMutation).toBe(false);
    expect(policy.launch.grantModel).toBe("policy");
    expect(policy.launch.specIdentifier).toBe("SBOX");
    expect(policy.launch.callsExportDirectly).toBe(false);
    expect(policy.nuances.denyReadGlobsEvaluatedAtProcessStart).toBe(true);
    expect(policy.nuances.foregroundExitStopsChildren).toBe(true);
    expect(policy.nuances.detachedServersOwner).toBe("task_049_environment_orchestrator");
    expect(policy.nuances.allowLocalBinding).toBe(true);
    expect(policy.network.proxyProfile).toBe("coding_worker");
    expect(policy.network.providerHosts).toEqual([]);
    expect(policy.network.allowLoopbackPorts).toEqual([47001, 47002]);
    expect(TIER_A_CAPABILITIES).toEqual({
      fileWritesEnforced: true,
      secretReadsDenied: true,
      networkEnforced: true,
      requiresAdmin: false,
    });
  });

  it("allows attempt writes and denies node_modules, git, secrets, harness data, and other trees", () => {
    const policy = compileMxcPolicy(policySpec());
    expect(evaluateAccess(policy, "C:\\wt\\slot-1\\src\\app.ts", "write").allowed).toBe(true);
    expect(evaluateAccess(policy, "C:\\wt\\slot-1-temp\\cache.dat", "write").allowed).toBe(true);
    expect(evaluateAccess(policy, "C:\\wt\\slot-1-build\\out.js", "write").allowed).toBe(true);
    const storeWrite = evaluateAccess(policy, "C:\\wt\\slot-1\\node_modules\\pkg\\index.js", "write");
    expect(storeWrite.allowed).toBe(false);
    expect(storeWrite.errno).toBe("EPERM");
    expect(storeWrite.ruleId).toBe("read_only_node_modules");
    expect(evaluateAccess(policy, "C:\\pnpm-store\\pkg\\index.js", "write").errno).toBe("EPERM");
    expect(evaluateAccess(policy, "C:\\toolchain\\node\\node.exe", "read").allowed).toBe(true);
    expect(evaluateAccess(policy, "C:\\toolchain\\node\\node.exe", "write").errno).toBe("EPERM");
    for (const rel of [".git\\config", ".git\\HEAD", ".git\\hooks\\pre-commit"]) {
      const decision = evaluateAccess(policy, `C:\\wt\\slot-1\\${rel}`, "write");
      expect(decision.allowed).toBe(false);
      expect(decision.errno).toBe("EPERM");
      expect(decision.ruleId).toBe("deny_write_git");
    }
    expect(evaluateAccess(policy, "C:\\wt\\slot-1\\.git\\objects\\ab\\cd", "read").allowed).toBe(true);
    expect(evaluateAccess(policy, "C:\\Users\\dev\\.ssh\\id_ed25519", "read")).toMatchObject({
      allowed: false,
      errno: "EACCES",
      ruleId: "deny_read_ssh",
    });
    expect(evaluateAccess(policy, "C:\\Users\\dev\\.aws\\credentials", "read").allowed).toBe(false);
    expect(evaluateAccess(policy, "C:\\Users\\dev\\.azure\\config", "read").allowed).toBe(false);
    expect(evaluateAccess(policy, "C:\\Users\\dev\\.gnupg\\pubring.kbx", "read").allowed).toBe(false);
    expect(evaluateAccess(policy, "C:\\Users\\dev\\.npmrc", "read").allowed).toBe(false);
    expect(evaluateAccess(policy, "C:\\Users\\dev\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cookies", "read").allowed).toBe(false);
    expect(evaluateAccess(policy, "C:\\Users\\dev\\AppData\\Roaming\\Microsoft\\Credentials\\secret", "read").allowed).toBe(false);
    expect(evaluateAccess(policy, "C:\\Users\\dev\\AppData\\Local\\EFHarness\\state.db", "read")).toMatchObject({
      allowed: false,
      ruleId: "deny_read_harness_data",
    });
    expect(evaluateAccess(policy, "C:\\Users\\dev\\AppData\\Local\\EFHarness\\global.db", "read").allowed).toBe(false);
    expect(evaluateAccess(policy, "C:\\src\\checkout\\src\\app.ts", "read").allowed).toBe(false);
    expect(evaluateAccess(policy, "C:\\wt\\slot-2\\src\\app.ts", "read").allowed).toBe(false);
    expect(evaluateAccess(policy, "C:\\outside\\file.txt", "write").ruleId).toBe("default_deny");
  });

  it("keeps a linked gitdir and its common dir read-only", () => {
    const policy = compileMxcPolicy(
      policySpec({
        gitDirLink: "D:\\main-repo\\.git\\worktrees\\slot",
        gitCommonDir: "D:\\main-repo\\.git",
      }),
    );
    expect(evaluateAccess(policy, "D:\\main-repo\\.git\\config", "write")).toMatchObject({
      allowed: false,
      errno: "EPERM",
    });
    expect(evaluateAccess(policy, "D:\\main-repo\\.git\\objects\\aa\\bb", "read").allowed).toBe(true);
    expect(evaluateAccess(policy, "D:\\main-repo\\.git\\worktrees\\slot\\HEAD", "write").allowed).toBe(false);
  });

  it("canonicalizes spaces and unicode and rejects traversal, the checkout, and harness projects", () => {
    const spaced = compileMxcPolicy(
      policySpec({
        worktree: "C:\\wt\\my project\\尝试",
        tempDir: "C:\\wt\\my project temp",
        buildOutputDir: "C:\\wt\\my project build",
      }),
    );
    expect(spaced.writable.some((entry) => entry.includes("my project") && entry.includes("尝试"))).toBe(true);
    expect(() => compileMxcPolicy(policySpec({ worktree: "C:\\wt\\slot-1\\..\\escape" }))).toThrow(MxcPolicyPathError);
    expect(() => compileMxcPolicy(policySpec({ tempDir: "C:\\wt\\..\\temp" }))).toThrow(/path_traversal/);
    expect(() => compileMxcPolicy(policySpec({ worktree: "relative\\slot" }))).toThrow(/path_not_absolute/);
    expect(() => compileMxcPolicy(policySpec({ worktree: "C:\\src\\checkout" }))).toThrow(/developer_checkout/);
    expect(() =>
      compileMxcPolicy(
        policySpec({ worktree: "C:\\Users\\dev\\AppData\\Local\\EFHarness\\projects\\app" }),
      ),
    ).toThrow(/harness_projects/);
    expect(() => compileMxcPolicy(policySpec({ worktree: "C:\\Users\\dev\\.ssh\\attempt" }))).toThrow(/deny_read_overlap/);
  });

  it("adds the Gemini login folder only for wrapped Gemini and keeps provider hosts on the proxy", () => {
    const plain = compileMxcPolicy(policySpec());
    expect(plain.readOnly.some((entry) => entry.endsWith(`${path.sep}.gemini`))).toBe(false);
    const wrapped = compileMxcPolicy(policySpec({ mode: "wrapped", vendor: "gemini" }));
    expect(wrapped.readOnly.some((entry) => entry.endsWith(`${path.sep}.gemini`))).toBe(true);
    expect(evaluateAccess(wrapped, "C:\\Users\\dev\\.gemini\\oauth_creds.json", "read").allowed).toBe(true);
    expect(evaluateAccess(wrapped, "C:\\Users\\dev\\.gemini\\oauth_creds.json", "write").errno).toBe("EPERM");
    expect(wrapped.network.providerHosts).toEqual(["generativelanguage.googleapis.com"]);
    expect(wrapped.network.proxyProfile).toBe("wrapped_vendor");
    const codex = compileMxcPolicy(policySpec({ mode: "wrapped", vendor: "codex" }));
    expect(codex.network.providerHosts).toEqual(["api.openai.com", "chatgpt.com"]);
    expect(evaluateNetwork(codex, "api.openai.com", 443).ruleId).toBe("provider_direct_tcp_denied");
    expect(evaluateNetwork(codex, "1.1.1.1", 443).ruleId).toBe("raw_external_tcp");
    expect(evaluateNetwork(plain, "127.0.0.1", 47001).allowed).toBe(true);
    expect(evaluateNetwork(plain, "127.0.0.1", 47002).allowed).toBe(true);
    expect(evaluateNetwork(plain, "::1", 47001).allowed).toBe(true);
    expect(evaluateNetwork(plain, "127.0.0.1", 5432).ruleId).toBe("loopback_port_not_allowlisted");
    expect(evaluateNetwork(plain, "1.1.1.1", 443).allowed).toBe(false);
  });

  it("freezes deny-read files at process start and seals the launched policy", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-mxc-deny-"));
    const ssh = path.join(root, ".ssh");
    fs.mkdirSync(ssh);
    const canary = path.join(ssh, "canary");
    fs.writeFileSync(canary, "canary");
    const frozen = expandDenyReadFiles([ssh]);
    expect(frozen.evaluatedAt).toBe("process_start");
    expect(isInsideFrozenSnapshot(frozen, canary)).toBe(true);
    const later = path.join(ssh, "later");
    fs.writeFileSync(later, "later");
    expect(isInsideFrozenSnapshot(frozen, later)).toBe(false);
    expect(frozen.postStartCreatesAreOutsideSnapshot).toBe(true);
    const policy = compileMxcPolicy(policySpec(), "t0");
    const sealed = sealPolicyAtStart(policy, "t1");
    expect(sealed.frozenAt).toBe("t1");
    expect(policy.frozenAt).toBe("t0");
    expect(() => {
      (policy.denyRead as string[]).push("C:\\extra");
    }).toThrow(TypeError);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("freezes small secret files into the helper payload and leaves browser profiles as prefixes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-mxc-freeze-"));
    const profile = path.join(root, "profile");
    const ssh = path.join(profile, ".ssh");
    const chrome = path.join(root, "local", "Google", "Chrome", "User Data");
    const spec = policySpec({
      worktree: path.join(root, "work"),
      tempDir: path.join(root, "temp"),
      buildOutputDir: path.join(root, "build"),
      developerCheckout: path.join(root, "checkout"),
      harnessDataRoot: path.join(root, "harness"),
      userProfile: profile,
      localAppData: path.join(root, "local"),
      appData: path.join(root, "roaming"),
      toolchainRoots: [path.join(root, "toolchain")],
      pnpmStore: path.join(root, "store"),
      otherWorktrees: [path.join(root, "other")],
    });
    for (const dir of [
      spec.worktree,
      spec.tempDir,
      spec.buildOutputDir,
      spec.developerCheckout,
      path.join(spec.harnessDataRoot, "projects"),
      spec.appData,
      spec.pnpmStore,
      spec.toolchainRoots[0] ?? spec.worktree,
      spec.otherWorktrees[0] ?? spec.worktree,
      ssh,
      chrome,
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const canary = path.join(ssh, "canary");
    fs.writeFileSync(canary, "canary");
    fs.writeFileSync(path.join(chrome, "Cookies"), "nope");
    const policy = compileMxcPolicy(spec);
    const payload = buildHelperPayload({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/c", "exit", "0"],
      cwd: spec.worktree,
      env: { PATH: "C:\\Windows" },
      policy,
      tempDir: spec.tempDir,
      attemptId: spec.attemptId,
      mode: "per_command",
      stdinPayload: "",
    });
    expect(payload.requireNativeDenyPaths).toBe(true);
    expect(payload.allowLocalBinding).toBe(true);
    expect(payload.callsExportDirectly).toBe(false);
    expect(payload.failOpen).toBe(false);
    expect(payload.foregroundExitStopsChildren).toBe(true);
    expect(payload.detachedServersOwner).toBe("task_049_environment_orchestrator");
    expect(payload.denyReadEvaluatedAt).toBe("process_start");
    expect(payload.denyReadFiles.some((entry) => entry.endsWith(`${path.sep}canary`))).toBe(true);
    expect(payload.denyReadFiles.some((entry) => entry.includes("Cookies"))).toBe(false);
    expect(payload.denyReadPrefixes.some((entry) => entry.includes("Chrome"))).toBe(true);
    const later = path.join(ssh, "later");
    fs.writeFileSync(later, "later");
    expect(payload.denyReadFiles.some((entry) => entry.endsWith(`${path.sep}later`))).toBe(false);
    const again = freezeDenyReadAtStart(policy.rules);
    expect(again.files.some((entry) => entry.endsWith(`${path.sep}later`))).toBe(true);
    expect(again.postStartCreatesAreOutsideSnapshot).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
