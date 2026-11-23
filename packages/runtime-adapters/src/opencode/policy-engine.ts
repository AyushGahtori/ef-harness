import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { OpenCodeAdapterError } from "./errors.js";

const LOCKFILES = new Set(["package-lock.json", "pnpm-lock.yaml"]);
const SECRET_SEGMENTS = new Set([".ssh", ".aws", ".gnupg", ".claude", ".codex", ".gemini"]);

export interface PolicyInput {
  readonly worktreePath: string;
  readonly writeScope: readonly string[];
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly repeatCount: number;
}

export interface PolicyDecision {
  readonly decision: "allow" | "deny";
  readonly acpOutcome: "allow_once" | "reject_once";
  readonly reason: string;
  readonly elapsedMs: number;
}

function globMatch(pattern: string, value: string): boolean {
  let expression = "^";
  let index = 0;
  const source = pattern.replaceAll("\\", "/");
  while (index < source.length) {
    if (source.startsWith("**/", index)) {
      expression += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (source.startsWith("**", index)) {
      expression += ".*";
      index += 2;
      continue;
    }
    const char = source[index] ?? "";
    if (char === "*") {
      expression += "[^/]*";
      index += 1;
      continue;
    }
    if ("\\^$+?.()|{}[]".includes(char)) {
      expression += `\\${char}`;
    } else {
      expression += char;
    }
    index += 1;
  }
  expression += "$";
  return new RegExp(expression, "i").test(value);
}

function segments(filePath: string): string[] {
  return filePath.split(/[/\\]+/).filter((part) => part.length > 0);
}

function canonicalize(target: string): string {
  const absolute = path.resolve(target);
  const missing: string[] = [];
  let cursor = absolute;
  const seen = new Set<string>();
  while (!fs.existsSync(cursor)) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missing.push(path.basename(cursor));
    cursor = parent;
  }
  let real = cursor;
  try {
    real = fs.realpathSync.native(cursor);
  } catch {
    real = cursor;
  }
  return missing.length === 0 ? real : path.join(real, ...missing.reverse());
}

function readArg(args: Readonly<Record<string, unknown>>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

/**
 * Local stand-in for Task 142 `DeterministicSupervisionPolicyEngine`.
 * Decisions are pure kernel checks. The integrator replaces this class
 * with the core engine; call shape stays `decide(input) -> allow_once | reject_once`.
 */
export class LocalDeterministicSupervisionPolicyEngine {
  private readonly worktreeCache = new Map<string, string>();
  private readonly pathCache = new Map<string, string>();

  warm(worktreePath: string): void {
    this.worktreeReal(worktreePath);
  }

  decide(input: PolicyInput): PolicyDecision {
    const started = performance.now();
    const outcome = this.evaluate(input);
    const elapsedMs = performance.now() - started;
    return { ...outcome, elapsedMs };
  }

  private evaluate(input: PolicyInput): Omit<PolicyDecision, "elapsedMs"> {
    if (input.repeatCount >= 3) {
      return this.deny("doom_loop");
    }
    const tool = input.tool.toLowerCase();
    if (tool === "doom_loop") return this.deny("doom_loop");
    if (tool === "bash" || tool === "shell" || tool === "execute") {
      return this.deny("built-in shell is denied; route the command through harness.run");
    }
    if (tool === "webfetch" || tool === "websearch" || tool === "fetch") {
      return this.deny("built-in web tools are denied; they bypass the loopback allowlist proxy");
    }
    if (tool === "external_directory") {
      return this.deny("external_directory");
    }
    if (tool === "harness.run") {
      return this.decideHarnessRun(readArg(input.args, ["command", "cmd"]));
    }
    if (tool.startsWith("kb.") || tool === "harness.read_result") {
      return this.allow("leased harness MCP tool");
    }
    if (tool === "edit" || tool === "write") {
      return this.decideWrite(input);
    }
    if (tool === "read") {
      return this.decideRead(input);
    }
    return this.deny("unclassified tool");
  }

  private decideHarnessRun(command: string): Omit<PolicyDecision, "elapsedMs"> {
    const normalized = command.trim().toLowerCase();
    if (
      normalized.startsWith("git push") ||
      normalized.startsWith("git reset --hard") ||
      normalized.startsWith("curl ") ||
      normalized.startsWith("wget ") ||
      normalized.startsWith("invoke-webrequest") ||
      normalized.includes("rm -rf /")
    ) {
      return this.deny("harness.run rejected a blocked command");
    }
    return this.allow("routed through harness.run");
  }

  private decideWrite(input: PolicyInput): Omit<PolicyDecision, "elapsedMs"> {
    const candidate = readArg(input.args, ["path", "file", "filePath", "file_path"]);
    if (!candidate) return this.deny("edit is missing a path");
    const located = this.locate(input.worktreePath, candidate);
    if (!located.inside) return this.deny("path_escape");
    if (this.blockedRelative(located.relativePosix)) return this.deny("protected path");
    const allowed = input.writeScope.some((pattern) => globMatch(pattern, located.relativePosix));
    if (!allowed) return this.deny("outside write_scope");
    return this.allow("write_scope");
  }

  private decideRead(input: PolicyInput): Omit<PolicyDecision, "elapsedMs"> {
    const candidate = readArg(input.args, ["path", "file", "filePath", "file_path"]);
    if (!candidate) return this.deny("read is missing a path");
    const located = this.locate(input.worktreePath, candidate);
    if (!located.inside) return this.deny("path_escape");
    if (this.secretSegment(located.canonical) || this.blockedRelative(located.relativePosix)) {
      return this.deny("protected path");
    }
    return this.allow("worktree read");
  }

  private locate(
    worktreePath: string,
    candidate: string,
  ): { readonly inside: boolean; readonly relativePosix: string; readonly canonical: string } {
    const root = this.worktreeReal(worktreePath);
    const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(root, candidate);
    const cacheKey = absolute.toLowerCase();
    let canonical = this.pathCache.get(cacheKey);
    if (!canonical) {
      canonical = canonicalize(absolute);
      this.pathCache.set(cacheKey, canonical);
    }
    const relative = path.relative(root, canonical);
    const inside = relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
    return {
      inside,
      relativePosix: relative.split(path.sep).join("/"),
      canonical,
    };
  }

  private worktreeReal(worktreePath: string): string {
    const key = path.resolve(worktreePath);
    const cached = this.worktreeCache.get(key);
    if (cached) return cached;
    if (!fs.existsSync(key)) {
      throw new OpenCodeAdapterError("worktree_missing", `worktree does not exist: ${key}`);
    }
    const real = fs.realpathSync.native(key);
    this.worktreeCache.set(key, real);
    return real;
  }

  private blockedRelative(relativePosix: string): boolean {
    const parts = segments(relativePosix).map((part) => part.toLowerCase());
    if (parts.some((part) => part === ".git" || part === ".harness" || SECRET_SEGMENTS.has(part))) return true;
    const base = parts[parts.length - 1] ?? "";
    return LOCKFILES.has(base);
  }

  private secretSegment(canonical: string): boolean {
    return segments(canonical).some((part) => SECRET_SEGMENTS.has(part.toLowerCase()));
  }

  private deny(reason: string): Omit<PolicyDecision, "elapsedMs"> {
    return { decision: "deny", acpOutcome: "reject_once", reason };
  }

  private allow(reason: string): Omit<PolicyDecision, "elapsedMs"> {
    return { decision: "allow", acpOutcome: "allow_once", reason };
  }
}
