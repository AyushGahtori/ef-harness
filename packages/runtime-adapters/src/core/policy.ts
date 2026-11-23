import path from "node:path";
import { hasCredentialSegment, resolveAgainstWorktree } from "./paths.js";
import type { ExecutionMode, PolicyDecision, SupervisionRequest } from "./types.js";

export const DIRECT_INSTALL_DENY_REASON =
  "Direct package installs are disabled; emit a DependencyIntent via harness MCP instead";

export const USER_STOPPED_REASON = "user_stopped";

const WRITE_GIT_REASON = "Writes to .git are disabled";
const WRITE_HARNESS_REASON = "Writes to .harness are disabled";
const WRITE_LOCK_REASON = "Lockfile writes are disabled";
const WRITE_SEALED_REASON = "Sealed test and oracle paths are not writable";
const WRITE_SCOPE_REASON = "Path is outside write_scope";
const WRITE_ESCAPE_REASON = "Path escapes the assigned worktree";
const SYMLINK_REASON = "Symlink target escapes the assigned worktree";
const CREDENTIAL_READ_REASON = "Credential directories are unreadable";
const APPDATA_REASON = "AppData reads are disabled";
const HOST_DB_REASON = "Host database reads are disabled";
const READ_BOUNDARY_REASON = "Path is outside the worktree read boundary";
const STRIPPED_REASON = "Stripped mode disables native file, shell, and web tools";
const NETWORK_REASON = "Network exfiltration commands are disabled";
const PRIVILEGE_REASON = "Privilege escalation commands are disabled";
const GIT_REASON = "Destructive git commands are disabled";
const INTERACTIVE_REASON = "Interactive TTY commands are disabled";
const REDIRECT_REASON = "Command must run through harness.run inside the execution pool";
const WEB_REASON = "Unproxied web tools bypass the allowlist proxy";
const MCP_REASON = "Tool is not a leased EF Harness MCP tool";
const EMPTY_COMMAND_REASON = "Empty shell command";

