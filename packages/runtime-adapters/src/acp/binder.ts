import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SkillMountDeniedError } from "./errors.js";
import { isInsideWorktree } from "./paths.js";
import type { SkillMountInput } from "./types.js";

export const DEFAULT_MCP_TOOLS = ["kb.*", "harness.run", "harness.read_result"] as const;

const GLOBAL_CONFIG_SEGMENTS = new Set([".config", ".claude", ".codex", ".gemini", ".copilot"]);

export interface McpLease {
  readonly leaseId: string;
  readonly endpoint: string;
  readonly bearerToken: string;
  readonly tools: readonly string[];
}

export interface LeasedMcpPort {
  lease(input: {
    readonly sessionId: string;
    readonly attemptId: string;
    readonly taskId: string;
    readonly tools: readonly string[];
  }): McpLease | Promise<McpLease>;
  revoke(leaseId: string): void | Promise<void>;
}

/** Local port of Task 048 `AttemptMcpServer` (Task 143's text names Task 049). */
export class LocalLeasedMcpServer implements LeasedMcpPort {
  private readonly leases = new Map<string, McpLease & { revoked: boolean }>();
  private nextId = 1;

  lease(input: {
    readonly sessionId: string;
    readonly attemptId: string;
    readonly taskId: string;
    readonly tools: readonly string[];
  }): McpLease {
    const leaseId = `lease-${input.attemptId}-${this.nextId}`;
    this.nextId += 1;
    const lease: McpLease & { revoked: boolean } = {
      leaseId,
      endpoint: `http://127.0.0.1/mcp/${input.attemptId}`,
      bearerToken: `ef_attempt_${input.attemptId}_${this.nextId}`,
      tools: input.tools,
      revoked: false,
    };
    this.leases.set(leaseId, lease);
    return { leaseId, endpoint: lease.endpoint, bearerToken: lease.bearerToken, tools: lease.tools };
  }

  revoke(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease) return;
    this.leases.set(leaseId, { ...lease, revoked: true, bearerToken: "" });
  }

  isRevoked(leaseId: string): boolean {
    return this.leases.get(leaseId)?.revoked === true;
  }
}

export interface SkillMountResult {
  readonly mountPath: string;
  readonly excludePath: string;
  readonly skillIds: readonly string[];
  readonly files: readonly string[];
}

export interface SkillMounterPort {
  mount(request: {
    readonly worktreeRoot: string;
    readonly attemptId: string;
    readonly skills: readonly SkillMountInput[];
  }): SkillMountResult;
}

/** Local port of Task 078 `SkillMounter.mount`. */
export class LocalSkillMounter implements SkillMounterPort {
  mount(request: {
    readonly worktreeRoot: string;
    readonly attemptId: string;
    readonly skills: readonly SkillMountInput[];
  }): SkillMountResult {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(request.attemptId)) {
      throw new SkillMountDeniedError("outside_worktree", `invalid attempt id ${request.attemptId}`);
    }
    const worktreeRoot = path.resolve(request.worktreeRoot);
    const mountPath = path.resolve(worktreeRoot, ".ef-skills", request.attemptId);
    if (isGlobalConfigPath(worktreeRoot) || isGlobalConfigPath(mountPath)) {
      throw new SkillMountDeniedError("global_config", `refusing to mount into a user config directory: ${mountPath}`);
    }
    if (!fs.existsSync(worktreeRoot) || !fs.statSync(worktreeRoot).isDirectory()) {
      throw new SkillMountDeniedError("outside_worktree", `worktree is missing: ${worktreeRoot}`);
    }
    if (request.skills.length > 2) {
      throw new SkillMountDeniedError("too_many_skills", "at most 2 skills can be mounted");
    }
    for (const skill of request.skills) {
      if (!skill.vetted) throw new SkillMountDeniedError("not_vetted", `${skill.skillId} is not vetted`);
    }
    assertMountAllowed(worktreeRoot, mountPath);
    const excludePath = ensureExclude(worktreeRoot, [".ef-skills/", ".ef-mcp/"]);
    const files: string[] = [];
    for (const skill of request.skills) {
      for (const file of skill.files) {
        const relative = file.relativePath.replaceAll("\\", "/");
        if (!relative || relative.split("/").some((segment) => segment === ".." || segment === ".")) {
          throw new SkillMountDeniedError("outside_worktree", `skill path escapes the mount: ${relative}`);
        }
        const destination = path.resolve(mountPath, skill.skillId, relative);
        assertMountAllowed(worktreeRoot, destination);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, file.text, "utf8");
        files.push(destination);
      }
    }
    return {
      mountPath,
      excludePath,
      skillIds: request.skills.map((skill) => skill.skillId),
      files,
    };
  }
}

export interface MountedAttempt {
  readonly skillMountPath: string | null;
  readonly mcpHelperPath: string | null;
  readonly leaseId: string | null;
  readonly files: readonly string[];
}

/**
 * Registers the per-attempt MCP lease on `session/new` and stages vetted skills
 * inside the worktree. `cleanupEphemeralMounts` deletes those files before diff capture.
 */
export class AcpMcpAndSkillBinder {
  private readonly mounted = new Map<string, MountedAttempt>();

  constructor(
    private readonly mcp: LeasedMcpPort,
    private readonly skills: SkillMounterPort,
  ) {}

