import fs from "node:fs";
import path from "node:path";
import { MxcModeError, MxcPolicyPathError } from "./errors.js";
import { assertSafeTempDir, canonicalizeAbsolute, isSameOrInside, platformPath } from "./paths.js";
import type {
  AccessDecision,
  AccessKind,
  CompiledMxcPolicy,
  MxcLaunchMetadata,
  MxcNuances,
  NetworkDecision,
  PolicyRule,
  SandboxLaunchSpec,
  WrappedVendor,
} from "./types.js";
import { VENDOR_PROVIDER_HOSTS } from "./constants.js";

const LAUNCH: MxcLaunchMetadata = {
  entry: "Experimental_CreateProcessInSandbox",
  dll: "processmodel.dll",
  loadFlag: "LOAD_LIBRARY_SEARCH_SYSTEM32",
  specIdentifier: "SBOX",
  failOpen: false,
  helperName: "ef-mxc-launch",
  helperPin: "openai/codex@rust-v0.162.1#codex-rs/mxc-sandbox",
  callsExportDirectly: false,
  grantModel: "policy",
  aclMutation: false,
};

const NUANCES: MxcNuances = {
  denyReadGlobsEvaluatedAtProcessStart: true,
  foregroundExitStopsChildren: true,
  detachedServersOwner: "task_049_environment_orchestrator",
  postStartFileMayEscapeFileGlobSnapshot: true,
  platformLoopbackIsBidirectional: true,
  allowLocalBinding: true,
};

function assertPort(port: number, label: string): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MxcModeError("invalid_port", `${label} port is invalid`);
  }
}

function discoverGitDir(worktree: string, fsPath: path.PlatformPath): string | null {
  const pointer = fsPath.join(worktree, ".git");
  if (!fs.existsSync(pointer)) return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(pointer);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return pointer;
  let text = "";
  try {
    text = fs.readFileSync(pointer, "utf8");
  } catch {
    return null;
  }
  const match = /^gitdir:\s*(.+)$/im.exec(text);
  const target = match?.[1]?.trim();
  if (!target) return null;
  if (target.split(/[\\/]/).some((segment) => segment === "..")) {
    throw new MxcPolicyPathError("path_traversal", target);
  }
  return fsPath.resolve(worktree, target);
}

function discoverCommonDir(gitDir: string, fsPath: path.PlatformPath): string | null {
  const file = fsPath.join(gitDir, "commondir");
  if (!fs.existsSync(file)) return null;
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
  if (!text || text.split(/[\\/]/).some((segment) => segment === "..")) {
    if (text.split(/[\\/]/).some((segment) => segment === "..")) {
      throw new MxcPolicyPathError("path_traversal", text);
    }
    return null;
  }
  return fsPath.resolve(gitDir, text);
}

function geminiLoginFolder(userProfile: string, fsPath: path.PlatformPath): string {
  return fsPath.join(userProfile, ".gemini");
}

function rejectionCode(resolved: string, checkout: string, projects: string): string {
  if (isSameOrInside(resolved, projects)) return "harness_projects";
  if (isSameOrInside(resolved, checkout)) return "developer_checkout";
  return "deny_read_overlap";
}

