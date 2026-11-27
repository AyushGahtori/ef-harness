import { spawnSync } from "node:child_process";
import { GitCommandError } from "./errors.js";

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

export function runGit(options: {
  readonly repo: string;
  readonly args: readonly string[];
  readonly input?: string;
  readonly identity?: GitIdentity;
}): GitResult {
  const identity = options.identity ?? DEFAULT_GIT_IDENTITY;
  const started = Date.now();
  const args = [
    "-C",
    options.repo,
    "-c",
    "core.autocrlf=false",
    "-c",
    "core.longpaths=true",
    "-c",
    `user.name=${identity.name}`,
    "-c",
    `user.email=${identity.email}`,
    ...options.args,
  ];
  const result = spawnSync("git", args, {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    input: options.input,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
    },
  });
  if (result.error) {
    throw new GitCommandError(options.args[0] ?? "git", 127, result.error.message);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs: Date.now() - started,
  };
}

export function gitOk(options: {
  readonly repo: string;
  readonly args: readonly string[];
  readonly input?: string;
  readonly identity?: GitIdentity;
}): GitResult {
  const result = runGit(options);
  if (result.status !== 0) {
    throw new GitCommandError(options.args[0] ?? "git", result.status, result.stderr || result.stdout);
  }
  return result;
}

export function revParse(repo: string, ref: string): string {
  return gitOk({ repo, args: ["rev-parse", "--verify", ref] }).stdout.trim();
}

export function isAncestor(repo: string, ancestor: string, descendant: string): boolean {
  return runGit({ repo, args: ["merge-base", "--is-ancestor", ancestor, descendant] }).status === 0;
}

export function commitMessage(repo: string, sha: string): string {
  return gitOk({ repo, args: ["log", "-1", "--format=%B", sha] }).stdout;
}

export function commitParents(repo: string, sha: string): string[] {
  const raw = gitOk({ repo, args: ["rev-list", "--parents", "-n", "1", sha] }).stdout.trim();
  const parts = raw.split(/\s+/);
  return parts.slice(1);
}
