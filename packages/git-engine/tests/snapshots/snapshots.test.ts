import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HARNESS_KERNEL_EMAIL,
  HARNESS_KERNEL_NAME,
  LineEndingOverrideError,
  SNAPSHOT_COMMIT_SUBJECT,
  SnapshotConsentRequiredError,
  SnapshotManager,
  SnapshotSafetyBlockedError,
  TempIndexLocationError,
  createProcessSnapshotGitRunner,
  defaultHarnessTmp,
} from "../../src/snapshots/index.js";
import type { SnapshotGitRequest, SnapshotGitResult, SnapshotGitRunner } from "../../src/snapshots/index.js";

const SLOW = 60_000;

interface GitOutput {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "Dev",
    GIT_AUTHOR_EMAIL: "dev@example.com",
    GIT_COMMITTER_NAME: "Dev",
    GIT_COMMITTER_EMAIL: "dev@example.com",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

function runGit(cwd: string, args: readonly string[], input?: string): Promise<GitOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...args], {
      cwd,
      env: gitEnv(),
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function mustGit(cwd: string, args: readonly string[], input?: string): Promise<GitOutput> {
  const result = await runGit(cwd, args, input);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await mustGit(dir, ["init", "-b", "main"]);
}

async function commitAll(dir: string, message: string): Promise<void> {
  await mustGit(dir, ["add", "-A"]);
  await mustGit(dir, ["commit", "-m", message]);
}

async function indexHash(repo: string): Promise<string> {
  const index = path.join(repo, ".git", "index");
  try {
    const data = await readFile(index);
    return createHash("sha256").update(data).digest("hex");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return "absent";
    throw error;
  }
}

async function objectNames(repo: string): Promise<string[]> {
  const root = path.join(repo, ".git", "objects");
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(path.relative(root, full));
    }
  }
  await walk(root);
  return out.sort();
}

async function showPath(repo: string, sha: string, file: string): Promise<string> {
  const result = await runGit(repo, ["show", `${sha}:${file}`]);
  if (result.code !== 0) return "";
  return result.stdout;
}

function syntheticKey(): string {
  return ["sk", "_live_", "synthetic", "_test_", "0000000000000000"].join("");
}

async function workspace(): Promise<{ root: string; repo: string; harnessTmp: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ef-snap-"));
  const repo = path.join(root, "repo [1] café");
  const harnessTmp = path.join(root, "harness-tmp");
  await mkdir(harnessTmp, { recursive: true });
  return { root, repo, harnessTmp };
}