export function compileMxcPolicy(spec: SandboxLaunchSpec, frozenAt = new Date().toISOString()): CompiledMxcPolicy {
  assertPort(spec.mcpPort, "mcp");
  assertPort(spec.proxyPort, "proxy");
  if (spec.mode === "wrapped" && !spec.vendor) {
    throw new MxcModeError("wrapped_vendor_required", "Wrapped Tier A execution requires a vendor");
  }

  const worktree = canonicalizeAbsolute(spec.worktree);
  const fsPath = platformPath(worktree);
  const tempDir = canonicalizeAbsolute(spec.tempDir);
  const buildOutputDir = canonicalizeAbsolute(spec.buildOutputDir);
  const developerCheckout = canonicalizeAbsolute(spec.developerCheckout);
  const harnessDataRoot = canonicalizeAbsolute(spec.harnessDataRoot);
  const userProfile = canonicalizeAbsolute(spec.userProfile);
  const localAppData = canonicalizeAbsolute(spec.localAppData);
  const appData = canonicalizeAbsolute(spec.appData);
  const pnpmStore = canonicalizeAbsolute(spec.pnpmStore);
  const projects = fsPath.join(harnessDataRoot, "projects");
  const toolchainRoots = spec.toolchainRoots.map((root) => canonicalizeAbsolute(root));
  const otherWorktrees = spec.otherWorktrees.map((root) => canonicalizeAbsolute(root));

  assertSafeTempDir(tempDir, { worktree, developerCheckout });
  if (comparableBlocked(buildOutputDir, worktree)) {
    throw new MxcPolicyPathError("build_output_is_worktree", buildOutputDir);
  }

  const secretRoots = [
    fsPath.join(userProfile, ".ssh"),
    fsPath.join(userProfile, ".aws"),
    fsPath.join(userProfile, ".azure"),
    fsPath.join(userProfile, ".gnupg"),
    fsPath.join(userProfile, ".npmrc"),
    fsPath.join(localAppData, "Google", "Chrome", "User Data"),
    fsPath.join(localAppData, "Microsoft", "Edge", "User Data"),
    fsPath.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data"),
    fsPath.join(appData, "Mozilla", "Firefox", "Profiles"),
    fsPath.join(appData, "Microsoft", "Credentials"),
    fsPath.join(appData, "Microsoft", "Protect"),
    fsPath.join(localAppData, "Microsoft", "Vault"),
    fsPath.join(localAppData, "Microsoft", "Credentials"),
  ];
  const blockedContainers = [developerCheckout, projects, ...secretRoots, ...otherWorktrees];
  for (const candidate of [worktree, tempDir, buildOutputDir]) {
    for (const block of blockedContainers) {
      if (isSameOrInside(candidate, block)) {
        throw new MxcPolicyPathError(rejectionCode(candidate, developerCheckout, projects), candidate);
      }
    }
  }

  const nodeModules = fsPath.join(worktree, "node_modules");
  const worktreeGit = fsPath.join(worktree, ".git");
  const linkedGit = spec.gitDirLink ? canonicalizeAbsolute(spec.gitDirLink) : discoverGitDir(worktree, fsPath);
  const commonGit = spec.gitCommonDir
    ? canonicalizeAbsolute(spec.gitCommonDir)
    : linkedGit
      ? discoverCommonDir(linkedGit, fsPath)
      : null;

  const rules: PolicyRule[] = [
    { id: "writable_worktree", kind: "writable", path: worktree },
    { id: "writable_temp", kind: "writable", path: tempDir },
    { id: "writable_build_output", kind: "writable", path: buildOutputDir },
    { id: "read_only_node_modules", kind: "read_only", path: nodeModules },
    { id: "read_only_pnpm_store", kind: "read_only", path: pnpmStore },
    { id: "read_only_git", kind: "read_only", path: worktreeGit },
    { id: "deny_write_git", kind: "deny_write", path: worktreeGit },
    { id: "deny_read_ssh", kind: "deny_read", path: secretRoots[0] ?? fsPath.join(userProfile, ".ssh") },
    { id: "deny_read_aws", kind: "deny_read", path: secretRoots[1] ?? fsPath.join(userProfile, ".aws") },
    { id: "deny_read_azure", kind: "deny_read", path: secretRoots[2] ?? fsPath.join(userProfile, ".azure") },
    { id: "deny_read_gnupg", kind: "deny_read", path: secretRoots[3] ?? fsPath.join(userProfile, ".gnupg") },
    { id: "deny_read_npmrc", kind: "deny_read", path: secretRoots[4] ?? fsPath.join(userProfile, ".npmrc") },
    { id: "deny_read_chrome", kind: "deny_read", path: secretRoots[5] ?? localAppData },
    { id: "deny_read_edge", kind: "deny_read", path: secretRoots[6] ?? localAppData },
    { id: "deny_read_brave", kind: "deny_read", path: secretRoots[7] ?? localAppData },
    { id: "deny_read_firefox", kind: "deny_read", path: secretRoots[8] ?? appData },
    { id: "deny_read_appdata_credentials", kind: "deny_read", path: secretRoots[9] ?? appData },
    { id: "deny_read_appdata_protect", kind: "deny_read", path: secretRoots[10] ?? appData },
    { id: "deny_read_vault", kind: "deny_read", path: secretRoots[11] ?? localAppData },
    { id: "deny_read_local_credentials", kind: "deny_read", path: secretRoots[12] ?? localAppData },
    { id: "deny_read_harness_data", kind: "deny_read", path: harnessDataRoot },
    { id: "deny_read_developer_checkout", kind: "deny_read", path: developerCheckout },
  ];

  toolchainRoots.forEach((root, index) => {
    rules.push({ id: `read_only_toolchain_${index}`, kind: "read_only", path: root });
  });
  otherWorktrees.forEach((root, index) => {
    rules.push({ id: `deny_read_other_worktree_${index}`, kind: "deny_read", path: root });
  });
  if (linkedGit && comparableKey(linkedGit) !== comparableKey(worktreeGit)) {
    rules.push({ id: "read_only_linked_gitdir", kind: "read_only", path: linkedGit });
    rules.push({ id: "deny_write_linked_gitdir", kind: "deny_write", path: linkedGit });
  }
  if (commonGit) {
    rules.push({ id: "read_only_git_common", kind: "read_only", path: commonGit });
    rules.push({ id: "deny_write_git_common", kind: "deny_write", path: commonGit });
  }
  if (spec.mode === "wrapped" && spec.vendor === "gemini") {
    rules.push({
      id: "read_only_gemini_login",
      kind: "read_only",
      path: geminiLoginFolder(userProfile, fsPath),
    });
  }

  const vendor: WrappedVendor | null = spec.mode === "wrapped" ? (spec.vendor ?? null) : null;
  const providerHosts = vendor ? [...VENDOR_PROVIDER_HOSTS[vendor]] : [];
  const ports = spec.mcpPort === spec.proxyPort ? [spec.mcpPort] : [spec.mcpPort, spec.proxyPort];

  return {
    tier: "A",
    version: 1,
    policyBasedGrants: true,
    mode: spec.mode,
    vendor,
    attemptId: spec.attemptId,
    writable: Object.freeze(pathsOf(rules, "writable")),
    readOnly: Object.freeze(pathsOf(rules, "read_only")),
    denyRead: Object.freeze(pathsOf(rules, "deny_read")),
    denyWrite: Object.freeze(pathsOf(rules, "deny_write")),
    rules: Object.freeze(rules.map((rule) => Object.freeze(rule))),
    network: {
      nonLoopback: "deny",
      loopback: "allow_listed_ports_only",
      allowLoopbackPorts: Object.freeze(ports),
      providerHosts: Object.freeze(providerHosts),
      proxyProfile: spec.mode === "wrapped" ? "wrapped_vendor" : "coding_worker",
      rawExternalTcp: "deny",
      proxyPort: spec.proxyPort,
      mcpPort: spec.mcpPort,
    },
    nuances: NUANCES,
    launch: LAUNCH,
    frozenAt,
  };
}

