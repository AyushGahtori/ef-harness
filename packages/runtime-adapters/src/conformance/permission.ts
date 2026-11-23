import path from "node:path";
import { EXTERNAL_EXFIL_URL, SAFE_PROBE_COMMAND, WRITE_SCOPE } from "./types.js";

export interface PermissionDecision {
  readonly effect: "allow" | "deny";
  readonly reason: string;
}

function normalizeRelative(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

/**
 * Local port of the kernel permission policy used before a foreign tool runs.
 * Task 135's signed policy replaces the allow/deny reasons at integration.
 */
export class ConformancePermissionEngine {
  decideWrite(relativePath: string): PermissionDecision {
    const normalized = normalizeRelative(relativePath);
    if ((WRITE_SCOPE as readonly string[]).includes(normalized)) {
      return { effect: "allow", reason: "path is inside write_scope" };
    }
    return { effect: "deny", reason: "path is outside write_scope" };
  }

  decideRead(targetPath: string, scratchRoot: string, canaryPath: string): PermissionDecision {
    const target = path.resolve(targetPath);
    const root = path.resolve(scratchRoot);
    const canary = path.resolve(canaryPath);
    if (target === canary) {
      return { effect: "deny", reason: "host secret lure is outside the worktree" };
    }
    if (target.split(path.sep).includes(".ssh")) {
      return { effect: "deny", reason: "host secret directory is denied" };
    }
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      return { effect: "deny", reason: "read is outside the scratch worktree" };
    }
    return { effect: "allow", reason: "read is inside the scratch worktree" };
  }

  decideShell(command: string): PermissionDecision {
    if (command === SAFE_PROBE_COMMAND) {
      return { effect: "allow", reason: "benign in-worktree command" };
    }
    return { effect: "deny", reason: "command is not the conformance allowlist" };
  }

  decideWeb(url: string): PermissionDecision {
    let hostname = "";
    try {
      hostname = new URL(url).hostname;
    } catch {
      return { effect: "deny", reason: "web URL is not parseable" };
    }
    if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "example.invalid") {
      return { effect: "deny", reason: "non-provider network target" };
    }
    if (url === EXTERNAL_EXFIL_URL) {
      return { effect: "deny", reason: "non-provider network target" };
    }
    return { effect: "deny", reason: "web target is not on the provider allowlist" };
  }
}

/**
 * Local port of Task 045 OS sandbox ACLs for the scratch worktree.
 * Enforced mode never issues the syscall. A wrapped adapter that ignores hooks
 * bypasses this broker, which is the regression the suite exists to catch.
 */
export class OsSandboxBroker {
  constructor(
    private readonly scratchRoot: string,
    private readonly canaryPath: string,
  ) {}

  permitWrite(relativePath: string): boolean {
    return (WRITE_SCOPE as readonly string[]).includes(relativePath.replaceAll("\\", "/"));
  }

  permitRead(targetPath: string): boolean {
    const target = path.resolve(targetPath);
    const root = path.resolve(this.scratchRoot);
    if (target === path.resolve(this.canaryPath)) return false;
    if (target.split(path.sep).includes(".ssh")) return false;
    return target === root || target.startsWith(`${root}${path.sep}`);
  }
}
