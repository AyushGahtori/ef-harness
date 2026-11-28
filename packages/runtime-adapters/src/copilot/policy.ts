import fs from "node:fs";
import path from "node:path";
import type { PolicyContext, PolicyDecision } from "./types.js";

const SECRET_SEGMENTS = new Set([
  ".ssh",
  ".aws",
  ".gnupg",
  ".claude",
  ".codex",
  ".gemini",
]);

const SECRET_FILES = new Set(["id_rsa", "id_ed25519", "state.db", "global.db"]);

const LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]);

const SHELL_DENY: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /\bgit(?:\.exe)?\s+push\b/i, reason: "git push is reserved for the ship phase" },
  { pattern: /\bgh\s+pr\s+create\b/i, reason: "pull requests are reserved for the ship phase" },
  { pattern: /\bpnpm(?:\.cmd)?\s+add\b/i, reason: "direct package installs are disabled" },
  { pattern: /\bnpm(?:\.cmd)?\s+install\b/i, reason: "direct package installs are disabled" },
  { pattern: /\byarn(?:\.cmd)?\s+add\b/i, reason: "direct package installs are disabled" },
  { pattern: /\b(?:curl|wget|iwr)\b/i, reason: "unproxied web call" },
  { pattern: /\bInvoke-WebRequest\b/i, reason: "unproxied web call" },
  { pattern: /\b(?:sudo|runas)\b/i, reason: "privilege escalation is denied" },
];

const APPROVED_COMMAND =
  /^(?:pnpm|npm)(?:\.cmd)?\s+(?:run\s+)?(?:test|build)\b|^(?:npx\s+)?vitest\b|^tsc\b|^eslint\b|^node\s+--test\b/i;

export interface PathResolver {
  exists(target: string): boolean;
  realpath(target: string): string;
}

export class NodePathResolver implements PathResolver {
  exists(target: string): boolean {
    return fs.existsSync(target);
  }

  realpath(target: string): string {
    return fs.realpathSync.native(target);
  }
}

/**
 * Local stand-in for Task 142 `DeterministicSupervisionPolicyEngine`.
 * Swap the class at integration; `decide` stays synchronous and free of model calls.
 */
export class LocalDeterministicSupervisionPolicyEngine {
  private readonly resolved = new Map<string, string>();

  constructor(private readonly paths: PathResolver = new NodePathResolver()) {}

  decide(input: PolicyContext): PolicyDecision {
    const request = input.request;
    if (request.kind === "shell") return this.decideShell(input);
    if (request.kind === "web") return deny("unproxied web call");
    if (request.kind === "mcp") return this.decideMcp(input);
    return this.decidePath(input);
  }

  private decideShell(input: PolicyContext): PolicyDecision {
    const command = (input.request.command ?? "").replace(/\s+/g, " ").trim();
    if (!command) return deny("shell command is empty");
    for (const rule of SHELL_DENY) {
      if (rule.pattern.test(command)) return deny(rule.reason);
    }
    if (input.posture === "stripped") {
      return deny("stripped posture denies built-in shell tools; use harness.run");
    }
    if (APPROVED_COMMAND.test(command)) return allow("approved test or build command");
    return deny("shell command is not an approved test or build");
  }

  private decideMcp(input: PolicyContext): PolicyDecision {
    const tool = input.request.tool ?? "";
    if (!tool) return deny("mcp tool name is empty");
    const leased = input.leasedTools.some((entry) =>
      entry === "kb.*" ? tool.startsWith("kb.") : tool === entry,
    );
    if (!leased) return deny("mcp tool is outside the leased harness server");
    return allow("leased harness mcp tool");
  }

  private decidePath(input: PolicyContext): PolicyDecision {
    const requested = input.request.path ?? "";
    if (!requested) return deny("path is empty");
    if (hasSecret(requested)) return deny("secret or host credential path");
    const contained = this.contain(input.worktree, requested);
    if ("deny" in contained) return deny(contained.deny);
    if (hasSecret(contained.relative)) return deny("secret or host credential path");
    if (input.request.kind === "read") return allow("in-scope worktree read");
    if (isSealedWrite(contained.relative)) return deny("sealed worktree path");
    if (!inWriteScope(contained.relative, input.writeScope)) return deny("outside write scope");
    return allow("in-scope worktree edit");
  }

  private contain(
    worktree: string,
    requested: string,
  ): { readonly relative: string } | { readonly deny: string } {
    const root = this.resolveExisting(path.resolve(worktree));
    const expanded = expandHome(requested);
    const absolute = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(root, expanded);
    const resolved = this.resolveExisting(absolute);
    if (hasSecret(resolved) || hasSecret(requested)) return { deny: "secret or host credential path" };
    const relative = path.relative(root, resolved);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      return {
        deny:
          requested.includes(".ssh") || hasSecret(requested)
            ? "secret or host credential path"
            : "host read outside the attempt worktree",
      };
    }
    return { relative: relative.split(path.sep).join("/") };
  }

  private resolveExisting(target: string): string {
    const cached = this.resolved.get(target);
    if (cached !== undefined) return cached;
    let resolved = target;
    if (this.paths.exists(target)) {
      try {
        resolved = this.paths.realpath(target);
      } catch {
        resolved = target;
      }
    }
    this.resolved.set(target, resolved);
    return resolved;
  }
}

function allow(reason: string): PolicyDecision {
  return { effect: "allow", reason };
}

function deny(reason: string): PolicyDecision {
  return { effect: "deny", reason };
}

function expandHome(input: string): string {
  if (input === "~") return homeDir();
  if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(homeDir(), input.slice(2));
  return input;
}

function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || "";
}

function hasSecret(input: string): boolean {
  for (const segment of input.split(/[\\/]/)) {
    const folded = segment.toLowerCase();
    if (SECRET_SEGMENTS.has(folded) || SECRET_FILES.has(folded)) return true;
  }
  return false;
}

function isSealedWrite(relative: string): boolean {
  const folded = relative.toLowerCase();
  const segments = folded.split("/");
  if (segments.includes(".git") || segments.includes(".harness") || segments.includes(".ef-copilot")) {
    return true;
  }
  const base = segments.at(-1) ?? "";
  return LOCKFILES.has(base);
}

function inWriteScope(relative: string, writeScope: readonly string[]): boolean {
  const folded = relative.toLowerCase();
  return writeScope.some((entry) => matchesScope(folded, entry.replaceAll("\\", "/").toLowerCase()));
}

function matchesScope(relative: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return relative === prefix || relative.startsWith(`${prefix}/`);
  }
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    if (!relative.startsWith(`${prefix}/`)) return false;
    return !relative.slice(prefix.length + 1).includes("/");
  }
  return relative === pattern;
}
