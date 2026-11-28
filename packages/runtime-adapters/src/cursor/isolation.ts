import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ISOLATED_CONFIG_DIRNAME, ISOLATED_SKILLS_DIRNAME, MAX_VENTED_SKILLS } from "./constants.js";
import { CursorAdapterError } from "./errors.js";
import { assertInsideWorktree, isInsideCursorHome } from "./paths.js";
import type { VettedSkill } from "./types.js";

export interface WorktreeIo {
  readFile(target: string): string;
  writeFile(target: string, content: string): void;
  mkdir(target: string): void;
  remove(target: string): void;
}

export function createGuardedIo(personalCursorHome: string): WorktreeIo {
  const home = path.resolve(personalCursorHome);
  const guard = (target: string): string => {
    const resolved = path.resolve(target);
    if (isInsideCursorHome(resolved, home)) {
      throw new CursorAdapterError(
        "personal_cursor_interference",
        "Harness Cursor runs never read or mutate the developer Cursor home",
      );
    }
    return resolved;
  };
  return {
    readFile(target: string): string {
      return readFileSync(guard(target), "utf8");
    },
    writeFile(target: string, content: string): void {
      const resolved = guard(target);
      mkdirSync(path.dirname(resolved), { recursive: true });
      writeFileSync(resolved, content, "utf8");
    },
    mkdir(target: string): void {
      mkdirSync(guard(target), { recursive: true });
    },
    remove(target: string): void {
      rmSync(guard(target), { recursive: true, force: true });
    },
  };
}

export function prepareIsolatedCursorHome(input: {
  readonly worktree: string;
  readonly personalCursorHome: string;
  readonly io: WorktreeIo;
}): { readonly configDir: string; readonly skillsDir: string } {
  const configDir = path.join(input.worktree, ISOLATED_CONFIG_DIRNAME);
  const skillsDir = path.join(input.worktree, ISOLATED_SKILLS_DIRNAME);
  assertInsideWorktree(configDir, input.worktree);
  assertInsideWorktree(skillsDir, input.worktree);
  if (isInsideCursorHome(configDir, input.personalCursorHome)) {
    throw new CursorAdapterError("personal_cursor_interference", "Isolated config resolved inside the personal Cursor home");
  }
  input.io.mkdir(configDir);
  input.io.writeFile(
    path.join(configDir, "runtime.json"),
    JSON.stringify({ isolated: true, personalCursor: false }),
  );
  input.io.mkdir(skillsDir);
  excludeFromGit(input.worktree, input.io, [".ef-cursor-runtime/", ".ef-cursor-skills/"]);
  return { configDir, skillsDir };
}

export function mountVettedSkills(input: {
  readonly worktree: string;
  readonly skillsDir: string;
  readonly skills: readonly VettedSkill[];
  readonly io: WorktreeIo;
}): readonly string[] {
  if (input.skills.length > MAX_VENTED_SKILLS) {
    throw new CursorAdapterError("skill_limit", "At most 2 vetted skills can be mounted for a Cursor attempt");
  }
  const written: string[] = [];
  for (const skill of input.skills) {
    if (skill.name.includes("..") || skill.name.includes("/") || skill.name.includes("\\")) {
      throw new CursorAdapterError("skill_name", "Skill names must stay inside the attempt worktree");
    }
    const file = path.join(input.skillsDir, skill.name, "SKILL.md");
    assertInsideWorktree(file, input.worktree);
    input.io.writeFile(file, skill.markdown);
    written.push(file);
  }
  return written;
}

export function cleanupEphemeralMounts(input: {
  readonly worktree: string;
  readonly io: WorktreeIo;
}): void {
  input.io.remove(path.join(input.worktree, ISOLATED_SKILLS_DIRNAME));
  input.io.remove(path.join(input.worktree, ISOLATED_CONFIG_DIRNAME));
}

function excludeFromGit(worktree: string, io: WorktreeIo, lines: readonly string[]): void {
  const excludePath = path.join(worktree, ".git", "info", "exclude");
  assertInsideWorktree(excludePath, worktree);
  let current = "";
  try {
    current = io.readFile(excludePath);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const present = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = lines.filter((line) => !present.has(line));
  if (missing.length === 0) return;
  const prefix = current.length === 0 || current.endsWith("\n") ? current : `${current}\n`;
  io.writeFile(excludePath, `${prefix}${missing.join("\n")}\n`);
}

function isMissing(error: unknown): boolean {
  if (error instanceof CursorAdapterError) return false;
  if (!error || typeof error !== "object") return false;
  const code = (error as { readonly code?: unknown }).code;
  return code === "ENOENT";
}
