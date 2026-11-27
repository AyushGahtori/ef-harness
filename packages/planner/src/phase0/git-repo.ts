import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { Phase0Error } from "./errors.js";
import { assertInsideRoot } from "./scope.js";
import { INTEGRATION_BRANCH } from "./types.js";

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface MergeOutcome {
  readonly sha: string;
  readonly method: "fast-forward" | "merge";
}

const IDENTITY = [
  "-c",
  "core.autocrlf=false",
  "-c",
  "user.name=EF Harness",
  "-c",
  "user.email=foundation@ef-harness.local",
];

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "EF Harness",
    GIT_AUTHOR_EMAIL: "foundation@ef-harness.local",
    GIT_COMMITTER_NAME: "EF Harness",
    GIT_COMMITTER_EMAIL: "foundation@ef-harness.local",
  };
}

export function runGit(cwd: string, args: readonly string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...IDENTITY, ...args], {
      cwd,
      windowsHide: true,
      env: gitEnv(),
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => reject(new Phase0Error("git", error.message)));
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

/**
 * Real temporary git repository checked out on `harness/integration`.
 * Merges are serialized. A failed merge aborts and leaves HEAD unchanged.
 */
export class GitIntegrationRepo {
  private mergeChain: Promise<void> = Promise.resolve();

  private constructor(readonly root: string) {}

  static async init(root: string): Promise<GitIntegrationRepo> {
    await fs.mkdir(root, { recursive: true });
    const repo = new GitIntegrationRepo(root);
    const created = await repo.git(["init", "-b", INTEGRATION_BRANCH]);
    if (created.code !== 0) {
      throw new Phase0Error("git_init", created.stderr || created.stdout);
    }
    await fs.writeFile(path.join(root, "README.md"), "# harness integration\n", "utf8");
    await repo.commitAll(root, "phase0: initialize harness/integration");
    return repo;
  }

  static open(root: string): GitIntegrationRepo {
    return new GitIntegrationRepo(root);
  }

  async head(): Promise<string> {
    return (await this.must(["rev-parse", "HEAD"])).trim();
  }

