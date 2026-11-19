import path from "node:path";

export type PermissionEffect = "allow" | "deny";

export type PolicyKind = "read" | "search" | "edit" | "shell" | "web" | "mcp" | "other";

export interface PermissionPolicy {
  readonly scratchRoot: string;
  readonly writeScope: readonly string[];
  readonly commandAllowlist: readonly string[];
}

export interface PermissionQuery {
  readonly kind: PolicyKind;
  readonly tool: string;
  readonly path?: string;
  readonly command?: string;
}

export interface PermissionDecision {
  readonly effect: PermissionEffect;
  readonly rule: string;
}

const CREDENTIAL_SEGMENTS = new Set([".claude", ".gemini", ".ssh", ".aws"]);

const SHELL_PIPE =
  /\b(?:curl|wget|invoke-webrequest)(?:\.exe)?\b[\s\S]*\|\s*(?:sh|bash|pwsh|powershell|cmd)(?:\.exe)?\b/i;

const HARD_DENY_COMMANDS = [
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\b/i,
  /\brm\s+-rf\s+\//i,
  /\bremove-item\b[\s\S]*-recurse/i,
];

function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function globToRegExp(pattern: string): RegExp {
  const doubled = "\u0000";
  const source = pattern
    .replaceAll("**", doubled)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll(doubled, "\u0001")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0001", ".*");
  return new RegExp(`^${source}$`, "i");
}

export function isCredentialPath(filePath: string): boolean {
  const segments = normalizeSlashes(filePath).split("/");
  return segments.some((segment) => CREDENTIAL_SEGMENTS.has(segment));
}

function isInsideScratch(scratchRoot: string, filePath: string): boolean {
  const root = path.resolve(scratchRoot);
  const target = path.resolve(root, filePath);
  const relative = path.relative(root, target);
  if (relative === "") return true;
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return true;
}

function relativeToScratch(scratchRoot: string, filePath: string): string {
  const root = path.resolve(scratchRoot);
  const target = path.resolve(root, filePath);
  return normalizeSlashes(path.relative(root, target));
}

function matchesWriteScope(policy: PermissionPolicy, filePath: string): boolean {
  if (!isInsideScratch(policy.scratchRoot, filePath)) return false;
  if (isCredentialPath(filePath)) return false;
  const relative = relativeToScratch(policy.scratchRoot, filePath);
  return policy.writeScope.some((pattern) => globToRegExp(normalizeSlashes(pattern)).test(relative));
}

function commandAllowed(policy: PermissionPolicy, command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  return policy.commandAllowlist.some((pattern) => {
    if (pattern === "*") return true;
    if (trimmed === pattern) return true;
    return trimmed.startsWith(`${pattern} `) || globToRegExp(pattern).test(trimmed);
  });
}

function decideCommand(policy: PermissionPolicy, command: string): PermissionDecision {
  if (SHELL_PIPE.test(command)) {
    return { effect: "deny", rule: "deny-shell-pipe" };
  }
  if (HARD_DENY_COMMANDS.some((pattern) => pattern.test(command))) {
    return { effect: "deny", rule: "deny-dangerous-command" };
  }
  if (commandAllowed(policy, command)) {
    return { effect: "allow", rule: "command-allowlist" };
  }
  return { effect: "deny", rule: "command-not-allowlisted" };
}

function decideWrite(policy: PermissionPolicy, filePath: string): PermissionDecision {
  if (!filePath.trim()) {
    return { effect: "deny", rule: "missing-write-path" };
  }
  if (isCredentialPath(filePath)) {
    return { effect: "deny", rule: "deny-credential-path" };
  }
  if (!isInsideScratch(policy.scratchRoot, filePath)) {
    return { effect: "deny", rule: "deny-outside-scratch" };
  }
  if (!matchesWriteScope(policy, filePath)) {
    return { effect: "deny", rule: "deny-outside-write-scope" };
  }
  return { effect: "allow", rule: "write-scope" };
}

/**
 * Pure allow/deny rules. No model call, no filesystem read, no clock.
 */
export function decidePermission(policy: PermissionPolicy, query: PermissionQuery): PermissionDecision {
  if (query.kind === "web") {
    return { effect: "deny", rule: "deny-web" };
  }
  if (query.kind === "shell") {
    return decideCommand(policy, query.command ?? "");
  }
  if (query.kind === "edit") {
    return decideWrite(policy, query.path ?? "");
  }
  if (query.kind === "mcp") {
    return { effect: "allow", rule: "harness-mcp" };
  }
  if (query.kind === "read" || query.kind === "search") {
    if (query.path && isCredentialPath(query.path)) {
      return { effect: "deny", rule: "deny-credential-path" };
    }
    return { effect: "allow", rule: "read-allow" };
  }
  return { effect: "deny", rule: "default-deny" };
}

export function pathFromUnknown(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.path === "string") return record.path;
  if (typeof record.file_path === "string") return record.file_path;
  if (typeof record.filePath === "string") return record.filePath;
  if (typeof record.grantRoot === "string") return record.grantRoot;
  return "";
}

export function commandFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.command === "string") return record.command;
  if (typeof record.cmd === "string") return record.cmd;
  return "";
}