  async bind(input: {
    readonly sessionId: string;
    readonly attemptId: string;
    readonly taskId: string;
    readonly worktreeRoot: string;
    readonly tools: readonly string[];
    readonly skills: readonly SkillMountInput[];
    readonly mcpType?: "http" | "sse";
  }): Promise<{
    readonly mcpServers: readonly {
      readonly name: string;
      readonly type: "http" | "sse";
      readonly url: string;
      readonly headers: readonly { readonly name: string; readonly value: string }[];
      readonly tools: readonly string[];
    }[];
    readonly bearerToken: string;
    readonly leaseId: string;
    readonly mount: SkillMountResult | null;
  }> {
    if (input.skills.length > 2) {
      throw new SkillMountDeniedError("too_many_skills", "at most 2 skills can be mounted");
    }
    const lease = await this.mcp.lease({
      sessionId: input.sessionId,
      attemptId: input.attemptId,
      taskId: input.taskId,
      tools: input.tools,
    });
    const mount = input.skills.length === 0 ? null : this.skills.mount(input);
    if (mount && !isInsideWorktree(input.worktreeRoot, mount.mountPath)) {
      throw new SkillMountDeniedError("outside_worktree", "skill mount escaped the worktree");
    }
    const helper = writeMcpHelper(input.worktreeRoot, input.attemptId, {
      leaseId: lease.leaseId,
      endpoint: lease.endpoint,
      tools: lease.tools,
    });
    this.mounted.set(input.sessionId, {
      skillMountPath: mount?.mountPath ?? null,
      mcpHelperPath: helper,
      leaseId: lease.leaseId,
      files: [...(mount?.files ?? []), helper],
    });
    return {
      bearerToken: lease.bearerToken,
      leaseId: lease.leaseId,
      mount,
      mcpServers: [
        {
          name: "ef-harness",
          type: input.mcpType ?? "http",
          url: lease.endpoint,
          headers: [{ name: "Authorization", value: `Bearer ${lease.bearerToken}` }],
          tools: lease.tools,
        },
      ],
    };
  }

  async cleanupEphemeralMounts(sessionId: string, worktreeRoot: string): Promise<{ removed: string[] }> {
    const known = this.mounted.get(sessionId);
    const removed: string[] = [];
    const targets = [
      known?.skillMountPath ?? null,
      known?.mcpHelperPath ?? null,
      path.join(worktreeRoot, ".ef-skills"),
      path.join(worktreeRoot, ".ef-mcp"),
    ];
    for (const target of targets) {
      if (!target || !isStrictlyInside(worktreeRoot, target)) continue;
      if (!fs.existsSync(target)) continue;
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(target);
    }
    if (known?.leaseId) await this.mcp.revoke(known.leaseId);
    this.mounted.set(sessionId, {
      skillMountPath: null,
      mcpHelperPath: null,
      leaseId: known?.leaseId ?? null,
      files: [],
    });
    return { removed };
  }

  snapshot(sessionId: string): MountedAttempt | null {
    return this.mounted.get(sessionId) ?? null;
  }
}

function writeMcpHelper(
  worktreeRoot: string,
  attemptId: string,
  body: { leaseId: string; endpoint: string; tools: readonly string[] },
): string {
  const helper = path.join(worktreeRoot, ".ef-mcp", attemptId, "endpoint.json");
  if (!isInsideWorktree(worktreeRoot, helper)) {
    throw new SkillMountDeniedError("outside_worktree", "mcp helper escaped the worktree");
  }
  ensureExclude(worktreeRoot, [".ef-skills/", ".ef-mcp/"]);
  fs.mkdirSync(path.dirname(helper), { recursive: true });
  fs.writeFileSync(
    helper,
    JSON.stringify({ leaseId: body.leaseId, endpoint: body.endpoint, tools: body.tools }, null, 2),
    "utf8",
  );
  return helper;
}

function assertMountAllowed(worktreeRoot: string, target: string): void {
  if (isGlobalConfigPath(target)) {
    throw new SkillMountDeniedError("global_config", `refusing to mount into a user config directory: ${target}`);
  }
  if (!isInsideWorktree(worktreeRoot, target)) {
    throw new SkillMountDeniedError("outside_worktree", `mount path is outside the worktree: ${target}`);
  }
}

function isStrictlyInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return true;
}

function isGlobalConfigPath(target: string): boolean {
  const home = path.resolve(os.homedir());
  const relative = path.relative(home, path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return relative.split(path.sep).some((segment) => GLOBAL_CONFIG_SEGMENTS.has(segment.toLowerCase()));
}

function ensureExclude(worktreeRoot: string, directories: readonly string[]): string {
  const excludePath = path.join(worktreeRoot, ".git", "info", "exclude");
  try {
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    const current = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
    const lines = directories.map((directory) => `/${directory.replace(/^\//, "")}`);
    let next = current;
    if (next.length > 0 && !next.endsWith("\n")) next += "\n";
    for (const line of lines) {
      if (!next.split(/\r?\n/).includes(line)) next += `${line}\n`;
    }
    fs.writeFileSync(excludePath, next, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "exclude update failed";
    throw new SkillMountDeniedError("exclude_missing", message);
  }
  return excludePath;
}