  async branch(): Promise<string> {
    const symbolic = await this.git(["symbolic-ref", "--short", "HEAD"]);
    if (symbolic.code === 0) return symbolic.stdout.trim();
    return (await this.must(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  }

  async porcelain(): Promise<string> {
    return (await this.must(["status", "--porcelain"])).replaceAll("\r\n", "\n");
  }

  async trackedFiles(): Promise<string[]> {
    const listed = await this.git(["ls-files", "-z"]);
    if (listed.code !== 0) throw new Phase0Error("git_ls", listed.stderr || listed.stdout);
    return listed.stdout.split("\0").filter((file) => file.length > 0);
  }

  async isAncestor(ancestor: string, descendant = "HEAD"): Promise<boolean> {
    const result = await this.git(["merge-base", "--is-ancestor", ancestor, descendant]);
    return result.code === 0;
  }

  async diff(from: string, to: string, pathspec: string): Promise<string> {
    const result = await this.git(["diff", "--exit-code", from, to, "--", pathspec]);
    if (result.code === 0) return "";
    if (result.code === 1) return result.stdout;
    throw new Phase0Error("git_diff", result.stderr || result.stdout);
  }

  async addWorktree(branch: string, dest: string): Promise<void> {
    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const existing = await this.git(["rev-parse", "--verify", "--quiet", branch]);
    if (existing.code === 0) {
      const removed = await this.git(["branch", "-D", branch]);
      if (removed.code !== 0) throw new Phase0Error("git_branch", removed.stderr || removed.stdout);
    }
    const added = await this.git(["worktree", "add", "-b", branch, dest, "HEAD"]);
    if (added.code !== 0) throw new Phase0Error("git_worktree", added.stderr || added.stdout);
  }

  async removeWorktree(dest: string, branch: string | null): Promise<void> {
    const removed = await this.git(["worktree", "remove", "--force", dest]);
    if (removed.code !== 0 && !/not a working tree|does not exist|No such file/i.test(`${removed.stderr}${removed.stdout}`)) {
      const listed = await this.git(["worktree", "list", "--porcelain"]);
      if (listed.stdout.includes(dest.replaceAll("\\", "/")) || listed.stdout.includes(dest)) {
        throw new Phase0Error("git_worktree", removed.stderr || removed.stdout);
      }
    }
    await fs.rm(dest, { recursive: true, force: true });
    if (!branch) return;
    await this.git(["branch", "-D", branch]);
  }

  async commitAll(cwd: string, message: string): Promise<string> {
    await this.assertIntegrationWhenMain(cwd);
    const added = await runGit(cwd, ["add", "-A"]);
    if (added.code !== 0) throw new Phase0Error("git_add", added.stderr || added.stdout);
    const status = await runGit(cwd, ["status", "--porcelain"]);
    if (status.code !== 0) throw new Phase0Error("git_status", status.stderr || status.stdout);
    if (status.stdout.trim() === "") {
      throw new Phase0Error("empty_commit", "Phase 0 task produced no changes");
    }
    const committed = await runGit(cwd, ["commit", "-m", message]);
    if (committed.code !== 0) throw new Phase0Error("git_commit", committed.stderr || committed.stdout);
    const sha = await runGit(cwd, ["rev-parse", "HEAD"]);
    if (sha.code !== 0) throw new Phase0Error("git_sha", sha.stderr || sha.stdout);
    return sha.stdout.trim();
  }

  /**
   * Fast-forward when the integration branch has not moved; otherwise a
   * merge commit. Conflict aborts and restores the previous HEAD.
   */
  mergeBranch(branch: string, taskId: string): Promise<MergeOutcome> {
    return this.enqueue(async () => {
      await this.assertOnIntegration();
      const before = await this.head();
      const ff = await this.git(["merge", "--ff-only", branch]);
      if (ff.code === 0) {
        return { sha: await this.head(), method: "fast-forward" };
      }
      const merged = await this.git([
        "merge",
        "--no-ff",
        "--no-edit",
        "-m",
        `phase0: merge ${taskId} into ${INTEGRATION_BRANCH}`,
        branch,
      ]);
      if (merged.code !== 0) {
        await this.git(["merge", "--abort"]);
        const after = await this.head();
        if (after !== before) {
          throw new Phase0Error("merge_failed", `merge of ${taskId} moved ${INTEGRATION_BRANCH}`);
        }
        throw new Phase0Error("merge_failed", (merged.stderr || merged.stdout).trim());
      }
      return { sha: await this.head(), method: "merge" };
    });
  }

  async cleanWorktree(): Promise<void> {
    const checkout = await this.git(["checkout", "--", "."]);
    if (checkout.code !== 0) throw new Phase0Error("git_clean", checkout.stderr || checkout.stdout);
    const cleaned = await this.git(["clean", "-fd", "-e", "node_modules"]);
    if (cleaned.code !== 0) throw new Phase0Error("git_clean", cleaned.stderr || cleaned.stdout);
  }

  async removeTracked(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    const removed = await this.git(["rm", "-f", "--", ...paths]);
    if (removed.code !== 0) throw new Phase0Error("git_rm", removed.stderr || removed.stdout);
  }

  async removeRegisteredWorktrees(): Promise<void> {
    const listed = await this.git(["worktree", "list", "--porcelain"]);
    const paths: string[] = [];
    for (const line of listed.stdout.split(/\r?\n/)) {
      if (!line.startsWith("worktree ")) continue;
      paths.push(line.slice("worktree ".length).trim());
    }
    for (const worktree of paths) {
      if (path.resolve(worktree) === path.resolve(this.root)) continue;
      await this.git(["worktree", "remove", "--force", worktree]);
      await fs.rm(worktree, { recursive: true, force: true });
    }
  }

  async commitIfDirty(message: string): Promise<string | null> {
    const status = await this.porcelain();
    if (status.trim() === "") return null;
    return this.commitAll(this.root, message);
  }

  private async assertOnIntegration(): Promise<void> {
    const branch = await this.branch();
    if (branch !== INTEGRATION_BRANCH) {
      throw new Phase0Error("protected_branch", `Refusing to merge into ${branch}`);
    }
  }

  private async assertIntegrationWhenMain(cwd: string): Promise<void> {
    if (cwd !== this.root) return;
    await this.assertOnIntegration();
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mergeChain.then(fn, fn);
    this.mergeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async must(args: readonly string[]): Promise<string> {
    const result = await this.git(args);
    if (result.code !== 0) throw new Phase0Error("git", result.stderr || result.stdout);
    return result.stdout;
  }

  private git(args: readonly string[]): Promise<GitResult> {
    return runGit(this.root, args);
  }
}

export async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  const entries = Object.entries(files).sort((left, right) => left[0].localeCompare(right[0]));
  for (const [rel, content] of entries) {
    const abs = assertInsideRoot(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content.replaceAll("\r\n", "\n"), "utf8");
  }
}
