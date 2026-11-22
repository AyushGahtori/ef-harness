import { spawnSync } from "node:child_process";
import { GitCommandError } from "./errors.js";

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const IDENTITY = {
  name: "Project Integrator",
  email: "project-integrator@ef-harness.local",
};

export function runGit(repo: string, args: readonly string[], input?: string): GitResult {
  const result = spawnSync(
    "git",
    [
      "-C",
      repo,
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.longpaths=true",
      "-c",
      "core.quotepath=false",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Project Integrator",
      "-c",
      "user.email=project-integrator@ef-harness.local",
      ...args,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      shell: false,
      input,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: IDENTITY.name,
        GIT_AUTHOR_EMAIL: IDENTITY.email,
        GIT_COMMITTER_NAME: IDENTITY.name,
        GIT_COMMITTER_EMAIL: IDENTITY.email,
      },
    },
  );
  if (result.error) {
    throw new GitCommandError(args[0] ?? "git", 127, result.error.message);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function gitOk(repo: string, args: readonly string[], input?: string): GitResult {
  const result = runGit(repo, args, input);
  if (result.status !== 0) {
    throw new GitCommandError(args[0] ?? "git", result.status, result.stderr || result.stdout);
  }
  return result;
}

export function revParse(repo: string, ref: string): string {
  return gitOk(repo, ["rev-parse", "--verify", ref]).stdout.trim();
}

export function isAncestor(repo: string, ancestor: string, descendant: string): boolean {
  return runGit(repo, ["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
}

export function commitMessage(repo: string, sha: string): string {
  return gitOk(repo, ["log", "-1", "--format=%B", sha]).stdout;
}

export function commitParents(repo: string, sha: string): string[] {
  const raw = gitOk(repo, ["rev-list", "--parents", "-n", "1", sha]).stdout.trim();
  const parts = raw.split(/\s+/);
  return parts.slice(1);
}

export function conflictedPaths(repo: string): string[] {
  const raw = gitOk(repo, ["diff", "--name-only", "--diff-filter=U"]).stdout;
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function showStage(repo: string, stage: 2 | 3, path: string): string {
  const result = runGit(repo, ["show", `:${stage}:${path}`]);
  if (result.status !== 0) return "";
  return result.stdout;
}