const LOCKFILES = new Set(["package-lock.json", "pnpm-lock.yaml"]);
const NETWORK_COMMANDS = new Set([
  "curl",
  "wget",
  "iwr",
  "irm",
  "invoke-webrequest",
  "invoke-restmethod",
  "nc",
  "netcat",
  "scp",
  "ssh",
]);
const PRIVILEGE_COMMANDS = new Set(["sudo", "runas", "gsudo", "su"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const PACKAGE_INSTALL_SUBCOMMANDS = new Set([
  "add",
  "install",
  "i",
  "update",
  "remove",
  "rm",
  "link",
  "dlx",
  "install-test",
]);
const SAFE_GIT = new Set(["status", "diff", "log", "show", "rev-parse", "blame", "ls-files"]);
const SAFE_BINARIES = new Set(["vitest", "jest", "tsc", "eslint"]);
const SAFE_PACKAGE_SCRIPTS = new Set(["test", "build", "lint", "typecheck", "check"]);
const SHELL_WRAPPERS = new Set(["bash", "sh", "zsh", "powershell", "pwsh", "cmd"]);

export interface SupervisionContext {
  readonly sessionId: string;
  readonly worktreeRoot: string;
  readonly cwd: string;
  readonly writeScope: readonly string[];
  readonly readOnlyPaths: readonly string[];
  readonly sealedPaths: readonly string[];
  readonly mode: ExecutionMode;
  readonly homeDir: string;
  readonly appData: string;
  readonly leasedTools: readonly string[];
  readonly realpath?: (target: string) => string;
}

type Outcome =
  | { readonly effect: "allow" }
  | { readonly effect: "deny"; readonly reason: string }
  | { readonly effect: "redirect"; readonly via: "harness.run"; readonly reason: string };

interface ResolvedRequestPath {
  readonly absolute: string;
  readonly relative: string | null;
  readonly containment: "inside" | "symlink_escape" | "outside";
  readonly credential: boolean;
  readonly appData: boolean;
  readonly hostDatabase: boolean;
  readonly requested: string;
}

/**
 * Pure kernel allow/deny for foreign permission callbacks.
 * No model call. Symlink and Windows case-fold checks happen before allow.
 */
export class DeterministicSupervisionPolicyEngine {
  decide(request: SupervisionRequest, context: SupervisionContext): PolicyDecision {
    const started = performance.now();
    const outcome = this.evaluate(request, context);
    const elapsedMs = performance.now() - started;
    if (outcome.effect === "allow") return { effect: "allow", elapsedMs };
    if (outcome.effect === "redirect") {
      return { effect: "redirect", via: "harness.run", reason: outcome.reason, elapsedMs };
    }
    return { effect: "deny", reason: outcome.reason, elapsedMs };
  }

  private evaluate(request: SupervisionRequest, context: SupervisionContext): Outcome {
    switch (request.kind) {
      case "write":
      case "edit":
      case "delete":
        return this.decideWrite(request.path, context);
      case "read":
        return this.decideRead(request.path, context);
      case "shell":
        return this.decideShell(request.command, context);
      case "web":
        return { effect: "deny", reason: WEB_REASON };
      case "mcp":
        return this.decideMcp(request.tool, context);
      default:
        return { effect: "deny", reason: "Unknown supervision request" };
    }
  }

  private decideWrite(requested: string, context: SupervisionContext): Outcome {
    if (context.mode === "stripped") return { effect: "deny", reason: STRIPPED_REASON };
    const resolved = this.resolve(requested, context);
    if (pathHasSegment(resolved.requested, ".git") || pathHasSegment(resolved.absolute, ".git")) {
      return { effect: "deny", reason: WRITE_GIT_REASON };
    }
    if (pathHasSegment(resolved.requested, ".harness") || pathHasSegment(resolved.absolute, ".harness")) {
      return { effect: "deny", reason: WRITE_HARNESS_REASON };
    }
    if (LOCKFILES.has(path.basename(resolved.absolute).toLowerCase())) {
      return { effect: "deny", reason: WRITE_LOCK_REASON };
    }
    if (resolved.containment === "symlink_escape") return { effect: "deny", reason: SYMLINK_REASON };
    if (resolved.containment !== "inside" || resolved.relative === null) {
      return { effect: "deny", reason: WRITE_ESCAPE_REASON };
    }
    if (resolved.credential) return { effect: "deny", reason: CREDENTIAL_READ_REASON };
    if (matchesAny(resolved.relative, context.sealedPaths)) {
      return { effect: "deny", reason: WRITE_SEALED_REASON };
    }
    if (!matchesAny(resolved.relative, context.writeScope)) {
      return { effect: "deny", reason: WRITE_SCOPE_REASON };
    }
    return { effect: "allow" };
  }

  private decideRead(requested: string, context: SupervisionContext): Outcome {
    if (context.mode === "stripped") return { effect: "deny", reason: STRIPPED_REASON };
    const resolved = this.resolve(requested, context);
    if (resolved.credential || hasCredentialSegment(resolved.requested)) {
      return { effect: "deny", reason: CREDENTIAL_READ_REASON };
    }
    if (resolved.appData) return { effect: "deny", reason: APPDATA_REASON };
    if (resolved.hostDatabase) return { effect: "deny", reason: HOST_DB_REASON };
    if (resolved.containment === "symlink_escape") return { effect: "deny", reason: SYMLINK_REASON };
    if (resolved.containment === "inside") return { effect: "allow" };
    if (resolved.relative === null && matchesAny(toPosix(resolved.absolute), context.readOnlyPaths)) {
      return { effect: "allow" };
    }
    if (resolved.containment === "outside" && outsideReadAllowed(resolved.absolute, context.readOnlyPaths)) {
      return { effect: "allow" };
    }
    return { effect: "deny", reason: READ_BOUNDARY_REASON };
  }

  private decideShell(command: string, context: SupervisionContext): Outcome {
    if (context.mode === "stripped") return { effect: "deny", reason: STRIPPED_REASON };
    const trimmed = command.trim();
    if (!trimmed) return { effect: "deny", reason: EMPTY_COMMAND_REASON };
    const parts = splitSegments(trimmed);
    let sawRedirect = false;
    for (const part of parts) {
      const outcome = classifySegment(part, 0);
      if (outcome.effect === "deny") return outcome;
      if (outcome.effect === "redirect") sawRedirect = true;
    }
    if (sawRedirect) return { effect: "redirect", via: "harness.run", reason: REDIRECT_REASON };
    return { effect: "allow" };
  }

  private decideMcp(tool: string, context: SupervisionContext): Outcome {
    if (isCanonicalMcp(tool) && isLeased(tool, context.leasedTools)) return { effect: "allow" };
    return { effect: "deny", reason: MCP_REASON };
  }

  private resolve(requested: string, context: SupervisionContext): ResolvedRequestPath {
    const resolved = resolveAgainstWorktree(requested, {
      worktreeRoot: context.worktreeRoot,
      cwd: context.cwd,
      homeDir: context.homeDir,
      ...(context.appData.length > 0 ? { appData: context.appData } : {}),
      ...(context.realpath ? { realpath: context.realpath } : {}),
    });
    return resolved;
  }
}

function outsideReadAllowed(absolute: string, readOnlyPaths: readonly string[]): boolean {
  const posix = toPosix(absolute).toLowerCase();
  return readOnlyPaths.some((entry) => {
    const normalized = normalizeScope(entry);
    if (!path.isAbsolute(entry) && !entry.startsWith("/") && !/^[a-zA-Z]:/.test(entry)) return false;
    return posix === normalized.toLowerCase() || matchesPattern(posix, normalized.toLowerCase());
  });
}

function pathHasSegment(value: string, segment: string): boolean {
  return value
    .split(/[\\/]+/)
    .some((part) => part.toLowerCase() === segment);
}

function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

function normalizeScope(entry: string): string {
  return toPosix(entry.trim()).replace(/^\.\//, "");
}

function matchesAny(relativeOrAbsolute: string, patterns: readonly string[]): boolean {
  const target = toPosix(relativeOrAbsolute);
  return patterns.some((pattern) => matchesPattern(target, normalizeScope(pattern)));
}

function matchesPattern(target: string, pattern: string): boolean {
  const foldedTarget = target.toLowerCase();
  const folded = pattern.toLowerCase();
  if (folded.endsWith("/**")) {
    const prefix = folded.slice(0, -3);
    return foldedTarget === prefix || foldedTarget.startsWith(`${prefix}/`);
  }
  if (folded.endsWith("/")) return foldedTarget.startsWith(folded);
  if (folded.includes("*")) return globToRegExp(folded).test(foldedTarget);
  return foldedTarget === folded;
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    if (char === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
      if (pattern[index + 1] === "/") index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    source += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function splitSegments(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(segment)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens.filter((token) => token.length > 0 && token !== "&");
}

function commandBase(token: string): string {
  const file = toPosix(token).split("/").pop() ?? token;
  return file.toLowerCase().replace(/\.(exe|cmd|bat)$/i, "");
}

function classifySegment(segment: string, depth: number): Outcome {
  const tokens = tokenize(segment);
  if (tokens.length === 0) return { effect: "deny", reason: EMPTY_COMMAND_REASON };
  const base = commandBase(tokens[0] ?? "");
  const args = tokens.slice(1);
  if (depth < 3 && SHELL_WRAPPERS.has(base)) {
    const inner = unwrapShell(base, args);
    if (inner === "interactive") return { effect: "deny", reason: INTERACTIVE_REASON };
    if (inner) return classifySegment(inner, depth + 1);
    return { effect: "redirect", via: "harness.run", reason: REDIRECT_REASON };
  }
  if (isPackageInstall(base, args)) return { effect: "deny", reason: DIRECT_INSTALL_DENY_REASON };
  if (isNetwork(base, args)) return { effect: "deny", reason: NETWORK_REASON };
  if (PRIVILEGE_COMMANDS.has(base)) return { effect: "deny", reason: PRIVILEGE_REASON };
  const git = destructiveGit(base, args);
  if (git) return git;
  if (isInteractive(base, args)) return { effect: "deny", reason: INTERACTIVE_REASON };
  if (isSafeReadTestBuild(base, args)) return { effect: "allow" };
  return { effect: "redirect", via: "harness.run", reason: REDIRECT_REASON };
}

function unwrapShell(base: string, args: string[]): string | null {
  const lowered = args.map((arg) => arg.toLowerCase());
  if (base === "cmd" && lowered.includes("/k")) return "interactive";
  if (base === "powershell" || base === "pwsh") {
    const index = lowered.findIndex((arg) => arg === "-command" || arg === "-c");
    if (index >= 0) return args.slice(index + 1).join(" ");
    return null;
  }
  if (base === "cmd") {
    const index = lowered.findIndex((arg) => arg === "/c");
    if (index >= 0) return args.slice(index + 1).join(" ");
    return null;
  }
  const index = args.findIndex((arg) => arg === "-c" || arg === "-lc");
  if (index >= 0) return args.slice(index + 1).join(" ");
  return null;
}

function isPackageInstall(base: string, args: readonly string[]): boolean {
  if (!PACKAGE_MANAGERS.has(base)) return false;
  const sub = (args[0] ?? "").toLowerCase();
  return PACKAGE_INSTALL_SUBCOMMANDS.has(sub);
}

function isNetwork(base: string, args: readonly string[]): boolean {
  if (NETWORK_COMMANDS.has(base)) return true;
  return args.some((arg) => NETWORK_COMMANDS.has(commandBase(arg)));
}

function destructiveGit(base: string, args: readonly string[]): Outcome | null {
  if (base !== "git") return null;
  const sub = (args[0] ?? "").toLowerCase();
  if (sub === "push") return { effect: "deny", reason: GIT_REASON };
  if (sub === "reset" && args.some((arg) => arg.toLowerCase() === "--hard")) {
    return { effect: "deny", reason: GIT_REASON };
  }
  if (sub === "checkout" && checksOutProtectedBranch(args.slice(1))) {
    return { effect: "deny", reason: GIT_REASON };
  }
  return null;
}

function checksOutProtectedBranch(args: readonly string[]): boolean {
  const dash = args.indexOf("--");
  const refs = (dash === -1 ? args : args.slice(0, dash)).map((arg) => arg.toLowerCase());
  return refs.includes("main") || refs.includes("master");
}

function isInteractive(base: string, args: readonly string[]): boolean {
  if (base === "pause" || base === "more" || base === "ssh") return true;
  const lowered = [base, ...args.map((arg) => arg.toLowerCase())];
  if (lowered.includes("read-host") || lowered.includes("get-credential")) return true;
  return args.some((arg) => {
    const flag = arg.toLowerCase();
    return flag === "-i" || flag === "-it" || flag === "--interactive";
  });
}

function isSafeReadTestBuild(base: string, args: readonly string[]): boolean {
  if (SAFE_BINARIES.has(base)) return true;
  if (base === "node") return args.includes("--test");
  if (base === "git") return SAFE_GIT.has((args[0] ?? "").toLowerCase());
  if (!PACKAGE_MANAGERS.has(base)) return false;
  return isSafePackageScript(args);
}

function isSafePackageScript(args: readonly string[]): boolean {
  const [first, second] = [args[0]?.toLowerCase() ?? "", args[1]?.toLowerCase() ?? ""];
  if (SAFE_PACKAGE_SCRIPTS.has(first)) return true;
  if (first === "run" && SAFE_PACKAGE_SCRIPTS.has(second)) return true;
  if (first === "exec") return SAFE_BINARIES.has(commandBase(args[1] ?? ""));
  return false;
}

function isCanonicalMcp(tool: string): boolean {
  if (tool === "harness.run" || tool === "harness.read_result") return true;
  return tool.startsWith("kb.") && tool.length > "kb.".length && !tool.includes("*");
}

function isLeased(tool: string, leased: readonly string[]): boolean {
  return leased.some((pattern) => {
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -1);
      return tool.startsWith(prefix) && tool.length > prefix.length;
    }
    return tool === pattern;
  });
}

export function policyToPermission(decision: PolicyDecision): {
  readonly effect: "allow" | "deny";
  readonly reason?: string;
} {
  if (decision.effect === "allow") return { effect: "allow" };
  return { effect: "deny", reason: decision.reason };
}
