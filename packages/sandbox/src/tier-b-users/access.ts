import path from "node:path";
import { TierBError } from "./errors.js";
import { canonicalizeAbsolute, comparablePath, isSameOrInside } from "./paths.js";
import type { AccessDecision, AccessKind, CompiledTierBPolicy, PolicyRule, SandboxLaunchSpec } from "./types.js";

function assertPort(port: number, label: string): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TierBError("invalid_port", `${label} port is invalid`);
  }
}

export function compileTierBPolicy(spec: SandboxLaunchSpec, capabilitySid: string): CompiledTierBPolicy {
  assertPort(spec.mcpPort, "mcp");
  assertPort(spec.proxyPort, "proxy");
  const worktree = canonicalizeAbsolute(spec.worktree);
  const tempDir = canonicalizeAbsolute(spec.tempDir);
  const buildOutputDir = canonicalizeAbsolute(spec.buildOutputDir);
  const developerCheckout = canonicalizeAbsolute(spec.developerCheckout);
  const harnessDataRoot = canonicalizeAbsolute(spec.harnessDataRoot);
  const userProfile = canonicalizeAbsolute(spec.userProfile);
  const localAppData = canonicalizeAbsolute(spec.localAppData);
  const appData = canonicalizeAbsolute(spec.appData);
  const pnpmStore = canonicalizeAbsolute(spec.pnpmStore);
  if (comparablePath(worktree) === comparablePath(userProfile)) {
    throw new TierBError("worktree_is_profile", "The attempt worktree cannot be the developer profile");
  }
  if (comparablePath(worktree) === comparablePath(developerCheckout)) {
    throw new TierBError("worktree_is_checkout", "The attempt worktree cannot be the developer checkout");
  }
  const toolchainRoots = spec.toolchainRoots.map((root) => canonicalizeAbsolute(root));
  const otherWorktrees = spec.otherWorktrees.map((root) => canonicalizeAbsolute(root));
  const gitDirs = [path.join(worktree, ".git")];
  if (spec.gitDirLink) gitDirs.push(canonicalizeAbsolute(spec.gitDirLink));
  if (spec.gitCommonDir) gitDirs.push(canonicalizeAbsolute(spec.gitCommonDir));
  const nodeModules = path.join(worktree, "node_modules");
  const secrets: readonly PolicyRule[] = [
    { id: "deny_read_ssh", kind: "deny_read", path: path.join(userProfile, ".ssh") },
    { id: "deny_read_aws", kind: "deny_read", path: path.join(userProfile, ".aws") },
    { id: "deny_read_azure", kind: "deny_read", path: path.join(userProfile, ".azure") },
    { id: "deny_read_gnupg", kind: "deny_read", path: path.join(userProfile, ".gnupg") },
    { id: "deny_read_npmrc", kind: "deny_read", path: path.join(userProfile, ".npmrc") },
    { id: "deny_read_gemini_login", kind: "deny_read", path: path.join(userProfile, ".gemini") },
    { id: "deny_read_chrome", kind: "deny_read", path: path.join(localAppData, "Google", "Chrome") },
    { id: "deny_read_edge", kind: "deny_read", path: path.join(localAppData, "Microsoft", "Edge") },
    { id: "deny_read_brave", kind: "deny_read", path: path.join(localAppData, "BraveSoftware") },
    { id: "deny_read_firefox", kind: "deny_read", path: path.join(appData, "Mozilla", "Firefox") },
    { id: "deny_read_appdata_credentials", kind: "deny_read", path: path.join(appData, "Microsoft", "Credentials") },
    { id: "deny_read_appdata_protect", kind: "deny_read", path: path.join(appData, "Microsoft", "Protect") },
    { id: "deny_read_vault", kind: "deny_read", path: path.join(localAppData, "Microsoft", "Vault") },
    { id: "deny_read_local_credentials", kind: "deny_read", path: path.join(localAppData, "Microsoft", "Credentials") },
    { id: "deny_read_harness_data", kind: "deny_read", path: harnessDataRoot },
    { id: "deny_read_developer_checkout", kind: "deny_read", path: developerCheckout },
    { id: "deny_read_developer_home", kind: "deny_read", path: userProfile },
    { id: "deny_read_dpapi", kind: "deny_read", path: "dpapi://developer-credential-manager" },
  ];
  const rules: PolicyRule[] = [
    { id: "writable_worktree", kind: "writable", path: worktree },
    { id: "writable_temp", kind: "writable", path: tempDir },
    { id: "writable_build_output", kind: "writable", path: buildOutputDir },
    { id: "read_only_node_modules", kind: "read_only", path: nodeModules },
    { id: "read_only_pnpm_store", kind: "read_only", path: pnpmStore },
    ...toolchainRoots.map((root, index) => ({ id: `read_only_toolchain_${index}`, kind: "read_only" as const, path: root })),
    ...gitDirs.map((root, index) => ({ id: index === 0 ? "read_only_git" : `read_only_git_${index}`, kind: "read_only" as const, path: root })),
    ...gitDirs.map((root, index) => ({ id: index === 0 ? "deny_write_git" : `deny_write_git_${index}`, kind: "deny_write" as const, path: root })),
    ...secrets,
    ...otherWorktrees.map((root, index) => ({ id: `deny_read_other_worktree_${index}`, kind: "deny_read" as const, path: root })),
  ];
  return {
    tier: "B",
    attemptId: spec.attemptId,
    capabilitySid,
    rules,
    writable: [worktree, tempDir, buildOutputDir],
    readOnly: [nodeModules, pnpmStore, ...toolchainRoots, ...gitDirs],
    denyRead: secrets.map((rule) => rule.path).concat(otherWorktrees),
    denyWrite: gitDirs,
    network: {
      nonLoopback: "deny",
      loopback: "proxy_and_mcp_only",
      proxyPort: spec.proxyPort,
      mcpPort: spec.mcpPort,
    },
  };
}

