import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SkillManifestRegistry,
  SkillMounter,
  SkillMountDeniedError,
  SkillTokenBudgetEnforcer,
  defaultRepoRoot,
  type LoadedSkill,
} from "../../src/skill-vetting/index.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function tempWorktree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-skill-wt-"));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function copyCatalog(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-skill-mount-"));
  fs.cpSync(path.join(defaultRepoRoot(), "corpus", "skills"), path.join(root, "corpus", "skills"), {
    recursive: true,
  });
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function fakeSkill(
  skillId: string,
  roles: readonly string[],
  touches: readonly string[],
  tokenCount: number,
): LoadedSkill {
  return {
    entry: {
      skillId,
      version: "1",
      sourceType: "authored",
      upstreamRepo: null,
      pinnedCommitSha: null,
      license: "LicenseRef-EF-Harness",
      sha256: "a".repeat(64),
      tokenCount,
      allowedRoles: roles,
      allowedTouches: touches,
      vettingStatus: "vetted",
      lastVettedAt: "2026-11-20T12:00:00.000Z",
    },
    files: [],
    skillMarkdown: "",
    injectedText: "",
    sha256: "a".repeat(64),
    tokenCount,
    pinnedCommitSha: "b".repeat(40),
  };
}

describe("skill mounting and selection", () => {
  it("stages a vetted skill inside the worktree and lists it in .git/info/exclude", () => {
    const worktree = tempWorktree();
    const mounter = new SkillMounter(
      new SkillManifestRegistry(defaultRepoRoot()),
      new SkillTokenBudgetEnforcer(),
    );
    const mounted = mounter.mount({
      worktreeRoot: worktree,
      skillIds: ["infer-or-ask", "api-security-hardening"],
      attemptId: "attempt1",
    });
    expect(mounted.skillIds).toEqual(["infer-or-ask", "api-security-hardening"]);
    expect(mounted.totalTokens).toBeLessThanOrEqual(3500);
    const relative = path.relative(worktree, mounted.mountPath);
    expect(relative.startsWith("..")).toBe(false);
    expect(path.isAbsolute(relative)).toBe(false);
    const exclude = fs.readFileSync(mounted.excludePath, "utf8");
    expect(exclude).toContain(".ef-skills/attempt1/");
    const staged = fs.readFileSync(path.join(mounted.mountPath, "infer-or-ask", "SKILL.md"));
    const canonical = fs.readFileSync(
      path.join(defaultRepoRoot(), "skills", "infer-or-ask", "SKILL.md"),
    );
    expect(staged.equals(canonical)).toBe(true);
    const homeConfig = path.join(os.homedir(), ".codex", "skills");
    expect(mounted.mountPath.startsWith(homeConfig)).toBe(false);
  });

  it("refuses a mount path outside the worktree and a user config directory", () => {
    const worktree = tempWorktree();
    const mounter = new SkillMounter(
      new SkillManifestRegistry(defaultRepoRoot()),
      new SkillTokenBudgetEnforcer(),
    );
    expect(() =>
      mounter.mount({
        worktreeRoot: worktree,
        skillIds: ["infer-or-ask"],
        attemptId: "attempt1",
        mountPath: path.resolve(worktree, "..", "outside-skill-mount"),
      }),
    ).toThrow(SkillMountDeniedError);
    const globalDest = path.join(os.homedir(), ".codex", "ef-task-078-should-not-exist");
    expect(fs.existsSync(globalDest)).toBe(false);
    let caught: unknown;
    try {
      mounter.mount({
        worktreeRoot: worktree,
        skillIds: ["infer-or-ask"],
        attemptId: "attempt1",
        mountPath: globalDest,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SkillMountDeniedError);
    expect(caught instanceof SkillMountDeniedError ? caught.code : "").toBe("global_config");
    expect(fs.existsSync(globalDest)).toBe(false);
  });

  it("blocks a revoked skill on the next mount", () => {
    const root = copyCatalog();
    const worktree = tempWorktree();
    const registry = new SkillManifestRegistry(root);
    const mounter = new SkillMounter(registry, new SkillTokenBudgetEnforcer());
    mounter.mount({
      worktreeRoot: worktree,
      skillIds: ["infer-or-ask"],
      attemptId: "attempt1",
    });
    registry.setVettingStatus("infer-or-ask", "revoked", null);
    let caught: unknown;
    try {
      mounter.mount({
        worktreeRoot: worktree,
        skillIds: ["infer-or-ask"],
        attemptId: "attempt2",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SkillMountDeniedError);
    expect(caught instanceof SkillMountDeniedError ? caught.code : "").toBe("revoked");
    expect(fs.existsSync(path.join(worktree, ".ef-skills", "attempt2"))).toBe(false);
  });

  it("caps four tag-overlapping skills at two and 3500 tokens", () => {
    const enforcer = new SkillTokenBudgetEnforcer();
    const ranked = enforcer.selectForTask({
      role: "worker",
      touches: ["authz"],
      skills: [
        fakeSkill("a-specific", ["worker"], ["authz"], 100),
        fakeSkill("d-medium", ["worker"], ["authz", "billing"], 100),
        fakeSkill("b-broad", ["worker"], ["authz", "route", "logging", "extra"], 100),
        fakeSkill("c-norole", ["planner"], ["authz"], 100),
      ],
    });
    expect(ranked.selected.map((skill) => skill.entry.skillId)).toEqual(["a-specific", "d-medium"]);
    expect(ranked.selected.length).toBeLessThanOrEqual(2);
    expect(ranked.totalTokens).toBeLessThanOrEqual(3500);

    const capped = enforcer.selectForTask({
      role: "worker",
      touches: ["authz"],
      skills: [
        fakeSkill("high", ["worker"], ["authz"], 1800),
        fakeSkill("mid", ["worker"], ["authz", "billing"], 1800),
        fakeSkill("low", ["worker"], ["authz", "billing", "audit"], 100),
      ],
    });
    expect(capped.selected.map((skill) => skill.entry.skillId)).toEqual(["high", "low"]);
    expect(capped.totalTokens).toBe(1900);
  });

  it("refuses to mount more than two skills", () => {
    const worktree = tempWorktree();
    const mounter = new SkillMounter(
      new SkillManifestRegistry(defaultRepoRoot()),
      new SkillTokenBudgetEnforcer(),
    );
    let caught: unknown;
    try {
      mounter.mount({
        worktreeRoot: worktree,
        skillIds: ["infer-or-ask", "systematic-debugging", "test-driven-verification"],
        attemptId: "attempt1",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SkillMountDeniedError);
    expect(caught instanceof SkillMountDeniedError ? caught.code : "").toBe("too_many_skills");
    expect(fs.existsSync(path.join(worktree, ".ef-skills"))).toBe(false);
  });
});
