import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalDeterministicSupervisionPolicyEngine,
  OpenCodeSkillMounter,
  sha256Text,
} from "../../src/opencode/index.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function worktree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oc149-policy-"));
  roots.push(root);
  const dir = path.join(root, "wt");
  fs.mkdirSync(path.join(dir, "src", "api"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "api", "orders.ts"), "export const orders = [];\n");
  fs.writeFileSync(path.join(dir, "notes.txt"), "note\n");
  return dir;
}

describe("LocalDeterministicSupervisionPolicyEngine", () => {
  it("allows in-scope edits, denies escapes, and answers in under 2 ms once warm", () => {
    const dir = worktree();
    const engine = new LocalDeterministicSupervisionPolicyEngine();
    engine.warm(dir);
    const outside = engine.decide({
      worktreePath: dir,
      writeScope: ["src/**"],
      tool: "edit",
      args: { path: "../outside.txt" },
      repeatCount: 1,
    });
    expect(outside.decision).toBe("deny");
    expect(outside.acpOutcome).toBe("reject_once");
    expect(outside.reason).toBe("path_escape");
    const samples: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      const timed = engine.decide({
        worktreePath: dir,
        writeScope: ["src/**"],
        tool: "edit",
        args: { path: "notes.txt" },
        repeatCount: 1,
      });
      expect(timed.decision).toBe("deny");
      expect(timed.reason).toBe("outside write_scope");
      expect(timed.acpOutcome).toBe("reject_once");
      samples.push(timed.elapsedMs);
    }
    const ordered = [...samples].sort((left, right) => left - right);
    const median = ordered[Math.floor(ordered.length / 2)] ?? Number.POSITIVE_INFINITY;
    const withinBudget = samples.filter((elapsed) => elapsed < 2).length;
    expect(median).toBeLessThan(2);
    expect(withinBudget).toBeGreaterThanOrEqual(35);
    const allowed = engine.decide({
      worktreePath: dir,
      writeScope: ["src/api/orders.ts"],
      tool: "edit",
      args: { path: "SRC/Api/Orders.ts" },
      repeatCount: 1,
    });
    expect(allowed.decision).toBe("allow");
    expect(allowed.acpOutcome).toBe("allow_once");
    const bash = engine.decide({
      worktreePath: dir,
      writeScope: ["src/**"],
      tool: "bash",
      args: { command: "rm -rf /" },
      repeatCount: 1,
    });
    expect(bash.decision).toBe("deny");
    expect(bash.reason).toContain("harness.run");
    const web = engine.decide({
      worktreePath: dir,
      writeScope: ["src/**"],
      tool: "webfetch",
      args: { url: "https://evil.com" },
      repeatCount: 1,
    });
    expect(web.decision).toBe("deny");
    const routed = engine.decide({
      worktreePath: dir,
      writeScope: ["src/**"],
      tool: "harness.run",
      args: { command: "node -e \"console.log('ok')\"" },
      repeatCount: 1,
    });
    expect(routed.decision).toBe("allow");
    const pushed = engine.decide({
      worktreePath: dir,
      writeScope: ["src/**"],
      tool: "harness.run",
      args: { command: "git push origin main" },
      repeatCount: 1,
    });
    expect(pushed.decision).toBe("deny");
    const loop = engine.decide({
      worktreePath: dir,
      writeScope: ["src/**"],
      tool: "edit",
      args: { path: "src/api/orders.ts" },
      repeatCount: 3,
    });
    expect(loop.reason).toBe("doom_loop");
  });

  it("denies a symlink that points outside the worktree when the link can be created", () => {
    const dir = worktree();
    const outside = path.join(path.dirname(dir), "secret.txt");
    fs.writeFileSync(outside, "secret\n");
    const link = path.join(dir, "link.txt");
    try {
      fs.symlinkSync(outside, link, "file");
    } catch {
      return;
    }
    const engine = new LocalDeterministicSupervisionPolicyEngine();
    const decision = engine.decide({
      worktreePath: dir,
      writeScope: ["**"],
      tool: "edit",
      args: { path: "link.txt" },
      repeatCount: 1,
    });
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toBe("path_escape");
  });
});

describe("OpenCodeSkillMounter", () => {
  it("mounts two vetted skills behind git exclude and cleans them up", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oc149-skill-"));
    roots.push(root);
    const worktree = path.join(root, "wt");
    const configDir = path.join(root, "cfg");
    fs.mkdirSync(worktree, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
    const first = "alpha skill";
    const second = "beta skill";
    const mounter = new OpenCodeSkillMounter();
    const mounted = mounter.mount({
      worktreePath: worktree,
      configDir,
      skills: [
        { id: "alpha", vettingStatus: "vetted", sha256: sha256Text(first), content: first },
        { id: "beta", vettingStatus: "vetted", sha256: sha256Text(second), content: second },
      ],
    });
    expect(fs.readFileSync(path.join(worktree, ".opencode", "skills", "alpha", "SKILL.md"), "utf8")).toBe(first);
    expect(fs.existsSync(path.join(configDir, "skills", "beta", "SKILL.md"))).toBe(true);
    expect(fs.readFileSync(path.join(worktree, ".git", "info", "exclude"), "utf8")).toContain(".opencode/skills/");
    mounter.cleanup(mounted);
    expect(fs.existsSync(path.join(worktree, ".opencode", "skills", "alpha", "SKILL.md"))).toBe(false);
    expect(fs.readFileSync(path.join(worktree, ".git", "info", "exclude"), "utf8")).not.toContain(".opencode/skills/");
  });

  it("rejects a third skill, an unvetted skill, and a hash mismatch", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oc149-skill-"));
    roots.push(root);
    const worktree = path.join(root, "wt");
    const configDir = path.join(root, "cfg");
    fs.mkdirSync(worktree, { recursive: true });
    const mounter = new OpenCodeSkillMounter();
    const skill = (id: string, status: "vetted" | "unvetted" = "vetted", hash?: string) => {
      const content = `body ${id}`;
      return { id, vettingStatus: status, sha256: hash ?? sha256Text(content), content };
    };
    expect(() =>
      mounter.mount({
        worktreePath: worktree,
        configDir,
        skills: [skill("one"), skill("two"), skill("three")],
      }),
    ).toThrow(/at most 2/);
    expect(() =>
      mounter.mount({ worktreePath: worktree, configDir, skills: [skill("one", "unvetted")] }),
    ).toThrow(/not vetted/);
    expect(() =>
      mounter.mount({
        worktreePath: worktree,
        configDir,
        skills: [skill("one", "vetted", "deadbeef")],
      }),
    ).toThrow(/hash/);
  });
});
