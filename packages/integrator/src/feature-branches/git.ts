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
}

export function runGit(options: {
  readonly repo: string;
  readonly args: readonly string[];
  readonly input?: string;
  readonly identity?: GitIdentity;
}): GitResult {
  const identity = options.identity ?? DEFAULT_GIT_IDENTITY;
  const args = [
    "-C",
    options.repo,
    "-c",
    "core.autocrlf=false",
    "-c",
    "core.longpaths=true",
    "-c",
    "core.quotepath=false",
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
      GIT_MERGE_AUTOEDIT: "no",
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
    throw new GitCommandError(options.args.join(" "), result.status, result.stderr || result.stdout);
  }
  return result;
}

export function revParse(repo: string, ref: string): string {
  return gitOk({ repo, args: ["rev-parse", "--verify", ref] }).stdout.trim();
}

export function tryRevParse(repo: string, ref: string): string | null {
  const result = runGit({ repo, args: ["rev-parse", "--verify", "--quiet", ref] });
  if (result.status !== 0) return null;
  const sha = result.stdout.trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

export function isAncestor(repo: string, ancestor: string, descendant: string): boolean {
  return runGit({ repo, args: ["merge-base", "--is-ancestor", ancestor, descendant] }).status === 0;
}

export function commitParents(repo: string, sha: string): string[] {
  const raw = gitOk({ repo, args: ["rev-list", "--parents", "-n", "1", sha] }).stdout.trim();
  return raw.split(/\s+/).slice(1);
}

export function catFileType(repo: string, sha: string): string | null {
  const result = runGit({ repo, args: ["cat-file", "-t", sha] });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

export function showFile(repo: string, spec: string): string {
  return gitOk({ repo, args: ["show", spec] }).stdout;
}

export function listTree(repo: string, ref: string): string[] {
  const output = gitOk({ repo, args: ["ls-tree", "-r", "--name-only", ref] }).stdout;
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function diffNameOnly(repo: string, range: string): string[] {
  const output = gitOk({ repo, args: ["diff", "--name-only", range] }).stdout;
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function countExclusive(repo: string, from: string, to: string): number {
  const output = gitOk({ repo, args: ["rev-list", "--count", `${from}..${to}`] }).stdout.trim();
  const count = Number(output);
  if (!Number.isInteger(count)) {
    throw new GitCommandError("rev-list --count", 1, output);
  }
  return count;
}

export function untrackedFiles(worktree: string): string[] {
  const output = gitOk({ repo: worktree, args: ["ls-files", "--others", "--exclude-standard"] }).stdout;
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().replaceAll("\\", "/"))
    .filter((line) => line.length > 0);
}

export function porcelain(repo: string): string {
  return gitOk({ repo, args: ["status", "--porcelain"] }).stdout;
}