function pathsOf(rules: readonly PolicyRule[], kind: PolicyRule["kind"]): string[] {
  return rules.filter((rule) => rule.kind === kind).map((rule) => rule.path);
}

function comparableKey(input: string): string {
  const api = platformPath(input);
  const normalized = api.normalize(input);
  return api === path.win32 ? normalized.toLowerCase() : normalized;
}

function comparableBlocked(left: string, right: string): boolean {
  return comparableKey(left) === comparableKey(right);
}

function applies(rule: PolicyRule, access: AccessKind): boolean {
  if (access === "read") {
    return rule.kind === "deny_read" || rule.kind === "read_only" || rule.kind === "writable";
  }
  return rule.kind === "deny_write" || rule.kind === "read_only" || rule.kind === "writable";
}

function strictness(rule: PolicyRule, access: AccessKind): number {
  if (access === "read" && rule.kind === "deny_read") return 3;
  if (access === "write" && rule.kind === "deny_write") return 3;
  if (rule.kind === "read_only") return 2;
  if (rule.kind === "writable") return 1;
  return 0;
}

export function evaluateAccess(policy: CompiledMxcPolicy, target: string, access: AccessKind): AccessDecision {
  if (target.split(/[\\/]/).some((segment) => segment === "..")) {
    return { allowed: false, errno: "EACCES", ruleId: "path_traversal", access };
  }
  const api = platformPath(target);
  const resolved = api.resolve(target);
  const needle = comparableKey(resolved);
  let winner: PolicyRule | null = null;
  let winnerLength = -1;
  for (const rule of policy.rules) {
    if (!applies(rule, access)) continue;
    const ruleKey = comparableKey(rule.path);
    const separator = platformPath(rule.path).sep;
    const inside = needle === ruleKey || needle.startsWith(ruleKey.endsWith(separator) ? ruleKey : `${ruleKey}${separator}`);
    if (!inside) continue;
    const length = ruleKey.length;
    if (
      winner === null ||
      length > winnerLength ||
      (length === winnerLength && strictness(rule, access) > strictness(winner, access))
    ) {
      winner = rule;
      winnerLength = length;
    }
  }
  if (!winner) {
    return {
      allowed: false,
      errno: access === "write" ? "EPERM" : "EACCES",
      ruleId: "default_deny",
      access,
    };
  }
  if (winner.kind === "writable" || (winner.kind === "read_only" && access === "read")) {
    return { allowed: true, errno: null, ruleId: winner.id, access };
  }
  return {
    allowed: false,
    errno: access === "read" ? "EACCES" : "EPERM",
    ruleId: winner.id,
    access,
  };
}

