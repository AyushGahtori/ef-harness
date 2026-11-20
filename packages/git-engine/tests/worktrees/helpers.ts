import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProcessGitRunner, type GitExecResult, type GitRunOptions, type GitRunner } from "../../src/worktrees/git-runner.js";

export const TEST_TIMEOUT_MS = 60_000;

export interface SpyGit extends GitRunner {
  readonly calls: string[][];
}

export interface Fixture {
  readonly root: string;
  readonly main: string;
  readonly wt: string;
  readonly git: SpyGit;
}

export async function createFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ef038-"));
  const main = path.join(root, "main repo");
  const wt = path.join(root, "wt");
  await fs.mkdir(main, { recursive: true });
  const git = spyGit(createProcessGitRunner());
  await gitOk(git, main, ["init", "-b", "main"]);
  await gitOk(git, main, ["config", "user.name", "EF Harness Test"]);
  await gitOk(git, main, ["config", "user.email", "test@example.com"]);
  await gitOk(git, main, ["config", "core.autocrlf", "false"]);
  await gitOk(git, main, ["config", "commit.gpgsign", "false"]);
  return { root, main, wt, git };
}

export function spyGit(inner: GitRunner, intercept?: (args: readonly string[], options: GitRunOptions) => Promise<GitExecResult | null>): SpyGit {
  const calls: string[][] = [];
  return {
    calls,
    resolveGitBinary: () => inner.resolveGitBinary(),
    async execGit(args, options) {
      calls.push([...args]);
      const intercepted = intercept ? await intercept(args, options) : null;
      if (intercepted) return intercepted;
      return inner.execGit(args, options);
    },
  };
}

export async function gitOk(git: GitRunner, cwd: string, args: readonly string[]): Promise<string> {
  const result = await git.execGit(args, { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  }
  return result.stdout.trim();
}

export async function writeFiles(repo: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(repo, relative);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
}

export async function commitAll(git: GitRunner, repo: string, message: string): Promise<string> {
  await gitOk(git, repo, ["add", "-A"]);
  await gitOk(git, repo, ["commit", "-m", message]);
  return gitOk(git, repo, ["rev-parse", "HEAD"]);
}

export async function stopBeforeReset(slotPath: string): Promise<void> {
  void slotPath;
}

export async function cleanupFixture(fixture: Fixture, extraRepos: readonly string[] = []): Promise<void> {
  for (const repo of [fixture.main, ...extraRepos]) {
    try {
      await fs.access(repo);
    } catch {
      continue;
    }
    const listed = await fixture.git.execGit(["worktree", "list", "--porcelain"], { cwd: repo });
    if (listed.exitCode !== 0) continue;
    for (const line of listed.stdout.split(/\r?\n/)) {
      if (!line.startsWith("worktree ")) continue;
      const worktree = line.slice("worktree ".length);
      if (path.resolve(worktree).toLowerCase() === path.resolve(repo).toLowerCase()) continue;
      await fixture.git.execGit(["worktree", "remove", "--force", worktree], { cwd: repo });
    }
  }
  await fs.rm(fixture.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
