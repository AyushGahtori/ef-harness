import path from "node:path";
import { isBlockedWriteRelative, resolveAgainstWorktree, scopeAllows } from "./paths.js";
import type { PolicyDecision, SupervisionRequest } from "./types.js";

export interface PolicyContext {
  readonly worktreeRoot: string;
  readonly writeScope: readonly string[];
  readonly homeDir: string;
  readonly appData?: string;
  readonly readOnlyRoots?: readonly string[];
  readonly leasedTools?: readonly string[];
  readonly caseFold?: boolean;
}

const DEPENDENCY_DENY =
  "Direct package installs are disabled; emit a DependencyIntent via harness MCP instead";

/**
 * Local stand-in for Task 142 `DeterministicSupervisionPolicyEngine`.
 * Pure synchronous decisions. Swap the class at integration.
 */
export class DeterministicSupervisionPolicyEngine {
  evaluate(request: SupervisionRequest, context: PolicyContext): PolicyDecision {
    const started = performance.now();
    const decision = this.decide(request, context);
    const elapsedMs = performance.now() - started;
    if (decision.effect === "allow") return { effect: "allow", elapsedMs };
    return { effect: "deny", reason: decision.reason, elapsedMs };
  }

  private decide(
    request: SupervisionRequest,
    context: PolicyContext,
  ): { readonly effect: "allow" } | { readonly effect: "deny"; readonly reason: string } {
    if (request.kind === "shell") return this.decideShell(request.command);
    if (request.kind === "web") {
      return {
        effect: "deny",
        reason: "Unproxied web fetch and web search are disabled; use the harness allowlist proxy",
      };
    }
    if (request.kind === "mcp") {
      if (!toolLeased(request.tool, context.leasedTools ?? [])) {
        return { effect: "deny", reason: "MCP tool is not on the attempt lease" };
      }
      return { effect: "allow" };
    }
    return this.decidePath(request.kind, request.path, context);
  }

  private decideShell(
    command: string,
  ): { readonly effect: "allow" } | { readonly effect: "deny"; readonly reason: string } {
    const trimmed = command.trim();
    if (!trimmed) return { effect: "deny", reason: "Empty shell commands are disabled" };
    const denied = shellDenial(trimmed);
    if (denied) return { effect: "deny", reason: denied };
    if (SAFE_SHELL.test(trimmed)) return { effect: "allow" };
    return {
      effect: "deny",
      reason: "Command is not on the allowlist; use harness.run inside the sandbox",
    };
  }

  private decidePath(
    kind: "write" | "edit" | "delete" | "read",
    requested: string,
    context: PolicyContext,
  ): { readonly effect: "allow" } | { readonly effect: "deny"; readonly reason: string } {
    const resolved = resolveAgainstWorktree(requested, {
      worktreeRoot: context.worktreeRoot,
      cwd: context.worktreeRoot,
      homeDir: context.homeDir,
      ...(context.appData ? { appData: context.appData } : {}),
    });
    if (resolved.credential) {
      return { effect: "deny", reason: "Reads and writes of credential directories are disabled" };
    }
    if (resolved.appData) {
      return { effect: "deny", reason: "Reads and writes under application data are disabled" };
    }
    if (resolved.hostDatabase) {
      return { effect: "deny", reason: "Host state.db and global.db are disabled" };
    }
    if (resolved.containment === "symlink_escape") {
      return { effect: "deny", reason: "Path escapes the attempt worktree through a symlink" };
    }
    if (resolved.containment !== "inside" || !resolved.relative) {
      if (kind === "read" && insideAny(resolved.absolute, context.readOnlyRoots ?? [])) {
        return { effect: "allow" };
      }
      return { effect: "deny", reason: "Path is outside the attempt worktree" };
    }
    if (kind === "read") {
      return { effect: "allow" };
    }
    const blocked = isBlockedWriteRelative(resolved.relative);
    if (blocked) return { effect: "deny", reason: blocked };
    const caseFold = context.caseFold ?? true;
    if (!scopeAllows(resolved.relative, context.writeScope, caseFold)) {
      return { effect: "deny", reason: "Path is outside the task write scope" };
    }
    return { effect: "allow" };
  }
}

function insideAny(target: string, roots: readonly string[]): boolean {
  const resolved = path.resolve(target);
  return roots.some((root) => {
    const base = path.resolve(root);
    const relative = path.relative(base, resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function shellDenial(command: string): string | null {
  if (/\bcurl(\.exe)?\b/i.test(command) || /\bwget(\.exe)?\b/i.test(command)) {
    return "Network exfiltration commands are disabled";
  }
  if (/\b(invoke-webrequest|invoke-restmethod|iwr|irm)\b/i.test(command)) {
    return "Network exfiltration commands are disabled";
  }
  if (/\b(sudo|runas)\b/i.test(command)) return "Privilege escalation is disabled";
  if (/\bgit\s+push\b/i.test(command)) return "git push is disabled during harness builds";
  if (/\bgit\s+reset\s+--hard\b/i.test(command)) return "git reset --hard is disabled";
  if (/\bgit\s+(checkout|switch)\s+(main|master)\b/i.test(command)) {
    return "Switching to the main branch is disabled";
  }
  if (/\b(npm\s+(install|i|add)|pnpm\s+add|yarn\s+add)\b/i.test(command)) return DEPENDENCY_DENY;
  return null;
}

const SAFE_SHELL =
  /^(?:(?:pnpm|npm)\s+(?:test|run|exec|lint|build|typecheck)\b|pnpm\s+--filter\b|(?:vitest|tsc|eslint)\b|git\s+(?:status|diff|log|show)\b)/i;

export function toolLeased(tool: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith(".*")) return tool.startsWith(pattern.slice(0, -1));
    return tool === pattern;
  });
}
