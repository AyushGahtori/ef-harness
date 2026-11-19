import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectCaseCollisions } from "../../src/runner/case-collisions.js";
import { execGit } from "../../src/runner/exec-git.js";
import { parseMergeTreeOutput, predictMergeTree } from "../../src/runner/merge-tree.js";
import { GitCommandError } from "../../src/runner/types.js";
import { commitFile, gitOk, initRepo, makeSandbox, rawGit, removeSandbox, seedRepo, type Sandbox } from "./helpers.js";

const sandboxes: string[] = [];

function sandbox(): Sandbox {
  const created = makeSandbox();
  sandboxes.push(created.root);
  return created;
}

afterEach(() => {
  for (const root of sandboxes.splice(0)) removeSandbox(root);
});

async function snapshot(repo: string, box: Sandbox) {
  const status = await execGit({
    args: ["status", "--porcelain=v1", "-z"],
    cwd: repo,
    env: box.env,
    gitBinary: box.git,
  });
  const staged = await execGit({
    args: ["diff", "--cached", "--name-only"],
    cwd: repo,
    env: box.env,
    gitBinary: box.git,
  });
  const unstaged = await execGit({
    args: ["diff", "--name-only"],
    cwd: repo,
    env: box.env,
    gitBinary: box.git,
  });
  return {
    status: status.stdout,
    staged: staged.stdout,
    unstaged: unstaged.stdout,
    readme: fs.readFileSync(path.join(repo, "README.md"), "utf8"),
  };
}

describe("predictMergeTree", { timeout: 30_000 }, () => {
  it("parses a clean tree id and conflict paths from merge-tree output", () => {
    expect(parseMergeTreeOutput("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n")).toEqual({
      treeOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      conflictingPaths: [],
    });
    const conflict = [
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "other.txt",
      "same.txt",
      "",
      "Auto-merging same.txt",
      "CONFLICT (content): Merge conflict in same.txt",
      "CONFLICT (content): Merge conflict in other.txt",
      "",
    ].join("\n");
    expect(parseMergeTreeOutput(conflict)).toEqual({
      treeOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      conflictingPaths: ["other.txt", "same.txt"],
    });
  });

  it("predicts a clean merge and exact conflicting paths without touching the worktree or index", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    seedRepo(repo, box.env);
    gitOk(repo, ["checkout", "-b", "left"], box.env);
    commitFile(repo, box.env, "left.txt", "left\n", "left");
    gitOk(repo, ["checkout", "main"], box.env);
    gitOk(repo, ["checkout", "-b", "right"], box.env);
    commitFile(repo, box.env, "right.txt", "right\n", "right");
    const beforeClean = await snapshot(repo, box);
    const clean = await predictMergeTree({
      cwd: repo,
      ours: "left",
      theirs: "right",
      env: box.env,
      gitBinary: box.git,
      developerCheckout: true,
    });
    expect(clean.clean).toBe(true);
    expect(clean.exitCode).toBe(0);
    expect(clean.conflictingPaths).toEqual([]);
    expect(clean.treeOid).toMatch(/^[0-9a-f]{40}$/);
    expect(await snapshot(repo, box)).toEqual(beforeClean);
    expect(rawGit(repo, ["rev-parse", "--verify", "MERGE_HEAD"], box.env).code).not.toBe(0);

    gitOk(repo, ["checkout", "main"], box.env);
    gitOk(repo, ["checkout", "-b", "conflict-a"], box.env);
    commitFile(repo, box.env, "same.txt", "aaa\n", "aaa");
    commitFile(repo, box.env, "other.txt", "one\n", "one");
    gitOk(repo, ["checkout", "main"], box.env);
    gitOk(repo, ["checkout", "-b", "conflict-b"], box.env);
    commitFile(repo, box.env, "same.txt", "bbb\n", "bbb");
    commitFile(repo, box.env, "other.txt", "two\n", "two");
    const beforeConflict = await snapshot(repo, box);
    const conflict = await predictMergeTree({
      cwd: repo,
      ours: "conflict-a",
      theirs: "conflict-b",
      env: box.env,
      gitBinary: box.git,
    });
    expect(conflict.clean).toBe(false);
    expect(conflict.exitCode).not.toBe(0);
    expect(conflict.conflictingPaths).toEqual(["other.txt", "same.txt"]);
    expect(conflict.treeOid).toMatch(/^[0-9a-f]{40}$/);
    expect(await snapshot(repo, box)).toEqual(beforeConflict);
    expect(fs.existsSync(path.join(repo, ".git", "MERGE_HEAD"))).toBe(false);
  }, 30_000);
});

describe("detectCaseCollisions", { timeout: 30_000 }, () => {
  it("catches paths that differ only by letter case and ignores different directories", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    initRepo(repo, box.env);
    fs.writeFileSync(path.join(repo, "blob.txt"), "blob\n");
    const blob = gitOk(repo, ["hash-object", "-w", "--", "blob.txt"], box.env).stdout.trim();
    const src = rawGit(
      repo,
      ["mktree"],
      box.env,
      `100644 blob ${blob}\tFoo.ts\n100644 blob ${blob}\tfoo.ts\n100644 blob ${blob}\tonly.ts\n`,
    );
    expect(src.code).toBe(0);
    const lib = rawGit(repo, ["mktree"], box.env, `100644 blob ${blob}\tFoo.ts\n`);
    expect(lib.code).toBe(0);
    const top = rawGit(
      repo,
      ["mktree"],
      box.env,
      `040000 tree ${src.stdout.trim()}\tsrc\n040000 tree ${lib.stdout.trim()}\tlib\n`,
    );
    expect(top.code).toBe(0);
    const commit = gitOk(repo, ["commit-tree", top.stdout.trim(), "-m", "case"], box.env).stdout.trim();
    gitOk(repo, ["update-ref", "refs/heads/main", commit], box.env);
    const before = gitOk(repo, ["status", "--porcelain=v1", "-z"], box.env).stdout;
    const report = await detectCaseCollisions({
      cwd: repo,
      env: box.env,
      gitBinary: box.git,
    });
    expect(report.collisions).toHaveLength(1);
    expect(report.collisions[0]?.key).toBe("src/foo.ts");
    expect([...(report.collisions[0]?.paths ?? [])].sort()).toEqual(["src/Foo.ts", "src/foo.ts"].sort());
    expect(gitOk(repo, ["status", "--porcelain=v1", "-z"], box.env).stdout).toBe(before);
  });

  it("returns no collisions for a normal tree and fails clearly when HEAD is missing", async () => {
    const box = sandbox();
    const repo = path.join(box.root, "repo");
    seedRepo(repo, box.env);
    const clean = await detectCaseCollisions({ cwd: repo, env: box.env, gitBinary: box.git });
    expect(clean.collisions).toEqual([]);
    const unborn = path.join(box.root, "unborn");
    initRepo(unborn, box.env);
    await expect(detectCaseCollisions({ cwd: unborn, env: box.env, gitBinary: box.git })).rejects.toBeInstanceOf(
      GitCommandError,
    );
  });
});