describe("temporary-index snapshots", () => {
  it("captures staged, unstaged, deleted, and untracked files without touching the index", async () => {
    const { root, repo, harnessTmp } = await workspace();
    try {
      await initRepo(repo);
      await writeFile(path.join(repo, ".gitignore"), "*.log\n");
      await writeFile(path.join(repo, "a.ts"), "base-a\n");
      await writeFile(path.join(repo, "b.ts"), "base-b\n");
      await writeFile(path.join(repo, "c.ts"), "base-c\n");
      await commitAll(repo, "base");
      await writeFile(path.join(repo, "a.ts"), "staged-a\n");
      await mustGit(repo, ["add", "--", "a.ts"]);
      await writeFile(path.join(repo, "b.ts"), "unstaged-b\n");
      await rm(path.join(repo, "c.ts"));
      await writeFile(path.join(repo, "d.ts"), "untracked-d\n");
      const weirdDir = path.join(repo, "dir [1]");
      await mkdir(weirdDir);
      const weird = "note (café).txt";
      await writeFile(path.join(weirdDir, weird), "unicode path\n");
      await writeFile(path.join(repo, "secret.log"), "ignored\n");

      const beforeHash = await indexHash(repo);
      const beforeCached = await mustGit(repo, ["--no-optional-locks", "diff", "--cached"]);
      const beforeDiff = await mustGit(repo, ["--no-optional-locks", "diff"]);
      const beforeUntracked = await mustGit(repo, [
        "--no-optional-locks",
        "ls-files",
        "--others",
        "--exclude-standard",
      ]);
      const beforeHead = (await mustGit(repo, ["rev-parse", "HEAD"])).stdout.trim();

      const manager = new SnapshotManager();
      const result = await manager.createDirtyWorkSnapshot({
        repoPath: repo,
        projectId: "proj-1",
        taskId: "T037",
        attemptId: "1",
        step: "0",
        harnessTmp,
      });

      expect(result.noChanges).toBe(false);
      expect(result.ref).toBe("refs/harness/snapshots/proj-1/1");
      expect(result.parentSha).toBe(beforeHead);
      expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
      const sha = result.commitSha ?? "";
      expect(await showPath(repo, sha, "a.ts")).toBe("staged-a\n");
      expect(await showPath(repo, sha, "b.ts")).toBe("unstaged-b\n");
      expect(await showPath(repo, sha, "c.ts")).toBe("");
      expect(await showPath(repo, sha, "d.ts")).toBe("untracked-d\n");
      expect(await showPath(repo, sha, `dir [1]/${weird}`)).toBe("unicode path\n");
      expect(await showPath(repo, sha, "secret.log")).toBe("");

      const meta = await mustGit(repo, ["log", "-1", "--format=%an%n%ae%n%cn%n%ce%n%B", sha]);
      const lines = meta.stdout.split(/\r?\n/);
      expect(lines[0]).toBe(HARNESS_KERNEL_NAME);
      expect(lines[1]).toBe(HARNESS_KERNEL_EMAIL);
      expect(lines[2]).toBe(HARNESS_KERNEL_NAME);
      expect(lines[3]).toBe(HARNESS_KERNEL_EMAIL);
      expect(meta.stdout).toContain(SNAPSHOT_COMMIT_SUBJECT);
      expect(meta.stdout).toContain("Harness-Task: T037");
      expect(meta.stdout).toContain("Harness-Attempt: 1");
      expect(meta.stdout).toContain("Harness-Step: 0");
      expect((await mustGit(repo, ["rev-parse", `${sha}^`])).stdout.trim()).toBe(beforeHead);

      expect(await indexHash(repo)).toBe(beforeHash);
      expect((await mustGit(repo, ["--no-optional-locks", "diff", "--cached"])).stdout).toBe(beforeCached.stdout);
      expect((await mustGit(repo, ["--no-optional-locks", "diff"])).stdout).toBe(beforeDiff.stdout);
      expect(
        (await mustGit(repo, ["--no-optional-locks", "ls-files", "--others", "--exclude-standard"])).stdout,
      ).toBe(beforeUntracked.stdout);
      expect((await mustGit(repo, ["rev-parse", "HEAD"])).stdout.trim()).toBe(beforeHead);
      expect(existsSync(path.join(repo, ".git", "index.lock"))).toBe(false);
      const leftovers = (await readdir(harnessTmp)).filter((name) => name.startsWith("snapshot-"));
      expect(leftovers).toEqual([]);
      expect(await readFile(path.join(repo, "a.ts"), "utf8")).toBe("staged-a\n");
      expect(existsSync(path.join(repo, "c.ts"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);

  it("returns HEAD and writes no snapshot ref when the worktree is clean", async () => {
    const { root, repo, harnessTmp } = await workspace();
    try {
      await initRepo(repo);
      await writeFile(path.join(repo, "readme.txt"), "clean\n");
      await commitAll(repo, "base");
      const head = (await mustGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
      const manager = new SnapshotManager();
      const result = await manager.createDirtyWorkSnapshot({
        repoPath: repo,
        projectId: "proj-clean",
        harnessTmp,
      });
      expect(result.noChanges).toBe(true);
      expect(result.commitSha).toBe(head);
      expect(result.ref).toBeNull();
      expect((await runGit(repo, ["for-each-ref", "refs/harness/snapshots"])).stdout.trim()).toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);

  it("snapshots an unborn repository without moving HEAD", async () => {
    const { root, repo, harnessTmp } = await workspace();
    try {
      await initRepo(repo);
      await writeFile(path.join(repo, "hello.txt"), "first\n");
      const before = await indexHash(repo);
      const manager = new SnapshotManager();
      const result = await manager.createDirtyWorkSnapshot({
        repoPath: repo,
        projectId: "unborn-proj",
        harnessTmp,
      });
      expect(result.unborn).toBe(true);
      expect(result.noChanges).toBe(false);
      expect(result.parentSha).toBeNull();
      expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
      const sha = result.commitSha ?? "";
      expect((await runGit(repo, ["rev-parse", "--verify", "--quiet", "HEAD"])).code).not.toBe(0);
      expect((await runGit(repo, ["rev-parse", "--verify", "--quiet", `${sha}^`])).code).not.toBe(0);
      expect(await showPath(repo, sha, "hello.txt")).toBe("first\n");
      expect(await indexHash(repo)).toBe(before);
      expect(await readFile(path.join(repo, "hello.txt"), "utf8")).toBe("first\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);

  it("blocks a synthetic key before any object is written", async () => {
    const { root, repo, harnessTmp } = await workspace();
    try {
      await initRepo(repo);
      await writeFile(path.join(repo, "readme.txt"), "base\n");
      await commitAll(repo, "base");
      const key = syntheticKey();
      await writeFile(path.join(repo, "notes.txt"), `token=${key}\n`);
      await writeFile(path.join(repo, ".env"), `TOKEN=${key}\n`);
      const objectsBefore = await objectNames(repo);
      const beforeHash = await indexHash(repo);
      const commands: string[][] = [];
      const real = createProcessSnapshotGitRunner();
      const git: SnapshotGitRunner = {
        async execGit(request: SnapshotGitRequest): Promise<SnapshotGitResult> {
          commands.push([...request.args]);
          return real.execGit(request);
        },
      };
      const manager = new SnapshotManager({ git });
      await expect(
        manager.createDirtyWorkSnapshot({ repoPath: repo, projectId: "blocked", harnessTmp }),
      ).rejects.toBeInstanceOf(SnapshotSafetyBlockedError);
      try {
        await manager.createDirtyWorkSnapshot({ repoPath: repo, projectId: "blocked", harnessTmp });
      } catch (error) {
        expect(error).toBeInstanceOf(SnapshotSafetyBlockedError);
        const blocked = error as SnapshotSafetyBlockedError;
        expect(blocked.report.safeToCommit).toBe(false);
        expect(blocked.report.blockedSecrets.length).toBeGreaterThan(0);
        expect(JSON.stringify(blocked.report)).not.toContain(key);
      }
      expect(await objectNames(repo)).toEqual(objectsBefore);
      expect(await indexHash(repo)).toBe(beforeHash);
      expect(commands.some((args) => args[0] === "add" || args[0] === "write-tree" || args[0] === "commit-tree")).toBe(
        false,
      );
      expect((await runGit(repo, ["for-each-ref", "refs/harness/snapshots"])).stdout.trim()).toBe("");
      expect(existsSync(path.join(repo, ".env"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);

  it("blocks files over 50 MB before writing objects", async () => {
    const { root, repo, harnessTmp } = await workspace();
    try {
      await initRepo(repo);
      await writeFile(path.join(repo, "readme.txt"), "base\n");
      await commitAll(repo, "base");
      const big = path.join(repo, "big.bin");
      const handle = await open(big, "w");
      await handle.truncate(50 * 1024 * 1024 + 1);
      await handle.close();
      const objectsBefore = await objectNames(repo);
      const manager = new SnapshotManager();
      await expect(
        manager.createDirtyWorkSnapshot({ repoPath: repo, projectId: "large", harnessTmp }),
      ).rejects.toBeInstanceOf(SnapshotSafetyBlockedError);
      expect(await objectNames(repo)).toEqual(objectsBefore);
      expect(existsSync(big)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);

  it("excludes flagged secrets from the temp index and leaves them on disk", async () => {
    const { root, repo, harnessTmp } = await workspace();
    try {
      await initRepo(repo);
      await writeFile(path.join(repo, "readme.txt"), "base\n");
      await commitAll(repo, "base");
      const key = syntheticKey();
      await writeFile(path.join(repo, "notes.txt"), "visible\n");
      await writeFile(path.join(repo, ".env"), `TOKEN=${key}\n`);
      const beforeHash = await indexHash(repo);
      const manager = new SnapshotManager();
      const result = await manager.createDirtyWorkSnapshot({
        repoPath: repo,
        projectId: "exclude",
        harnessTmp,
        excludeFlaggedSecrets: true,
      });
      expect(result.noChanges).toBe(false);
      expect(result.excludedPaths).toContain(".env");
      const sha = result.commitSha ?? "";
      expect(await showPath(repo, sha, "notes.txt")).toBe("visible\n");
      expect(await showPath(repo, sha, ".env")).toBe("");
      expect(await readFile(path.join(repo, ".env"), "utf8")).toContain(key);
      expect(await indexHash(repo)).toBe(beforeHash);
      const listed = await mustGit(repo, ["rev-list", "--objects", "--all"]);
      for (const line of listed.stdout.split(/\r?\n/)) {
        const oid = line.split(" ")[0] ?? "";
        if (!/^[0-9a-f]{40}$/.test(oid)) continue;
        const kind = (await mustGit(repo, ["cat-file", "-t", oid])).stdout.trim();
        if (kind !== "blob") continue;
        const body = (await mustGit(repo, ["cat-file", "-p", oid])).stdout;
        expect(body).not.toContain(key);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);

  it("retries transient sharing violations while adding to the temp index", async () => {
    const { root, repo, harnessTmp } = await workspace();
    try {
      await initRepo(repo);
      await writeFile(path.join(repo, "readme.txt"), "base\n");
      await commitAll(repo, "base");
      await writeFile(path.join(repo, "readme.txt"), "edited\n");
      const real = createProcessSnapshotGitRunner();
      let failures = 2;
      let adds = 0;
      const git: SnapshotGitRunner = {
        async execGit(request: SnapshotGitRequest): Promise<SnapshotGitResult> {
          if (request.args[0] === "add") {
            adds += 1;
            if (failures > 0) {
              failures -= 1;
              return { exitCode: 1, stdout: "", stderr: "fatal: sharing violation", durationMs: 1 };
            }
            const index = request.env?.GIT_INDEX_FILE ?? "";
            expect(index.startsWith(harnessTmp)).toBe(true);
            expect(index.includes(`${path.sep}.git${path.sep}`)).toBe(false);
          }
          return real.execGit(request);
        },
      };
      const manager = new SnapshotManager({ git });
      const result = await manager.createDirtyWorkSnapshot({
        repoPath: repo,
        projectId: "retry",
        harnessTmp,
      });
      expect(result.noChanges).toBe(false);
      expect(adds).toBe(3);
      expect(await showPath(repo, result.commitSha ?? "", "readme.txt")).toBe("edited\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);

  it("deletes the temp index when the process fails after git add", async () => {
    const { root, repo, harnessTmp } = await workspace();
    try {
      await initRepo(repo);
      await writeFile(path.join(repo, "readme.txt"), "base\n");
      await commitAll(repo, "base");
      await writeFile(path.join(repo, "readme.txt"), "edited\n");
      const beforeHash = await indexHash(repo);
      const real = createProcessSnapshotGitRunner();
      const git: SnapshotGitRunner = {
        async execGit(request: SnapshotGitRequest): Promise<SnapshotGitResult> {
          const result = await real.execGit(request);
          if (request.args[0] === "add") throw new Error("crash between add and unlink");
          return result;
        },
      };
      const manager = new SnapshotManager({ git });
      await expect(
        manager.createDirtyWorkSnapshot({ repoPath: repo, projectId: "crash", harnessTmp }),
      ).rejects.toThrow(/crash between add and unlink/);
      expect(await indexHash(repo)).toBe(beforeHash);
      expect(existsSync(path.join(repo, ".git", "index.lock"))).toBe(false);
      const leftovers = (await readdir(harnessTmp)).filter((name) => name.startsWith("snapshot-"));
      expect(leftovers).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);

  it("sweeps stale temp index files and refuses a temp dir inside the repo", async () => {
    const { root, repo, harnessTmp } = await workspace();
    try {
      await initRepo(repo);
      await writeFile(path.join(repo, "readme.txt"), "base\n");
      await commitAll(repo, "base");
      const stale = path.join(harnessTmp, `snapshot-${randomUUID()}.index`);
      await writeFile(stale, "leftover");
      const old = new Date(Date.now() - 120_000);
      await utimes(stale, old, old);
      const manager = new SnapshotManager();
      const removed = await manager.sweepTempIndexes(harnessTmp, 60_000);
      expect(removed).toContain(stale);
      expect(existsSync(stale)).toBe(false);
      const inside = path.join(repo, "tmp-index");
      await expect(
        manager.createDirtyWorkSnapshot({ repoPath: repo, projectId: "inside", harnessTmp: inside }),
      ).rejects.toBeInstanceOf(TempIndexLocationError);
      expect(existsSync(inside)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);

  it("keeps submodule dirty pointers from crashing git add", async () => {
    const { root, repo, harnessTmp } = await workspace();
    const sub = path.join(root, "sub");
    try {
      await initRepo(sub);
      await writeFile(path.join(sub, "lib.txt"), "v1\n");
      await commitAll(sub, "lib");
      const subSha = (await mustGit(sub, ["rev-parse", "HEAD"])).stdout.trim();
      await initRepo(repo);
      await writeFile(path.join(repo, "readme.txt"), "base\n");
      await commitAll(repo, "base");
      await mustGit(repo, ["update-index", "--add", "--cacheinfo", `160000,${subSha},vendor`]);
      await writeFile(path.join(repo, ".gitmodules"), '[submodule "vendor"]\n\tpath = vendor\n\turl = ../sub\n');
      await mustGit(repo, ["add", "--", ".gitmodules"]);
      await mustGit(repo, ["commit", "-m", "add submodule"]);
      await writeFile(path.join(repo, "app.txt"), "app\n");
      const manager = new SnapshotManager();
      const result = await manager.createDirtyWorkSnapshot({
        repoPath: repo,
        projectId: "submod",
        harnessTmp,
      });
      expect(result.noChanges).toBe(false);
      expect(await showPath(repo, result.commitSha ?? "", "app.txt")).toBe("app\n");
      const uninitialized = (await mustGit(repo, ["ls-tree", result.commitSha ?? "", "vendor"])).stdout;
      expect(uninitialized).toContain("160000");
      expect(uninitialized).toContain(subSha);
      expect(existsSync(path.join(repo, ".git", "index.lock"))).toBe(false);

      const checked = path.join(root, "checked");
      const checkedSub = path.join(root, "checked-sub");
      const checkedTmp = path.join(root, "checked-tmp");
      await mkdir(checkedTmp);
      await initRepo(checkedSub);
      await writeFile(path.join(checkedSub, "lib.txt"), "v1\n");
      await commitAll(checkedSub, "lib");
      await initRepo(checked);
      await writeFile(path.join(checked, "readme.txt"), "base\n");
      await commitAll(checked, "base");
      await mustGit(checked, [
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        "--",
        checkedSub,
        "vendor",
      ]);
      await mustGit(checked, ["commit", "-m", "add submodule"]);
      const oldLink = (await mustGit(checked, ["rev-parse", "HEAD:vendor"])).stdout.trim();
      const beforeHash = await indexHash(checked);
      await writeFile(path.join(checked, "vendor", "lib.txt"), "v2\n");
      await commitAll(path.join(checked, "vendor"), "v2");
      const newLink = (await mustGit(path.join(checked, "vendor"), ["rev-parse", "HEAD"])).stdout.trim();
      expect(newLink).not.toBe(oldLink);
      await writeFile(path.join(checked, "app.txt"), "app\n");
      const dirty = await manager.createDirtyWorkSnapshot({
        repoPath: checked,
        projectId: "subdirty",
        harnessTmp: checkedTmp,
      });
      const pointer = (await mustGit(checked, ["ls-tree", dirty.commitSha ?? "", "vendor"])).stdout;
      expect(pointer).toContain("160000");
      expect(pointer).toContain(newLink);
      expect(await showPath(checked, dirty.commitSha ?? "", "app.txt")).toBe("app\n");
      const indexLink = (await mustGit(checked, ["ls-files", "-s", "--", "vendor"])).stdout;
      expect(indexLink).toContain(oldLink);
      expect(indexLink).not.toContain(newLink);
      expect(await indexHash(checked)).toBe(beforeHash);
      expect(existsSync(path.join(checked, ".git", "index.lock"))).toBe(false);
      expect(await readFile(path.join(checked, "vendor", "lib.txt"), "utf8")).toBe("v2\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);

  it("matches a normal commit for autocrlf and .gitattributes", async () => {
    const { root, repo, harnessTmp } = await workspace();
    const control = path.join(root, "control");
    try {
      await initRepo(repo);
      await mustGit(repo, ["config", "core.autocrlf", "false"]);
      await writeFile(path.join(repo, ".gitattributes"), "*.txt text eol=lf\n");
      await writeFile(path.join(repo, "keep.txt"), "base\n");
      await commitAll(repo, "base");
      await writeFile(path.join(repo, "crlf.txt"), "line1\r\nline2\r\n");
      const manager = new SnapshotManager();
      const result = await manager.createDirtyWorkSnapshot({
        repoPath: repo,
        projectId: "eol",
        harnessTmp,
      });
      const snapBlob = (await mustGit(repo, ["rev-parse", `${result.commitSha}:crlf.txt`])).stdout.trim();
      const stored = (await mustGit(repo, ["cat-file", "-p", snapBlob])).stdout;
      expect(stored.includes("\r")).toBe(false);

      await initRepo(control);
      await mustGit(control, ["config", "core.autocrlf", "false"]);
      await writeFile(path.join(control, ".gitattributes"), "*.txt text eol=lf\n");
      await writeFile(path.join(control, "keep.txt"), "base\n");
      await commitAll(control, "base");
      await writeFile(path.join(control, "crlf.txt"), "line1\r\nline2\r\n");
      await mustGit(control, ["add", "--", "crlf.txt"]);
      const tree = (await mustGit(control, ["write-tree"])).stdout.trim();
      const controlBlob = (await mustGit(control, ["rev-parse", `${tree}:crlf.txt`])).stdout.trim();
      expect(controlBlob).toBe(snapBlob);

      const rawRepo = path.join(root, "raw");
      const rawTmp = path.join(root, "raw-tmp");
      await mkdir(rawTmp);
      await initRepo(rawRepo);
      await mustGit(rawRepo, ["config", "core.autocrlf", "false"]);
      await writeFile(path.join(rawRepo, "keep.txt"), "base\n");
      await commitAll(rawRepo, "base");
      await writeFile(path.join(rawRepo, "crlf.txt"), "line1\r\nline2\r\n");
      const rawResult = await manager.createDirtyWorkSnapshot({
        repoPath: rawRepo,
        projectId: "raw-eol",
        harnessTmp: rawTmp,
      });
      const rawBlob = (await mustGit(rawRepo, ["rev-parse", `${rawResult.commitSha}:crlf.txt`])).stdout.trim();
      const rawStored = (await mustGit(rawRepo, ["cat-file", "-p", rawBlob])).stdout;
      expect(rawStored.includes("\r\n")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);

  it("reuses an unchanged checkpoint tree and parents the next step on the previous ref", async () => {
    const { root, repo, harnessTmp } = await workspace();
    try {
      await initRepo(repo);
      await writeFile(path.join(repo, "app.ts"), "base\n");
      await commitAll(repo, "base");
      const head = (await mustGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
      const beforeHash = await indexHash(repo);
      await writeFile(path.join(repo, "app.ts"), "step-one\n");
      const manager = new SnapshotManager();
      const first = await manager.createCheckpointWipCommit({
        repoPath: repo,
        attemptId: "attempt1",
        step: "1",
        taskId: "T037",
        harnessTmp,
      });
      expect(first.reused).toBe(false);
      expect(first.ref).toBe("refs/harness/checkpoints/attempt1/1");
      expect(first.parentSha).toBe(head);
      expect(await showPath(repo, first.commitSha, "app.ts")).toBe("step-one\n");
      const body = (await mustGit(repo, ["log", "-1", "--format=%B", first.commitSha])).stdout;
      expect(body).toContain("Harness-Task: T037");
      expect(body).toContain("Harness-Attempt: attempt1");
      expect(body).toContain("Harness-Step: 1");
      expect(await readFile(path.join(repo, "app.ts"), "utf8")).toBe("step-one\n");
      expect(await indexHash(repo)).toBe(beforeHash);

      const second = await manager.createCheckpointWipCommit({
        repoPath: repo,
        attemptId: "attempt1",
        step: "2",
        taskId: "T037",
        previousWipRef: first.ref ?? "",
        harnessTmp,
      });
      expect(second.reused).toBe(true);
      expect(second.noChanges).toBe(true);
      expect(second.wipRef).toBe(first.ref);
      expect((await runGit(repo, ["rev-parse", "--verify", "--quiet", "refs/harness/checkpoints/attempt1/2"])).code).not.toBe(
        0,
      );

      await writeFile(path.join(repo, "app.ts"), "step-three\n");
      const third = await manager.createCheckpointWipCommit({
        repoPath: repo,
        attemptId: "attempt1",
        step: "3",
        taskId: "T037",
        previousWipRef: first.ref ?? "",
        harnessTmp,
      });
      expect(third.reused).toBe(false);
      expect(third.parentSha).toBe(first.commitSha);
      expect(third.ref).toBe("refs/harness/checkpoints/attempt1/3");
      expect(await indexHash(repo)).toBe(beforeHash);

      const clean = await manager.createCheckpointWipCommit({
        repoPath: path.join(root, "unused"),
        attemptId: "nope",
        step: "1",
        taskId: "T037",
        harnessTmp,
      }).catch((error: unknown) => error);
      expect(clean).toBeInstanceOf(Error);

      const listed = await manager.listSnapshots({ repoPath: repo, attemptId: "attempt1" });
      const refs = listed.map((entry) => entry.ref);
      expect(refs).toContain("refs/harness/checkpoints/attempt1/1");
      expect(refs).toContain("refs/harness/checkpoints/attempt1/3");
      expect(refs).not.toContain("refs/harness/checkpoints/attempt1/2");
      for (const entry of listed) {
        expect(entry.committedAt.length).toBeGreaterThan(0);
        expect(entry.commitSha).toMatch(/^[0-9a-f]{40}$/);
        if (entry.ref.endsWith("/3")) expect(entry.parentShas).toContain(first.commitSha);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);

  it("lists snapshot metadata and prunes only retired refs", async () => {
    const { root, repo, harnessTmp } = await workspace();
    try {
      await initRepo(repo);
      await writeFile(path.join(repo, "readme.txt"), "base\n");
      await commitAll(repo, "base");
      await writeFile(path.join(repo, "readme.txt"), "dirty\n");
      const manager = new SnapshotManager();
      const snapshot = await manager.createDirtyWorkSnapshot({
        repoPath: repo,
        projectId: "listed",
        harnessTmp,
      });
      await writeFile(path.join(repo, "extra.ts"), "x\n");
      const checkpoint = await manager.createCheckpointWipCommit({
        repoPath: repo,
        attemptId: "parked-attempt",
        step: "4",
        taskId: "T037",
        harnessTmp,
      });
      const all = await manager.listSnapshots({ repoPath: repo });
      expect(all.some((entry) => entry.ref === snapshot.ref && entry.kind === "snapshot")).toBe(true);
      expect(all.some((entry) => entry.ref === checkpoint.ref && entry.kind === "checkpoint")).toBe(true);
      const snapshotEntry = all.find((entry) => entry.ref === snapshot.ref);
      expect(snapshotEntry?.parentShas).toContain(snapshot.parentSha);
      expect(snapshotEntry?.committedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const parked = await manager.pruneSnapshots({
        repoPath: repo,
        refs: [snapshot.ref ?? "", checkpoint.ref ?? "", "refs/heads/main"],
        checkpointStates: [{ attemptId: "parked-attempt", parked: true, landed: false }],
      });
      expect(parked.deleted).toEqual([snapshot.ref]);
      expect(parked.refused.map((item) => item.reason).sort()).toEqual([
        "checkpoint_parked",
        "not_harness_snapshot_namespace",
      ]);
      expect((await mustGit(repo, ["rev-parse", checkpoint.ref ?? ""])).stdout.trim()).toBe(checkpoint.commitSha);

      const unlanded = await manager.pruneSnapshots({
        repoPath: repo,
        refs: [checkpoint.ref ?? ""],
        checkpointStates: [{ attemptId: "parked-attempt", parked: false, landed: false }],
      });
      expect(unlanded.deleted).toEqual([]);
      expect(unlanded.refused[0]?.reason).toBe("checkpoint_unlanded");

      const landed = await manager.pruneSnapshots({
        repoPath: repo,
        refs: [checkpoint.ref ?? ""],
        checkpointStates: [{ attemptId: "parked-attempt", parked: false, landed: true }],
      });
      expect(landed.deleted).toEqual([checkpoint.ref]);
      expect((await runGit(repo, ["rev-parse", "--verify", "--quiet", checkpoint.ref ?? ""])).code).not.toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);

  it("keeps snapshot and checkpoint commits across git gc", async () => {
    const { root, repo, harnessTmp } = await workspace();
    try {
      await initRepo(repo);
      await writeFile(path.join(repo, "readme.txt"), "base\n");
      await commitAll(repo, "base");
      await writeFile(path.join(repo, "readme.txt"), "dirty\n");
      const manager = new SnapshotManager();
      const snapshot = await manager.createDirtyWorkSnapshot({
        repoPath: repo,
        projectId: "gcproj",
        harnessTmp,
      });
      await writeFile(path.join(repo, "more.ts"), "more\n");
      const checkpoint = await manager.createCheckpointWipCommit({
        repoPath: repo,
        attemptId: "gc-attempt",
        step: "1",
        taskId: "T037",
        harnessTmp,
      });
      await mustGit(repo, ["gc", "--prune=now"]);
      await mustGit(repo, ["worktree", "prune"]);
      expect((await mustGit(repo, ["cat-file", "-t", snapshot.commitSha ?? ""])).stdout.trim()).toBe("commit");
      expect((await mustGit(repo, ["cat-file", "-t", checkpoint.commitSha])).stdout.trim()).toBe("commit");
      expect((await mustGit(repo, ["rev-parse", snapshot.ref ?? ""])).stdout.trim()).toBe(snapshot.commitSha);
      expect((await mustGit(repo, ["rev-parse", checkpoint.ref ?? ""])).stdout.trim()).toBe(checkpoint.commitSha);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);

  it("converges a three-way merge when the developer later commits the same edits", async () => {
    const { root, repo, harnessTmp } = await workspace();
    try {
      await initRepo(repo);
      await writeFile(path.join(repo, "README.md"), "base\n");
      await commitAll(repo, "base");
      const head = (await mustGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
      await writeFile(path.join(repo, "README.md"), "base\ndirty\n");
      await writeFile(path.join(repo, "notes.txt"), "hello\n");
      const beforeHash = await indexHash(repo);
      const manager = new SnapshotManager();
      const snapshot = await manager.createDirtyWorkSnapshot({
        repoPath: repo,
        projectId: "merge",
        harnessTmp,
      });
      const featureFile = path.join(root, "feature.ts");
      await writeFile(featureFile, "export const feature = true;\n");
      const blob = (await mustGit(repo, ["hash-object", "-w", "--", featureFile])).stdout.trim();
      const listing = (await mustGit(repo, ["ls-tree", snapshot.commitSha ?? ""])).stdout;
      const tree = (await mustGit(repo, ["mktree"], `${listing}100644 blob ${blob}\tfeature.ts\n`)).stdout.trim();
      const feature = (
        await mustGit(repo, ["commit-tree", tree, "-p", snapshot.commitSha ?? "", "-m", "feature atop snapshot"])
      ).stdout.trim();
      const developer = (
        await mustGit(repo, [
          "commit-tree",
          snapshot.treeSha ?? "",
          "-p",
          head,
          "-m",
          "developer commits the same edits",
        ])
      ).stdout.trim();
      const merged = await runGit(repo, ["merge-tree", "--write-tree", developer, feature]);
      expect(merged.code).toBe(0);
      expect(merged.stdout).not.toMatch(/CONFLICT/);
      const mergedTree = merged.stdout.trim();
      const names = (await mustGit(repo, ["ls-tree", "-r", "--name-only", mergedTree])).stdout;
      expect(names).toContain("feature.ts");
      expect(names).toContain("notes.txt");
      expect(names).toContain("README.md");
      expect(await showPath(repo, mergedTree, "README.md")).toBe("base\ndirty\n");
      expect(await indexHash(repo)).toBe(beforeHash);
      expect((await mustGit(repo, ["rev-parse", "HEAD"])).stdout.trim()).toBe(head);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);

  it("places the default temp directory under LOCALAPPDATA and rejects unconsented mutation", async () => {
    expect(defaultHarnessTmp({ LOCALAPPDATA: "D:\\LocalApp" })).toBe(path.join("D:\\LocalApp", "EFHarness", "tmp"));
    expect(defaultHarnessTmp({ LOCALAPPDATA: "  " })).toBe(path.join(os.tmpdir(), "EFHarness", "tmp"));
    const runner = createProcessSnapshotGitRunner();
    const { root, repo } = await workspace();
    try {
      await initRepo(repo);
      await expect(
        runner.execGit({ args: ["add", "-A"], cwd: repo, developerCheckout: true }),
      ).rejects.toBeInstanceOf(SnapshotConsentRequiredError);
      await expect(
        runner.execGit({
          args: ["-c", "core.autocrlf=false", "status"],
          cwd: repo,
          developerCheckout: false,
        }),
      ).rejects.toBeInstanceOf(LineEndingOverrideError);
      await expect(
        runner.execGit({ args: ["stash", "push"], cwd: repo, developerCheckout: false }),
      ).rejects.toBeInstanceOf(SnapshotConsentRequiredError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW);
});