function deny(ruleId: string, access: AccessKind, errno: "EACCES" | "EPERM"): AccessDecision {
  return { allowed: false, errno, ruleId, access };
}

function allow(ruleId: string, access: AccessKind): AccessDecision {
  return { allowed: true, errno: null, ruleId, access };
}

export function evaluateTierBAccess(
  policy: CompiledTierBPolicy,
  target: string,
  access: AccessKind,
): AccessDecision {
  if (target.startsWith("dpapi:")) return deny("deny_read_dpapi", access, "EACCES");
  const resolved = canonicalizeAbsolute(target);
  const rulePath = (id: string): string | undefined => policy.rules.find((rule) => rule.id === id)?.path;
  const secrets = policy.rules.filter((rule) => rule.kind === "deny_read" && rule.id !== "deny_read_dpapi" && rule.id !== "deny_read_harness_data" && rule.id !== "deny_read_developer_checkout" && rule.id !== "deny_read_developer_home" && !rule.id.startsWith("deny_read_other_worktree_"));
  for (const secret of secrets) {
    if (isSameOrInside(resolved, secret.path)) return deny(secret.id, access, "EACCES");
  }
  const gitRules = policy.rules.filter((rule) => rule.id.startsWith("deny_write_git"));
  for (const gitRule of gitRules) {
    if (!isSameOrInside(resolved, gitRule.path)) continue;
    if (access === "write") return deny(gitRule.id, access, "EACCES");
    return allow(gitRule.id.replace("deny_write", "read_only"), access);
  }
  const nodeModules = rulePath("read_only_node_modules");
  const store = rulePath("read_only_pnpm_store");
  if ((nodeModules && isSameOrInside(resolved, nodeModules)) || (store && isSameOrInside(resolved, store))) {
    if (access === "write") return deny("read_only_store", access, "EPERM");
    return allow("read_only_store", access);
  }
  const toolchains = policy.rules.filter((rule) => rule.id.startsWith("read_only_toolchain_"));
  for (const toolchain of toolchains) {
    if (!isSameOrInside(resolved, toolchain.path)) continue;
    if (access === "write") return deny(toolchain.id, access, "EACCES");
    return allow(toolchain.id, access);
  }
  const others = policy.rules.filter((rule) => rule.id.startsWith("deny_read_other_worktree_"));
  for (const other of others) {
    if (isSameOrInside(resolved, other.path)) return deny(other.id, access, "EACCES");
  }
  for (const root of policy.writable) {
    if (isSameOrInside(resolved, root)) return allow("writable_attempt", access);
  }
  const checkout = rulePath("deny_read_developer_checkout");
  if (checkout && isSameOrInside(resolved, checkout)) return deny("deny_read_developer_checkout", access, "EACCES");
  const harness = rulePath("deny_read_harness_data");
  if (harness && isSameOrInside(resolved, harness)) return deny("deny_read_harness_data", access, "EACCES");
  const home = rulePath("deny_read_developer_home");
  if (home && (comparablePath(resolved) === comparablePath(home) || isSameOrInside(resolved, home))) {
    return deny("deny_read_developer_home", access, "EACCES");
  }
  return deny("deny_write_outside", access, "EACCES");
}
