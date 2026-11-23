import { performance } from "node:perf_hooks";
import { globMatch, isSealedRelative, resolveAgainstWorktree } from "./paths.js";
import type { ExecutionMode, PolicyDecision, SupervisionRequest } from "./types.js";
import { PERMISSION_BUDGET_MS } from "./errors.js";

export interface SupervisionContext {
  readonly worktreeRoot: string;
  readonly writeScope: readonly string[];
  readonly mode: ExecutionMode;
  readonly cwd?: string;
  readonly homeDir?: string;
  readonly appData?: string;
  readonly leasedTools?: readonly string[];
}

export interface SupervisionPolicyPort {
  decide(context: SupervisionContext, request: SupervisionRequest): PolicyDecision;
}

const DEFAULT_LEASED_TOOLS = ["kb.*", "harness.run", "harness.read_result"] as const;

type RawDecision =
  | { readonly effect: "allow" }
  | { readonly effect: "deny"; readonly reason: string }
  | { readonly effect: "redirect"; readonly via: "harness.run"; readonly reason: string };

/** Local port of Task 142 `DeterministicSupervisionPolicyEngine`. */
export class LocalSupervisionPolicy implements SupervisionPolicyPort {
  decide(context: SupervisionContext, request: SupervisionRequest): PolicyDecision {
    const started = performance.now();
    const finish = (decision: RawDecision): PolicyDecision => {
      const elapsedMs = performance.now() - started;
      if (decision.effect === "allow") return { effect: "allow", elapsedMs };
      if (decision.effect === "redirect") {
        return { effect: "redirect", via: "harness.run", reason: decision.reason, elapsedMs };
      }
      return { effect: "deny", reason: decision.reason, elapsedMs };
    };
    if (request.kind === "read") return finish(decideRead(context, request.path));
    if (request.kind === "write" || request.kind === "edit" || request.kind === "delete") {
      return finish(decideWrite(context, request.path));
    }
    if (request.kind === "shell") return finish(decideShell(request.command));
    if (request.kind === "web") return finish({ effect: "deny", reason: "unproxied web tools are denied" });
    const tool = request.kind === "mcp" ? request.tool : "unknown";
    return finish(decideMcp(context, tool));
  }
}

export function assertPermissionBudget(decision: PolicyDecision): void {
  if (decision.elapsedMs > PERMISSION_BUDGET_MS) {
    throw new Error(`supervision exceeded ${PERMISSION_BUDGET_MS} ms (${decision.elapsedMs.toFixed(3)} ms)`);
  }
}

function decideRead(context: SupervisionContext, requested: string): RawDecision {
  const resolved = resolveAgainstWorktree(requested, context);
  if (resolved.credential) return { effect: "deny", reason: "credential path is denied" };
  if (resolved.appData) return { effect: "deny", reason: "application data path is denied" };
  if (resolved.hostDatabase) return { effect: "deny", reason: "host database is denied" };
  if (resolved.containment === "symlink_escape") return { effect: "deny", reason: "symlink escapes the worktree" };
  if (resolved.containment !== "inside" || resolved.relative === null) {
    return { effect: "deny", reason: "read is outside the worktree" };
  }
  return { effect: "allow" };
}

function decideWrite(context: SupervisionContext, requested: string): RawDecision {
  const resolved = resolveAgainstWorktree(requested, context);
  if (resolved.credential) return { effect: "deny", reason: "credential path is denied" };
  if (resolved.appData) return { effect: "deny", reason: "application data path is denied" };
  if (resolved.containment === "symlink_escape") return { effect: "deny", reason: "symlink escapes the worktree" };
  if (resolved.containment !== "inside" || resolved.relative === null) {
    return { effect: "deny", reason: "write is outside the worktree" };
  }
  if (isSealedRelative(resolved.relative)) return { effect: "deny", reason: "path is sealed" };
  if (!context.writeScope.some((pattern) => globMatch(pattern, resolved.relative ?? ""))) {
    return { effect: "deny", reason: "path is outside write_scope" };
  }
  return { effect: "allow" };
}

function decideShell(command: string): RawDecision {
  const trimmed = command.trim();
  if (!trimmed) return { effect: "deny", reason: "empty command is denied" };
  if (/[`$]|[<>]|\n|\r/.test(trimmed) || trimmed.includes("$(")) {
    return { effect: "deny", reason: "command substitution or redirection is denied" };
  }
  const segments = splitSegments(trimmed);
  if (segments.length === 0) return { effect: "deny", reason: "empty command is denied" };
  for (const segment of segments) {
    const reason = deniedSegmentReason(segment);
    if (reason) return { effect: "deny", reason };
  }
  return {
    effect: "redirect",
    via: "harness.run",
    reason: "shell runs only through harness.run",
  };
}

function decideMcp(context: SupervisionContext, tool: string): RawDecision {
  const allowed = context.leasedTools ?? DEFAULT_LEASED_TOOLS;
  if (toolAllowed(tool, allowed)) return { effect: "allow" };
  return { effect: "deny", reason: "mcp tool is not on the attempt lease" };
}

function toolAllowed(tool: string, allowed: readonly string[]): boolean {
  return allowed.some((pattern) => {
    if (pattern.endsWith(".*")) return tool.startsWith(pattern.slice(0, -1));
    return tool === pattern;
  });
}

function splitSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function deniedSegmentReason(segment: string): string | null {
  const tokens = tokenize(segment);
  const exe = (tokens[0] ?? "").toLowerCase();
  const rest = tokens.slice(1).join(" ").toLowerCase();
  const joined = tokens.join(" ").toLowerCase();
  if (joined.includes("invoke-webrequest") || joined.includes("iwr ")) {
    return "network exfil command is denied";
  }
  if (exe === "curl" || exe === "wget" || exe === "sudo" || exe === "runas") {
    return "network or privilege command is denied";
  }
  if (exe === "git") return gitReason(tokens[1]?.toLowerCase() ?? "", rest);
  if (exe === "npm") return packageManagerReason("npm", tokens[1]?.toLowerCase() ?? "");
  if (exe === "pnpm" || exe === "yarn") return packageManagerReason(exe, tokens[1]?.toLowerCase() ?? "");
  if (exe === "vitest" || exe === "tsc" || exe === "eslint" || exe === "node") return null;
  if (exe === "cmd" || exe === "powershell" || exe === "pwsh" || exe === "bash" || exe === "sh") {
    return "interactive or wrapper shells are denied";
  }
  return "command is not on the test and build allowlist";
}

function gitReason(subcommand: string, rest: string): string | null {
  if (subcommand === "push") return "git push is denied";
  if (subcommand === "reset" && rest.includes("--hard")) return "git reset --hard is denied";
  if ((subcommand === "checkout" || subcommand === "switch") && /\bmain\b|\bmaster\b/.test(rest)) {
    return "branch switch is denied";
  }
  if (subcommand === "clean") return "git clean is denied";
  if (subcommand === "status" || subcommand === "diff" || subcommand === "log" || subcommand === "rev-parse") {
    return null;
  }
  return "git command is denied";
}

function packageManagerReason(manager: string, subcommand: string): string | null {
  if (subcommand === "add" || subcommand === "install" || subcommand === "i") {
    return `Direct package installs are disabled; emit a DependencyIntent via harness MCP instead`;
  }
  if (subcommand === "test" || subcommand === "run" || subcommand === "exec") return null;
  return `${manager} command is denied`;
}

function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of segment.matchAll(pattern)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens.filter((token) => token.length > 0);
}
