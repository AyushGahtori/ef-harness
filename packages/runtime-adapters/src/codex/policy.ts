import path from "node:path";
import { canonicalize, defaultRealpath, hasCredentialSegment, isInside, isSealedRelative, toPosix } from "./paths.js";
import type { DeterministicSupervisionPolicyEnginePort } from "./ports.js";
import type { SupervisionDecision, SupervisionRequest } from "./types.js";

const DENIED_COMMANDS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /\bgit(?:\.exe)?\b[^|&;\n]*\bpush\b/i, reason: "git push is denied during a build" },
  { pattern: /\bpnpm(?:\.cmd)?\b[^|&;\n]*\badd\b/i, reason: "pnpm add is denied; emit a dependency intent" },
  { pattern: /\bnpm(?:\.cmd)?\b[^|&;\n]*\b(?:install|i)\b/i, reason: "npm install is denied; emit a dependency intent" },
  { pattern: /\byarn(?:\.cmd)?\b[^|&;\n]*\badd\b/i, reason: "yarn add is denied; emit a dependency intent" },
  { pattern: /\bcurl(?:\.exe)?\b/i, reason: "curl is denied" },
  { pattern: /\bwget(?:\.exe)?\b/i, reason: "wget is denied" },
  { pattern: /\bInvoke-WebRequest\b/i, reason: "Invoke-WebRequest is denied" },
  { pattern: /\bsudo\b/i, reason: "privilege escalation is denied" },
  { pattern: /\brunas\b/i, reason: "privilege escalation is denied" },
  { pattern: /\bgit(?:\.exe)?\b[^|&;\n]*\breset\b[^|&;\n]*--hard\b/i, reason: "git reset --hard is denied" },
  {
    pattern: /\bgit(?:\.exe)?\b[^|&;\n]*\bcheckout\b[^|&;\n]*\b(?:main|master)\b/i,
    reason: "git checkout of the integration branch is denied",
  },
  { pattern: /danger-full-access/i, reason: "danger-full-access is forbidden" },
  { pattern: /(?:^|\s)--yolo(?:\s|$)/i, reason: "--yolo is forbidden" },
];

const SAFE_COMMAND =
  /^(?:pnpm(?:\.cmd)?(?:\s+run)?\s+(?:test|lint|typecheck|build)|pnpm(?:\.cmd)?\s+exec\s+tsc|pnpm(?:\.cmd)?\s+test|npm(?:\.cmd)?\s+test|npx(?:\.cmd)?\s+vitest(?:\s+run)?|vitest(?:\s+run)?|tsc|node(?:\.exe)?\s+\S+)$/i;

export interface PolicyOptions {
  readonly realpath?: (target: string) => string;
  readonly caseFold?: boolean;
}

export class LocalDeterministicSupervisionPolicyEngine implements DeterministicSupervisionPolicyEnginePort {
  private readonly realpath: (target: string) => string;
  private readonly caseFold: boolean;

  constructor(options: PolicyOptions = {}) {
    this.realpath = options.realpath ?? defaultRealpath;
    this.caseFold = options.caseFold ?? process.platform === "win32";
  }

  decide(input: {
    readonly worktreeRoot: string;
    readonly writeScope: readonly string[];
    readonly request: SupervisionRequest;
  }): SupervisionDecision {
    const started = performance.now();
    const decision =
      input.request.kind === "shell"
        ? this.decideShell(input.request.command)
        : this.decideEdit(input.worktreeRoot, input.writeScope, input.request.path);
    return { ...decision, elapsedMs: performance.now() - started };
  }

  private decideEdit(
    worktreeRoot: string,
    writeScope: readonly string[],
    requested: string,
  ): { readonly effect: "allow" | "deny"; readonly reason: string } {
    if (hasCredentialSegment(requested)) {
      return { effect: "deny", reason: "credential path is denied" };
    }
    const root = canonicalize(worktreeRoot, this.realpath);
    const lexical = path.isAbsolute(requested) ? requested : path.resolve(worktreeRoot, requested);
    const absolute = canonicalize(lexical, this.realpath);
    if (hasCredentialSegment(absolute)) {
      return { effect: "deny", reason: "credential path is denied" };
    }
    if (!isInside(root, absolute)) {
      return { effect: "deny", reason: "path escapes the attempt worktree" };
    }
    const relative = toPosix(path.relative(root, absolute));
    if (isSealedRelative(relative)) {
      return { effect: "deny", reason: "sealed path is denied" };
    }
    const allowed = writeScope.some((pattern) => globMatch(pattern, relative, this.caseFold));
    if (!allowed) {
      return { effect: "deny", reason: "path is outside write_scope" };
    }
    return { effect: "allow", reason: "path is inside write_scope" };
  }

  private decideShell(command: string): { readonly effect: "allow" | "deny"; readonly reason: string } {
    const trimmed = command.trim();
    for (const rule of DENIED_COMMANDS) {
      if (rule.pattern.test(trimmed)) return { effect: "deny", reason: rule.reason };
    }
    if (SAFE_COMMAND.test(trimmed)) {
      return { effect: "allow", reason: "command is an approved build or test" };
    }
    return { effect: "deny", reason: "command is not an approved build or test" };
  }
}

function globMatch(pattern: string, relativePosix: string, caseFold: boolean): boolean {
  const placeholder = "\u0000";
  const source = pattern
    .replaceAll("\\", "/")
    .replaceAll("**", placeholder)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll(placeholder, "\u0001")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0001", ".*");
  return new RegExp(`^${source}$`, caseFold ? "i" : "").test(relativePosix);
}
