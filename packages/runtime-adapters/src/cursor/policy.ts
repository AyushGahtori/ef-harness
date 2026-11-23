import { matchesWriteScope, resolveWorktreePath } from "./paths.js";
import type { BeforeShellInput, FileToolKind, HookDecision, HookScope, PreToolUseInput } from "./types.js";

const BLOCKED_SHELL: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /\bgit(?:\.exe)?\s+push\b/i, reason: "git push is denied" },
  { pattern: /\bpnpm(?:\.cmd|\.exe)?\s+add\b/i, reason: "pnpm add is denied" },
  { pattern: /\bcurl(?:\.exe)?\b/i, reason: "curl is denied" },
  { pattern: /\bwget(?:\.exe)?\b/i, reason: "wget is denied" },
  { pattern: /\bInvoke-WebRequest\b/i, reason: "Invoke-WebRequest is denied" },
  { pattern: /(?:^|\s)iwr(?:\.exe)?(?:\s|$)/i, reason: "Invoke-WebRequest is denied" },
  { pattern: /\bsudo\b/i, reason: "privilege escalation is denied" },
  { pattern: /\brunas\b/i, reason: "privilege escalation is denied" },
  { pattern: /Start-Process\b[\s\S]*-Verb\s+RunAs/i, reason: "privilege escalation is denied" },
  { pattern: /\bssh(?:\.exe)?\b/i, reason: "arbitrary host access is denied" },
];

const ALLOWED_SHELL = [
  /^(?:pnpm|npm)(?:\.cmd|\.exe)?\s+test(?:\s|$)/i,
  /^(?:pnpm|npm)(?:\.cmd|\.exe)?\s+run\s+(?:test|build|lint|typecheck)(?:\s|$)/i,
  /^(?:pnpm|npm)(?:\.cmd|\.exe)?\s+exec\s+(?:vitest|tsc|eslint)(?:\s|$)/i,
  /^npx(?:\.cmd|\.exe)?\s+(?:vitest|tsc|eslint)(?:\s|$)/i,
  /^vitest(?:\.cmd|\.exe)?(?:\s|$)/i,
  /^tsc(?:\.cmd|\.exe)?(?:\s|$)/i,
  /^eslint(?:\.cmd|\.exe)?(?:\s|$)/i,
  /^node(?:\.exe)?\s+--test(?:\s|$)/i,
];

export function decidePreToolUse(scope: HookScope, input: PreToolUseInput): Omit<HookDecision, "elapsedMs"> {
  if (scope.mode === "stripped" && input.kind !== "mcp") {
    return deny("stripped mode exposes harness MCP tools only");
  }
  if (input.kind === "web") {
    return deny("unproxied external web tools are blocked");
  }
  if (input.kind === "mcp") {
    const tool = input.mcpTool ?? input.toolName;
    if (!tool || !mcpAllowed(tool, scope.leasedTools)) {
      return deny("only the leased harness MCP server is allowed");
    }
    return allow("leased harness MCP tool");
  }
  if (!input.path) return deny("file tool is missing a path");
  const resolved = resolveWorktreePath(input.path, {
    worktree: scope.worktree,
    homeDir: scope.homeDir,
    ...(scope.realpath ? { realpath: scope.realpath } : {}),
  });
  if (resolved.secretHome) return deny("credential and personal Cursor paths are denied");
  if (resolved.hostDatabase) return deny("state.db is denied");
  if (resolved.containment === "symlink_escape") return deny("symlink escapes the attempt worktree");
  if (resolved.containment !== "inside" || !resolved.relative) {
    return deny("path escapes the attempt worktree");
  }
  if (isReadKind(input.kind)) return allow("read stays inside the attempt worktree");
  if (resolved.gitMetadata) return deny(".git metadata writes are denied");
  if (resolved.lockfile) return deny("lockfile writes are denied");
  if (!matchesWriteScope(resolved.relative, scope.writeScope)) {
    return deny("path is outside write_scope");
  }
  return allow("path is inside write_scope");
}

export function decideBeforeShell(
  scope: HookScope,
  input: BeforeShellInput,
): Omit<HookDecision, "elapsedMs"> {
  const command = input.command.trim();
  const blocked = BLOCKED_SHELL.find((entry) => entry.pattern.test(command));
  if (blocked) {
    return deny(`${blocked.reason}; local.sandboxOptions and the loopback proxy block non-provider egress`);
  }
  const segments = splitSegments(command);
  if (segments.length === 0) return deny("empty shell command is denied");
  const allowed = segments.every((segment) => ALLOWED_SHELL.some((pattern) => pattern.test(segment)));
  if (!allowed) return deny("only scoped build and test commands are allowed inside the sandbox");
  if (scope.mode === "stripped") {
    return {
      permission: "deny",
      effect: "redirect",
      reason: "stripped mode routes shell through harness.run",
      via: "harness.run",
    };
  }
  return allow("scoped build or test command inside the sandbox");
}

function allow(reason: string): Omit<HookDecision, "elapsedMs"> {
  return { permission: "allow", effect: "allow", reason };
}

function deny(reason: string): Omit<HookDecision, "elapsedMs"> {
  return { permission: "deny", effect: "deny", reason };
}

function isReadKind(kind: FileToolKind): boolean {
  return kind === "read" || kind === "search";
}

function mcpAllowed(tool: string, leased: readonly string[]): boolean {
  return leased.some((pattern) => {
    if (pattern.endsWith(".*")) return tool.startsWith(pattern.slice(0, -1));
    return tool === pattern;
  });
}

function splitSegments(command: string): string[] {
  const primary = command.split(/\s*(?:&&|\|\||;|\r?\n)\s*/);
  const segments: string[] = [];
  for (const piece of primary) {
    for (const piped of piece.split(/\s*\|\s*/)) {
      const trimmed = piped.trim();
      if (trimmed.length > 0) segments.push(trimmed);
    }
  }
  return segments;
}
