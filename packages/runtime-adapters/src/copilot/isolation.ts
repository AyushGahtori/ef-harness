import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CopilotAdapterError } from "./errors.js";
import type { MountedCopilotFiles, PersistedCopilotConfig, RuntimePosture, VettedSkill } from "./types.js";

const EXCLUDE_BEGIN = "# ef-harness-copilot-begin";
const EXCLUDE_END = "# ef-harness-copilot-end";
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,48}$/;

export interface MountInput {
  readonly worktree: string;
  readonly posture: RuntimePosture;
  readonly excludedTools: readonly string[];
  readonly mcpServerNames: readonly string[];
  readonly skills: readonly VettedSkill[];
  readonly sandboxTier: string;
  readonly proxyUrl: string;
  readonly jobObjectId: string;
  readonly billingMode: PersistedCopilotConfig["billingMode"];
  readonly byokProvider: PersistedCopilotConfig["byokProvider"];
  readonly model: string | null;
}

export interface CopilotMount {
  readonly mounted: MountedCopilotFiles;
  readonly persisted: PersistedCopilotConfig;
}

export function assertNotPersonalCopilotHome(target: string): void {
  const resolved = path.resolve(target);
  const home = path.resolve(os.homedir());
  const roots = [path.resolve(home, ".copilot"), path.resolve(home, ".config", "github-copilot")];
  for (const root of roots) {
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
      throw new CopilotAdapterError(
        "home_config_pollution",
        "Refusing to write Copilot config into the user profile",
      );
    }
  }
}

export function mountCopilotAttempt(input: MountInput): CopilotMount {
  if (input.skills.length > 2) {
    throw new CopilotAdapterError("too_many_skills", "A Copilot attempt mounts at most 2 vetted skills");
  }
  const worktree = path.resolve(input.worktree);
  assertNotPersonalCopilotHome(worktree);
  const configDir = path.join(worktree, ".ef-copilot");
  const skillsDir = path.join(configDir, "skills");
  const configFile = path.join(configDir, "session.json");
  assertInside(worktree, configFile);
  fs.mkdirSync(skillsDir, { recursive: true });
  const skillNames: string[] = [];
  const files: string[] = [configFile];
  for (const skill of input.skills) {
    if (!SKILL_NAME.test(skill.name)) {
      throw new CopilotAdapterError("skill_name", "Skill names must be a short safe token");
    }
    const file = path.join(skillsDir, `${skill.name}.md`);
    assertInside(worktree, file);
    fs.writeFileSync(file, skill.markdown, "utf8");
    files.push(file);
    skillNames.push(skill.name);
  }
  const persisted: PersistedCopilotConfig = {
    worktree,
    posture: input.posture,
    excludedTools: input.excludedTools,
    mcpServerNames: input.mcpServerNames,
    skillNames,
    sandboxTier: input.sandboxTier,
    proxyUrl: input.proxyUrl,
    jobObjectId: input.jobObjectId,
    billingMode: input.billingMode,
    byokProvider: input.byokProvider,
    model: input.model,
  };
  fs.writeFileSync(configFile, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  writeExclude(worktree, [".ef-copilot/"]);
  return {
    mounted: { configDir, skillsDir, files },
    persisted,
  };
}

export function cleanupCopilotAttempt(worktree: string): void {
  const root = path.resolve(worktree);
  assertNotPersonalCopilotHome(root);
  const configDir = path.join(root, ".ef-copilot");
  assertInside(root, configDir);
  fs.rmSync(configDir, { recursive: true, force: true });
  stripExclude(root);
}

function writeExclude(worktree: string, lines: readonly string[]): void {
  const file = excludePath(worktree);
  assertInside(worktree, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const stripped = stripBlock(current);
  const block = [EXCLUDE_BEGIN, ...lines, EXCLUDE_END, ""].join("\n");
  fs.writeFileSync(file, `${stripped.trimEnd()}\n${block}`, "utf8");
}

function stripExclude(worktree: string): void {
  const file = excludePath(worktree);
  if (!fs.existsSync(file)) return;
  const next = stripBlock(fs.readFileSync(file, "utf8")).trimEnd();
  fs.writeFileSync(file, next.length > 0 ? `${next}\n` : "", "utf8");
}

function stripBlock(current: string): string {
  const pattern = new RegExp(`\\n?${EXCLUDE_BEGIN}[\\s\\S]*?${EXCLUDE_END}\\n?`, "g");
  return current.replace(pattern, "\n");
}

function excludePath(worktree: string): string {
  return path.join(worktree, ".git", "info", "exclude");
}

function assertInside(worktree: string, target: string): void {
  assertNotPersonalCopilotHome(target);
  const relative = path.relative(path.resolve(worktree), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new CopilotAdapterError("path_escape", "Copilot config must stay inside the attempt worktree");
  }
}
