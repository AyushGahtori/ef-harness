import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { OpenCodeAdapterError } from "./errors.js";
import { MAX_MOUNTED_SKILLS, type SkillSpec } from "./types.js";

export interface SkillMountResult {
  readonly worktreePath: string;
  readonly configDir: string;
  readonly skillIds: readonly string[];
  readonly worktreeFiles: readonly string[];
  readonly configFiles: readonly string[];
  readonly excludeLine: string;
}

export function sha256Text(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function assertSkillId(id: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new OpenCodeAdapterError("skill_rejected", `skill id ${id} is not a safe path segment`);
  }
}

export class OpenCodeSkillMounter {
  mount(input: {
    readonly worktreePath: string;
    readonly configDir: string;
    readonly skills: readonly SkillSpec[];
  }): SkillMountResult {
    if (input.skills.length > MAX_MOUNTED_SKILLS) {
      throw new OpenCodeAdapterError(
        "skill_rejected",
        `OpenCode mounts at most ${MAX_MOUNTED_SKILLS} vetted skills`,
      );
    }
    for (const skill of input.skills) {
      assertSkillId(skill.id);
      if (skill.vettingStatus !== "vetted") {
        throw new OpenCodeAdapterError("skill_rejected", `skill ${skill.id} is not vetted`);
      }
      if (sha256Text(skill.content) !== skill.sha256) {
        throw new OpenCodeAdapterError("skill_rejected", `skill ${skill.id} hash does not match the vetted manifest`);
      }
    }

    const worktreeRoot = path.resolve(input.worktreePath);
    const configRoot = path.resolve(input.configDir);
    const worktreeSkillDir = path.join(worktreeRoot, ".opencode", "skills");
    const configSkillDir = path.join(configRoot, "skills");
    const worktreeFiles: string[] = [];
    const configFiles: string[] = [];

    for (const skill of input.skills) {
      const worktreeFile = path.join(worktreeSkillDir, skill.id, "SKILL.md");
      const configFile = path.join(configSkillDir, skill.id, "SKILL.md");
      this.assertInside(worktreeRoot, worktreeFile);
      this.assertInside(configRoot, configFile);
      fs.mkdirSync(path.dirname(worktreeFile), { recursive: true });
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      fs.writeFileSync(worktreeFile, skill.content, "utf8");
      fs.writeFileSync(configFile, skill.content, "utf8");
      worktreeFiles.push(worktreeFile);
      configFiles.push(configFile);
    }

    const excludeLine = ".opencode/skills/";
    if (input.skills.length > 0) {
      this.addExclude(worktreeRoot, excludeLine);
    }

    return {
      worktreePath: worktreeRoot,
      configDir: configRoot,
      skillIds: input.skills.map((skill) => skill.id),
      worktreeFiles,
      configFiles,
      excludeLine,
    };
  }

  cleanup(result: SkillMountResult): void {
    for (const file of [...result.worktreeFiles, ...result.configFiles]) {
      fs.rmSync(file, { force: true });
      const dir = path.dirname(file);
      this.removeDirIfEmpty(dir);
      this.removeDirIfEmpty(path.dirname(dir));
    }
    if (result.skillIds.length > 0) {
      this.removeExclude(result.worktreePath, result.excludeLine);
    }
  }

  private assertInside(root: string, target: string): void {
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new OpenCodeAdapterError("skill_rejected", "skill mount escaped its root");
    }
  }

  private addExclude(worktree: string, line: string): void {
    const excludePath = path.join(worktree, ".git", "info", "exclude");
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    const current = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
    const lines = current.split(/\r?\n/).filter((entry) => entry.length > 0);
    if (!lines.includes(line)) lines.push(line);
    fs.writeFileSync(excludePath, `${lines.join("\n")}\n`, "utf8");
  }

  private removeExclude(worktree: string, line: string): void {
    const excludePath = path.join(worktree, ".git", "info", "exclude");
    if (!fs.existsSync(excludePath)) return;
    const lines = fs
      .readFileSync(excludePath, "utf8")
      .split(/\r?\n/)
      .filter((entry) => entry.length > 0 && entry !== line);
    fs.writeFileSync(excludePath, lines.length === 0 ? "" : `${lines.join("\n")}\n`, "utf8");
  }

  private removeDirIfEmpty(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir);
    if (entries.length === 0) fs.rmdirSync(dir);
  }
}