function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "localhost" || value === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
}

export function evaluateNetwork(policy: CompiledMxcPolicy, host: string, port: number): NetworkDecision {
  const normalized = host.trim().toLowerCase();
  if (policy.network.providerHosts.some((allowed) => allowed.toLowerCase() === normalized)) {
    return {
      allowed: false,
      errno: "EACCES",
      ruleId: "provider_direct_tcp_denied",
      host,
      port,
    };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { allowed: false, errno: "EACCES", ruleId: "raw_external_tcp", host, port };
  }
  if (isLoopbackHost(host) && policy.network.allowLoopbackPorts.includes(port)) {
    return { allowed: true, errno: null, ruleId: "loopback_allowlisted", host, port };
  }
  if (isLoopbackHost(host)) {
    return { allowed: false, errno: "EACCES", ruleId: "loopback_port_not_allowlisted", host, port };
  }
  return { allowed: false, errno: "EACCES", ruleId: "raw_external_tcp", host, port };
}

export function sealPolicyAtStart(policy: CompiledMxcPolicy, frozenAt: string): CompiledMxcPolicy {
  const rules = policy.rules.map((rule) => ({ ...rule }));
  return compileFromSealed(policy, rules, frozenAt);
}

function compileFromSealed(
  policy: CompiledMxcPolicy,
  rules: PolicyRule[],
  frozenAt: string,
): CompiledMxcPolicy {
  return {
    tier: "A",
    version: 1,
    policyBasedGrants: true,
    mode: policy.mode,
    vendor: policy.vendor,
    attemptId: policy.attemptId,
    writable: Object.freeze(pathsOf(rules, "writable")),
    readOnly: Object.freeze(pathsOf(rules, "read_only")),
    denyRead: Object.freeze(pathsOf(rules, "deny_read")),
    denyWrite: Object.freeze(pathsOf(rules, "deny_write")),
    rules: Object.freeze(rules.map((rule) => Object.freeze(rule))),
    network: {
      ...policy.network,
      allowLoopbackPorts: Object.freeze([...policy.network.allowLoopbackPorts]),
      providerHosts: Object.freeze([...policy.network.providerHosts]),
    },
    nuances: policy.nuances,
    launch: policy.launch,
    frozenAt,
  };
}
