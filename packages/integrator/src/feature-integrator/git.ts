import { createDirectGitRunner } from "@ef-harness/git-engine";
import { GitCommandError } from "./errors.js";

export type DirectGitRunner = ReturnType<typeof createDirectGitRunner>;

export interface GitIdentity {
  readonly name: string;
  readonly email: string;
}

export const DEFAULT_GIT_IDENTITY: GitIdentity = {
  name: "EF Harness Integrator",
  email: "integrator@ef-harness.local",
};

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

const defaultGitRunner: DirectGitRunner = createDirectGitRunner();

export async function runGit(options: {
  readonly repo: string;
  readonly args: readonly string[];
  readonly input?: string;
  readonly identity?: GitIdentity;
  readonly runner?: DirectGitRunner;
}): Promise<GitResult> {
  const identity = options.identity ?? DEFAULT_GIT_IDENTITY;
  const runner = options.runner ?? defaultGitRunner;
  const args = [
    "-c",
    "core.longpaths=true",
    "-c",
    `user.name=${identity.name}`,
    "-c",
    `user.email=${identity.email}`,
    ...options.args,
  ];
  try {
    const result = await runner.execGit({
      cwd: options.repo,
      args,
      ...(options.input !== undefined ? { stdin: options.input } : {}),
      env: {
        GIT_AUTHOR_NAME: identity.name,
        GIT_AUTHOR_EMAIL: identity.email,
        GIT_COMMITTER_NAME: identity.name,
        GIT_COMMITTER_EMAIL: identity.email,
      },
    });
    return {
      status: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitCommandError(options.args[0] ?? "git", 127, message);
  }
}

export async function gitOk(options: {
  readonly repo: string;
  readonly args: readonly string[];
  readonly input?: string;
  readonly identity?: GitIdentity;
  readonly runner?: DirectGitRunner;
}): Promise<GitResult> {
  const result = await runGit(options);
  if (result.status !== 0) {
    throw new GitCommandError(options.args[0] ?? "git", result.status, result.stderr || result.stdout);
  }
  return result;
}

export async function revParse(repo: string, ref: string): Promise<string> {
  return (await gitOk({ repo, args: ["rev-parse", "--verify", ref] })).stdout.trim();
}

export async function isAncestor(repo: string, ancestor: string, descendant: string): Promise<boolean> {
  return (await runGit({ repo, args: ["merge-base", "--is-ancestor", ancestor, descendant] })).status === 0;
}

export async function commitMessage(repo: string, sha: string): Promise<string> {
  return (await gitOk({ repo, args: ["log", "-1", "--format=%B", sha] })).stdout;
}

export async function commitParents(repo: string, sha: string): Promise<string[]> {
  const raw = (await gitOk({ repo, args: ["rev-list", "--parents", "-n", "1", sha] })).stdout.trim();
  const parts = raw.split(/\s+/);
  return parts.slice(1);
}
