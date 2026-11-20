import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SkillTokenBudgetEnforcer } from "./budget.js";
import {
  SkillMountDeniedError,
  SkillTokenBudgetError,
  type MountRequest,
  type MountResult,
} from "./model.js";
import { globalConfigDirNames } from "./patterns.js";
import type { SkillManifestRegistry } from "./registry.js";

const ATTEMPT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Stages vetted skills inside one attempt worktree and lists that directory
 * in `.git/info/exclude`. User-home config directories are refused.
 */
export class SkillMounter {
  constructor(
    private readonly registry: SkillManifestRegistry,
    private readonly budget: SkillTokenBudgetEnforcer,
  ) {}

  mount(request: MountRequest): MountResult {
    if (!ATTEMPT_ID.test(request.attemptId)) {
      throw new SkillMountDeniedError("outside_worktree", `invalid attempt id ${request.attemptId}`);
    }
    const worktreeRoot = path.resolve(request.worktreeRoot);
    if (!fs.existsSync(worktreeRoot) || !fs.statSync(worktreeRoot).isDirectory()) {
      throw new SkillMountDeniedError("outside_worktree", `worktree is missing: ${worktreeRoot}`);
    }
    const mountPath =
      request.mountPath === undefined
        ? path.resolve(worktreeRoot, ".ef-skills", request.attemptId)
        : path.resolve(request.mountPath);
    assertNotGlobalConfig(mountPath);
    assertInsideWorktree(worktreeRoot, mountPath);
    const loaded = request.skillIds.map((skillId) => this.registry.loadForMount(skillId));
    let totalTokens = 0;
    try {
      totalTokens = this.budget.assertMountedSet(loaded);
    } catch (error) {
      if (error instanceof SkillTokenBudgetError) {
        const code = loaded.length > 2 ? "too_many_skills" : "token_budget";
        throw new SkillMountDeniedError(code, error.message);
      }
      throw error;
    }
    const excludePath = ensureExclude(worktreeRoot, mountPath);
    const files: string[] = [];
    for (const skill of loaded) {
      for (const file of skill.files) {
        if (file.relativePath === "quarantine-report.json") continue;
        const destination = path.join(mountPath, skill.entry.skillId, file.relativePath);
        assertInsideWorktree(worktreeRoot, destination);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, file.bytes);
        files.push(destination);
      }
    }
    return {
      mountPath,
      excludePath,
      skillIds: loaded.map((skill) => skill.entry.skillId),
      totalTokens,
      files,
    };
  }
}

function assertNotGlobalConfig(target: string): void {
  const home = path.resolve(os.homedir());
  const destination = path.resolve(target);
  const relative = path.relative(home, destination);
  const banned = new Set(globalConfigDirNames().map((name) => name.toLowerCase()));
  if (!(relative.startsWith("..") || path.isAbsolute(relative))) {
    const segments = relative.split(path.sep);
    if (segments.some((segment) => banned.has(segment.toLowerCase()))) {
      throw new SkillMountDeniedError(
        "global_config",
        `refusing to mount into a user config directory: ${destination}`,
      );
    }
    const roaming = path.resolve(home, "AppData", "Roaming");
    const roamingRel = path.relative(roaming, destination);
    if (roamingRel === "" || (!roamingRel.startsWith("..") && !path.isAbsolute(roamingRel))) {
      throw new SkillMountDeniedError(
        "global_config",
        `refusing to mount into a user config directory: ${destination}`,
      );
    }
  }
  for (const name of globalConfigDirNames()) {
    const configRoot = path.resolve(home, name);
    const fromConfig = path.relative(configRoot, destination);
    if (fromConfig === "" || (!fromConfig.startsWith("..") && !path.isAbsolute(fromConfig))) {
      throw new SkillMountDeniedError(
        "global_config",
        `refusing to mount into a user config directory: ${destination}`,
      );
    }
  }
}

function assertInsideWorktree(worktreeRoot: string, target: string): void {
  const relative = path.relative(path.resolve(worktreeRoot), path.resolve(target));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new SkillMountDeniedError("outside_worktree", `mount path is outside the worktree: ${target}`);
  }
}

function ensureExclude(worktreeRoot: string, mountPath: string): string {
  const excludePath = path.join(worktreeRoot, ".git", "info", "exclude");
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  const relative = path.relative(worktreeRoot, mountPath).replaceAll("\\", "/");
  const lines = [`/.ef-skills/`, `/${relative}/`];
  const current = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
  let next = current;
  if (next.length > 0 && !next.endsWith("\n")) next += "\n";
  for (const line of lines) {
    if (!next.split(/\r?\n/).includes(line)) next += `${line}\n`;
  }
  fs.writeFileSync(excludePath, next, "utf8");
  const confirmed = fs.readFileSync(excludePath, "utf8");
  if (!confirmed.split(/\r?\n/).includes(`/${relative}/`)) {
    throw new SkillMountDeniedError(
      "exclude_missing",
      `mount path is not listed in .git/info/exclude: ${relative}`,
    );
  }
  return excludePath;
}
