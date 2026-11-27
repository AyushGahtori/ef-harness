import path from "node:path";
import { execGit as runCanonicalGit } from "../runner/exec-git.js";
import { DEFAULT_COMMAND_TIMEOUT_MS } from "./types.js";
import type { GitCommandResult, GitExecOptions, GitRunner } from "./types.js";

export function createDefaultGitRunner(gitBinary?: string): GitRunner {
  return {
    async execGit(args: readonly string[], options: GitExecOptions): Promise<GitCommandResult> {
      const consent = options.userExplicitConsentToken;
      const result = await runCanonicalGit({
        args,
        cwd: options.cwd,
        timeoutMs: options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
        ...(options.env !== undefined ? { env: { ...options.env } } : {}),
        ...(consent !== undefined ? { userExplicitConsentToken: consent } : {}),
        ...(gitBinary !== undefined ? { gitBinary } : {}),
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      };
    },
  };
}

export async function resolveGitPath(
  git: GitRunner,
  repoRoot: string,
  gitPath: string,
): Promise<string | undefined> {
  const result = await git.execGit(["rev-parse", "--git-path", gitPath], {
    cwd: repoRoot,
    timeoutMs: 10_000,
  });
  if (result.exitCode !== 0) return undefined;
  const line = result.stdout.trim().split(/\r?\n/)[0] ?? "";
  if (!line) return undefined;
  return path.resolve(repoRoot, line);
}
